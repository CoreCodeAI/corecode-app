package service

import (
	"cmp"
	"math"
	"slices"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"

	"golang.org/x/sync/singleflight"
)

const (
	// outlookHorizon is how far the outlook looks ahead: the longest of the
	// windows it reports.
	outlookHorizon  = 7 * 24 * time.Hour
	outlookFiveHour = 5 * time.Hour
	outlookWeek     = 7 * 24 * time.Hour
	// outlookTTL is how long one outlook is shared; the pool it is read from
	// is shared for as long.
	outlookTTL = 5 * time.Second
	// outlookMaxAddition is the most added accounts the 7-day search tries.
	outlookMaxAddition = 30
	// A shortfall under this many dollars is rounding, not a gap.
	outlookShortFloor = 0.01
	// outlookHistoryDays is how many days the history model averages each
	// hour of the day over, and outlookHistoryMinHours the least it reads.
	outlookHistoryDays     = 7
	outlookHistoryMinHours = 24
)

// outlookWindowHours are the windows the outlook reports, shortest first.
// Each is a sample of the curve, so a window's totals are a point on it.
var outlookWindowHours = []float64{5, 24, 168}

// The demand models, in the order the console lists them.
const (
	OutlookLinearHour = "linear_1h"
	OutlookLinearHalf = "linear_12h"
	OutlookLinearDay  = "linear_24h"
	OutlookHistory    = "history"
	OutlookSmart      = "smart"
)

// EngineOutlook is the Claude accounts' quota over the next 5 hours, 24
// hours and 7 days: what they hold now, what their 5-hour and weekly resets
// bring back, and whether that meets demand under each of several ways of
// forecasting it. Dollars are the pool estimate's: official prices weighted
// by the quota each model draws.
type EngineOutlook struct {
	Configured bool   `json:"configured"`
	Error      string `json:"error,omitempty"`
	Channel    string `json:"channel"`
	ObservedAt int64  `json:"observed_at_ms"`
	// Counted accounts have a weekly remainder and capacity; Unknown ones
	// could serve but lack one of them and add no supply.
	Counted int `json:"counted"`
	Unknown int `json:"unknown"`
	// WeekCapacityUSD and FiveHourCapacityUSD are the counted accounts' full
	// windows up to their budget lines.
	WeekCapacityUSD     float64 `json:"week_capacity_usd"`
	FiveHourCapacityUSD float64 `json:"five_hour_capacity_usd"`
	// SustainableUSDPerHour is what the weekly resets bring back on average,
	// PeakUSDPerHour the most fresh 5-hour windows serve in an hour.
	SustainableUSDPerHour float64 `json:"sustainable_usd_per_hour"`
	PeakUSDPerHour        float64 `json:"peak_usd_per_hour"`
	// Remaining is the supply over each of outlookWindowHours.
	Remaining []EngineOutlookRemaining `json:"remaining"`
	// Resets are the counted accounts' next 5-hour and weekly resets within
	// the horizon, soonest first.
	Resets []EngineOutlookReset `json:"resets"`
	// SampleHours are the hours from now each curve point stands at: every
	// 5 minutes over the first 5 hours, every 15 to 24 hours, hourly after.
	SampleHours []float64 `json:"sample_hours"`
	// Models are the demand forecasts with the pool run forward under each.
	Models []EngineOutlookModel `json:"models"`
	// GrowthPerDay is the daily growth the smart model carries on, damped;
	// Momentum the multiple the latest hours put on its level now, which
	// fades within hours; BandForecasts the past forecasts its range is
	// drawn from, 0 without one.
	GrowthPerDay  float64 `json:"growth_per_day"`
	Momentum      float64 `json:"momentum"`
	BandForecasts int     `json:"band_forecasts"`
	// HistoryHours is the hours of use the history model averages, 0 when
	// there is under a day of it.
	HistoryHours int `json:"history_hours"`
	// UsageError is set when gpt-load's recent spend could not be read; the
	// 1-hour and 12-hour linear models are then unavailable.
	UsageError string `json:"usage_error,omitempty"`
}

// EngineOutlookRemaining is the most the pool can spend within Hours,
// whatever the demand: every account drawing all it may as soon as it may.
type EngineOutlookRemaining struct {
	Hours float64 `json:"hours"`
	// OnHandUSD counts no reset of a window as long as Hours or longer: the
	// 5-hour figure is what the current 5-hour windows hold, bounded by each
	// account's weekly remainder; the longer ones are the weekly remainder
	// as far as the 5-hour windows let it through in that time.
	OnHandUSD float64 `json:"on_hand_usd"`
	// FiveHourRefillUSD is what 5-hour resets inside the window add to that,
	// above 0 for the 5-hour window only: longer ones already cycle them.
	FiveHourRefillUSD float64 `json:"five_hour_refill_usd"`
	// WeekRefillUSD is what weekly resets inside the window add.
	WeekRefillUSD float64 `json:"week_refill_usd"`
	// WithResetsUSD is the three together.
	WithResetsUSD float64 `json:"with_resets_usd"`
}

// EngineOutlookReset is one account's next reset of one window.
type EngineOutlookReset struct {
	CredentialID int    `json:"credential_id"`
	EmailMask    string `json:"email_mask"`
	// Window is five_hour or seven_day.
	Window string `json:"window"`
	AtMS   int64  `json:"at_ms"`
	// AddsUSD is what the reset adds to what the account can spend if it
	// spends nothing more before it: a weekly reset the used part of the
	// week, a 5-hour reset the used part of the window as far as the weekly
	// remainder allows.
	AddsUSD float64 `json:"adds_usd"`
}

// EngineOutlookModel is one demand forecast and the pool run forward under
// it. Drawable, WeekLeft and Demand hold one value per SampleHours.
type EngineOutlookModel struct {
	ID string `json:"id"`
	// Available is false when the model's input could not be read.
	Available bool `json:"available"`
	// RateUSDPerHour is the demand now, AverageUSDPerHour its mean over the
	// horizon, and PeakUSDPerHour its busiest clock hour of the next 24.
	RateUSDPerHour    float64 `json:"rate_usd_per_hour"`
	AverageUSDPerHour float64 `json:"average_usd_per_hour"`
	PeakUSDPerHour    float64 `json:"peak_usd_per_hour"`
	// WeekLoad is AverageUSDPerHour over the pool's sustainable supply.
	WeekLoad float64               `json:"week_load"`
	Windows  []EngineOutlookWindow `json:"windows"`
	// Drawable is what the pool can spend at once at each sample: every
	// account's 5-hour remainder bounded by its weekly one. WeekLeft is the
	// weekly quota left. Demand is dollars per hour.
	Drawable []float64 `json:"drawable"`
	WeekLeft []float64 `json:"week_left"`
	Demand   []float64 `json:"demand"`
	// Low and High run the smart forecast at the ends of its usual range;
	// nil for the other models and without the history a range needs.
	Low  *EngineOutlookBand `json:"low"`
	High *EngineOutlookBand `json:"high"`
	// Additions size each of runwayAddPlans that has a measured account.
	Additions []EngineOutlookAddition `json:"additions"`
}

// EngineOutlookBand is a model run at another multiple of its demand.
type EngineOutlookBand struct {
	Scale    float64               `json:"scale"`
	Windows  []EngineOutlookWindow `json:"windows"`
	Drawable []float64             `json:"drawable"`
	WeekLeft []float64             `json:"week_left"`
}

// EngineOutlookWindow is the first Hours of a projection.
type EngineOutlookWindow struct {
	Hours     float64 `json:"hours"`
	DemandUSD float64 `json:"demand_usd"`
	ServedUSD float64 `json:"served_usd"`
	// ShortUSD is the demand left unserved and ShortHours the time the pool
	// had nothing to spend; FirstShortHours is when that first happens.
	ShortUSD        float64  `json:"short_usd"`
	ShortHours      float64  `json:"short_hours"`
	FirstShortHours *float64 `json:"first_short_hours"`
	// LowestUSD is the least the pool could spend at once at any moment of
	// the window, and LowestHours when.
	LowestUSD   float64 `json:"lowest_usd"`
	LowestHours float64 `json:"lowest_hours"`
}

// EngineOutlookAddition sizes the accounts of one plan a model's demand
// calls for.
type EngineOutlookAddition struct {
	Plan string `json:"plan"`
	Tier string `json:"tier"`
	// WeekUSD and FiveHourUSD are one added account's full windows up to the
	// budget lines of the group its plan's accounts are in: the plan's median
	// measured account.
	WeekUSD     float64 `json:"week_usd"`
	FiveHourUSD float64 `json:"five_hour_usd"`
	Measured    int     `json:"measured"`
	// KeepUp brings the weekly load to 100% at the model's average demand.
	KeepUp int `json:"keep_up"`
	// CoverWeek is the fewest added accounts, each with full windows now,
	// that leave the next 7 days without unserved demand; nil when even
	// outlookMaxAddition do not.
	CoverWeek *int `json:"cover_week"`
}

// outlookAccount is one counted account's two windows. A reset of 0 means
// the window is not running: it starts with the account's next spend.
type outlookAccount struct {
	id    int
	label string
	// week is the weekly quota left below the budget line, weekFull a full
	// week up to it, and weekReset when the week resets, unix milliseconds.
	week, weekFull float64
	weekReset      int64
	// five, fiveFull and fiveReset are the same for the 5-hour window, read
	// only when fiveLimited: an account without a 5-hour capacity is bounded
	// by its week alone.
	five, fiveFull float64
	fiveReset      int64
	fiveLimited    bool
	// readyMS is when a cooling account may be sent requests again.
	readyMS int64
}

// available is what the account can spend at once at atMS.
func (account *outlookAccount) available(atMS int64) float64 {
	if account.readyMS > atMS {
		return 0
	}
	if account.fiveLimited {
		return math.Max(0, math.Min(account.five, account.week))
	}
	return math.Max(0, account.week)
}

// refill applies the resets due at atMS. A reset window stops running until
// the account spends again.
func (account *outlookAccount) refill(atMS int64, fiveResets, weekResets bool) {
	if weekResets && account.weekReset != 0 && account.weekReset <= atMS {
		account.week, account.weekReset = account.weekFull, 0
	}
	if fiveResets && account.fiveLimited && account.fiveReset != 0 && account.fiveReset <= atMS {
		account.five, account.fiveReset = account.fiveFull, 0
	}
}

// start begins the windows that are not running, as the account's first
// spend at atMS does.
func (account *outlookAccount) start(atMS int64) {
	if account.weekReset == 0 {
		account.weekReset = atMS + outlookWeek.Milliseconds()
	}
	if account.fiveLimited && account.fiveReset == 0 {
		account.fiveReset = atMS + outlookFiveHour.Milliseconds()
	}
}

// draw takes amount from both windows.
func (account *outlookAccount) draw(amount float64) {
	account.week -= amount
	if account.fiveLimited {
		account.five -= amount
	}
}

// nextEvent is the account's earliest reset or return from cooling after
// atMS, or limit when none comes before it.
func (account *outlookAccount) nextEvent(atMS, limit int64, fiveResets, weekResets bool) int64 {
	next := limit
	if account.readyMS > atMS {
		next = min(next, account.readyMS)
	}
	if weekResets && account.weekReset > atMS {
		next = min(next, account.weekReset)
	}
	if fiveResets && account.fiveLimited && account.fiveReset > atMS {
		next = min(next, account.fiveReset)
	}
	return next
}

// drawable is the most the account can spend in [nowMS, endMS): all it may
// at once, and again after each reset the flags allow. Spending at once
// starts each window as early as it can start, and nothing an account holds
// at a weekly reset is lost, so no other order spends more.
func (account outlookAccount) drawable(nowMS, endMS int64, fiveResets, weekResets bool) float64 {
	total := 0.0
	for atMS := nowMS; atMS < endMS; {
		account.refill(atMS, fiveResets, weekResets)
		if amount := account.available(atMS); amount > 0 {
			account.start(atMS)
			account.draw(amount)
			total += amount
		}
		atMS = account.nextEvent(atMS, endMS, fiveResets, weekResets)
	}
	return total
}

type outlookPool struct {
	accounts []outlookAccount
	counted  int
	unknown  int
	// burn is every account's logged spend over the last 24 hours, per hour,
	// including accounts paused now, since their traffic moves to the others.
	burn         float64
	weekCapacity float64
	fiveCapacity float64
}

// outlookAccounts reads the channel's accounts the way the runway counts
// them: a disabled group's and an excluded status's accounts add no supply,
// and one without a weekly remainder or capacity is unknown. ok is false
// when the channel has no account at all.
func outlookAccounts(pool EnginePool, channel string, nowMS int64) (result outlookPool, ok bool) {
	groups := make(map[int]EngineGroup, len(pool.Groups))
	for _, group := range pool.Groups {
		groups[group.ID] = group
	}
	for _, account := range pool.Accounts {
		group, found := groups[account.GroupID]
		if !found || group.Channel != channel {
			continue
		}
		ok = true
		result.burn += deref(account.BurnUSDPerHour)
		if !group.Enabled || runwayExcluded[account.Status] {
			continue
		}
		remaining, capacity := account.SevenDayRemainingUSD, account.SevenDayCapacityUSD
		if remaining == nil || capacity == nil {
			result.unknown++
			continue
		}
		weekCeiling, fiveCeiling := 1.0, 1.0
		if group.QuotaBudget {
			weekCeiling, fiveCeiling = group.SevenDayBudget/100, group.FiveHourBudget/100
		}
		row := outlookAccount{
			id: account.CredentialID, label: account.EmailMask,
			week: math.Max(*remaining, 0), weekFull: *capacity * weekCeiling,
			weekReset: rollForward(account.SevenDayReset, nowMS, outlookWeek),
		}
		if left, full := account.FiveHourRemainingUSD, account.FiveHourCapacityUSD; left != nil && full != nil {
			row.fiveLimited = true
			row.five, row.fiveFull = math.Max(*left, 0), *full*fiveCeiling
			row.fiveReset = rollForward(account.FiveHourReset, nowMS, outlookFiveHour)
			result.fiveCapacity += row.fiveFull
		}
		if account.CooldownUntil > nowMS {
			row.readyMS = account.CooldownUntil
		}
		result.accounts = append(result.accounts, row)
		result.counted++
		result.weekCapacity += row.weekFull
	}
	return result, ok
}

// rollForward moves a reset the engine last read in the past on by whole
// windows: a busy account's next window starts as the last one ends. 0, a
// window that is not running, stays 0.
func rollForward(resetMS, nowMS int64, window time.Duration) int64 {
	if resetMS <= 0 {
		return 0
	}
	for resetMS <= nowMS {
		resetMS += window.Milliseconds()
	}
	return resetMS
}

// outlookSampleHours are the hours from now the curves are sampled at. The
// spacing follows what moves at each distance: 5-hour windows reset within
// minutes of each other, weekly ones days apart.
func outlookSampleHours() []float64 {
	hours := make([]float64, 0, 281)
	for minute := 0; minute <= 5*60; minute += 5 {
		hours = append(hours, float64(minute)/60)
	}
	for quarter := 5*4 + 1; quarter <= 24*4; quarter++ {
		hours = append(hours, float64(quarter)/4)
	}
	for hour := 25; hour <= int(outlookHorizon.Hours()); hour++ {
		hours = append(hours, float64(hour))
	}
	return hours
}

type outlookProjection struct {
	windows  []EngineOutlookWindow
	drawable []float64
	weekLeft []float64
	demand   []float64
}

// projectOutlook runs the accounts forward over outlookHorizon from nowMS at
// demand rate(ms) dollars an hour, which holds within each UTC clock hour
// and between two samples. Demand is spread over the accounts in proportion
// to what each can spend at once, as the engine's routing by quota left
// roughly does. A 5-hour reset returns an account to its 5-hour budget and a
// weekly one to its weekly budget, discarding what was left; a window then
// starts again with the account's next spend. With nothing to spend
// anywhere, demand goes unserved until the next reset.
//
// It steps from one clock hour, sample, reset or return from cooling to the
// next. A reset is applied before the sample at the same moment, and a
// window closes before the resets due as it closes.
func projectOutlook(start []outlookAccount, nowMS int64, rate func(ms int64) float64, sampleHours []float64) outlookProjection {
	accounts := slices.Clone(start)
	hour := time.Hour.Milliseconds()
	hourMS := float64(hour)
	endMS := nowMS + outlookHorizon.Milliseconds()
	samples := make([]int64, len(sampleHours))
	for i, hours := range sampleHours {
		samples[i] = nowMS + int64(math.Round(hours*hourMS))
	}
	result := outlookProjection{
		drawable: make([]float64, 0, len(samples)), weekLeft: make([]float64, 0, len(samples)),
		demand: make([]float64, 0, len(samples)),
	}
	demanded, served, shortHours := 0.0, 0.0, 0.0
	var firstShort *float64
	lowest, lowestHours := math.Inf(1), 0.0
	closeWindows := func(atMS int64) {
		for len(result.windows) < len(outlookWindowHours) {
			hours := outlookWindowHours[len(result.windows)]
			if float64(atMS-nowMS)/hourMS < hours {
				return
			}
			window := EngineOutlookWindow{
				Hours: hours, DemandUSD: demanded, ServedUSD: served, ShortUSD: math.Max(0, demanded-served),
				ShortHours: shortHours, LowestHours: lowestHours,
			}
			if window.ShortUSD < outlookShortFloor {
				window.ShortUSD = 0
			}
			if !math.IsInf(lowest, 1) {
				window.LowestUSD = lowest
			}
			if firstShort != nil {
				value := *firstShort
				window.FirstShortHours = &value
			}
			result.windows = append(result.windows, window)
		}
	}
	note := func(total float64, atMS int64) {
		if total < lowest {
			lowest, lowestHours = total, float64(atMS-nowMS)/hourMS
		}
	}
	for atMS := nowMS; atMS < endMS; {
		closeWindows(atMS)
		total, week := 0.0, 0.0
		for i := range accounts {
			accounts[i].refill(atMS, true, true)
			total += accounts[i].available(atMS)
			week += math.Max(0, accounts[i].week)
		}
		perHour := math.Max(0, rate(atMS))
		for len(result.drawable) < len(samples) && samples[len(result.drawable)] <= atMS {
			result.drawable = append(result.drawable, roundTenth(total))
			result.weekLeft = append(result.weekLeft, roundTenth(week))
			result.demand = append(result.demand, roundTenth(perHour))
		}
		note(total, atMS)

		// The step ends at the next moment anything changes. An account that
		// spends in it starts its windows now, which sets its next reset.
		untilMS := min(endMS, (atMS/hour+1)*hour)
		if next := len(result.drawable); next < len(samples) {
			untilMS = min(untilMS, samples[next])
		}
		spending := perHour > 0 && total > 0
		for i := range accounts {
			if spending && accounts[i].available(atMS) > 0 {
				accounts[i].start(atMS)
			}
			untilMS = accounts[i].nextEvent(atMS, untilMS, true, true)
		}
		span := float64(untilMS-atMS) / hourMS
		need := perHour * span
		demanded += need
		switch {
		case need <= 0:
			// A quiet stretch inside a gap is still time without quota.
			if total <= 0 && firstShort != nil {
				shortHours += span
			}
		case need >= total:
			lasts := total / perHour
			if firstShort == nil {
				at := float64(atMS-nowMS)/hourMS + lasts
				firstShort = &at
			}
			shortHours += span - lasts
			served += total
			for i := range accounts {
				accounts[i].draw(accounts[i].available(atMS))
			}
			note(0, atMS+int64(lasts*hourMS))
		default:
			share := need / total
			served += need
			for i := range accounts {
				accounts[i].draw(accounts[i].available(atMS) * share)
			}
			note(total-need, untilMS)
		}
		atMS = untilMS
	}
	closeWindows(endMS)
	// The last sample stands at the horizon's end, after the last step.
	if len(result.drawable) < len(samples) {
		total, week := 0.0, 0.0
		for i := range accounts {
			accounts[i].refill(endMS, true, true)
			total += accounts[i].available(endMS)
			week += math.Max(0, accounts[i].week)
		}
		for len(result.drawable) < len(samples) {
			result.drawable = append(result.drawable, roundTenth(total))
			result.weekLeft = append(result.weekLeft, roundTenth(week))
			result.demand = append(result.demand, roundTenth(math.Max(0, rate(endMS))))
		}
	}
	return result
}

func roundTenth(value float64) float64 {
	return math.Round(value*10) / 10
}

// outlookDemand is what the demand models are built from.
type outlookDemand struct {
	// burn is the demand's level: the channel's spend over the last 24
	// hours, per hour, in the pool estimate's dollars.
	burn    float64
	profile demandProfile
	// series is the console's hourly use of the channel's models, oldest
	// first, its first hour starting at firstHour, unix seconds. It gives
	// the history model each hour's share of a day, not a level.
	series    []float64
	firstHour int64
	// hourUSD, halfDayUSD and dayUSD are gpt-load's spend over the last 1,
	// 12 and 24 hours at official prices, read for the two against the
	// third: how far the latest hours run from the day's rate.
	hourUSD, halfDayUSD, dayUSD float64
}

type outlookModelSpec struct {
	id   string
	rate func(ms int64) float64
}

// models are the demand forecasts the input can make, in listing order; a
// model without its input has a nil rate.
//
//   - linear_24h holds the last 24 hours' rate; linear_12h and linear_1h
//     move it by how the last 12 hours and the last hour ran against the day.
//   - history gives each hour of the day its mean over the last
//     outlookHistoryDays days, at the last day's dollars per unit of use.
//   - smart is the runway's trend forecast: the level the latest hours hold,
//     moved through the day by the last week's shape and grown by the damped
//     trend, with the momentum of the latest hours fading out of it.
func (demand outlookDemand) models(nowMS int64) []outlookModelSpec {
	constant := func(perHour float64) func(int64) float64 {
		return func(int64) float64 { return perHour }
	}
	specs := []outlookModelSpec{{id: OutlookLinearHour}, {id: OutlookLinearHalf}, {id: OutlookLinearDay, rate: constant(demand.burn)}}
	if demand.dayUSD > 0 {
		perHour := demand.dayUSD / 24
		specs[0].rate = constant(demand.burn * demand.hourUSD / perHour)
		specs[1].rate = constant(demand.burn * demand.halfDayUSD / 12 / perHour)
	}

	history := outlookModelSpec{id: OutlookHistory}
	series, firstHour := demand.used()
	if hours := len(series); hours >= outlookHistoryMinHours {
		var sums [24]float64
		var counts [24]int
		utcHour := func(index int) int { return int((firstHour/3600 + int64(index)) % 24) }
		for k := max(0, hours-outlookHistoryDays*24); k < hours; k++ {
			sums[utcHour(k)] += series[k]
			counts[utcHour(k)]++
		}
		if day := mean(series[hours-24:]); day > 0 {
			// Dollars per unit of the console's use, from the same day.
			perUnit := demand.burn / day
			history.rate = func(ms int64) float64 {
				at := (ms / time.Hour.Milliseconds()) % 24
				if counts[at] == 0 {
					return 0
				}
				return perUnit * sums[at] / float64(counts[at])
			}
		}
	}

	level := demand.burn * demand.profile.levelScale()
	hourMS := float64(time.Hour.Milliseconds())
	smart := outlookModelSpec{id: OutlookSmart, rate: func(ms int64) float64 {
		ahead := float64(ms-nowMS) / hourMS
		return level * demand.profile.at(ms) * demand.profile.growthAt(ahead/24) * demand.profile.momentumAt(ahead)
	}}
	return append(specs, history, smart)
}

// used is the series from its first hour with use. Hours before it are
// dropped, as the profile drops them, so a young site's history is not
// averaged with the days before it opened.
func (demand outlookDemand) used() ([]float64, int64) {
	series, firstHour := demand.series, demand.firstHour
	for len(series) > 0 && series[0] <= 0 {
		series, firstHour = series[1:], firstHour+3600
	}
	return series, firstHour
}

// historyHours is the hours the history model averages: up to
// outlookHistoryDays days, 0 under outlookHistoryMinHours.
func (demand outlookDemand) historyHours() int {
	series, _ := demand.used()
	if len(series) < outlookHistoryMinHours {
		return 0
	}
	return min(len(series), outlookHistoryDays*24)
}

// poolOutlook sets the channel's accounts against each demand model. Nil
// when the channel has no account.
func poolOutlook(pool EnginePool, channel string, nowMS int64, demand outlookDemand) *EngineOutlook {
	accounts, ok := outlookAccounts(pool, channel, nowMS)
	if !ok {
		return nil
	}
	demand.burn = accounts.burn
	outlook := EngineOutlook{
		Configured: true, Channel: channel, ObservedAt: nowMS,
		Counted: accounts.counted, Unknown: accounts.unknown,
		WeekCapacityUSD: accounts.weekCapacity, FiveHourCapacityUSD: accounts.fiveCapacity,
		SustainableUSDPerHour: accounts.weekCapacity / outlookWeek.Hours(),
		PeakUSDPerHour:        accounts.fiveCapacity / outlookFiveHour.Hours(),
		Remaining:             outlookRemaining(accounts.accounts, nowMS),
		Resets:                outlookResets(accounts.accounts, nowMS),
		SampleHours:           outlookSampleHours(),
		Models:                []EngineOutlookModel{},
		GrowthPerDay:          demand.profile.growthPerDay(),
		Momentum:              demand.profile.momentumAt(0),
		BandForecasts:         demand.profile.origins,
		HistoryHours:          demand.historyHours(),
	}
	plans := outlookPlans(pool, channel)
	for _, spec := range demand.models(nowMS) {
		row := EngineOutlookModel{ID: spec.id, Windows: []EngineOutlookWindow{}, Additions: []EngineOutlookAddition{}}
		if spec.rate == nil {
			outlook.Models = append(outlook.Models, row)
			continue
		}
		row.Available = true
		projection := projectOutlook(accounts.accounts, nowMS, spec.rate, outlook.SampleHours)
		row.Windows, row.Drawable, row.WeekLeft, row.Demand = projection.windows, projection.drawable, projection.weekLeft, projection.demand
		row.RateUSDPerHour = math.Max(0, spec.rate(nowMS))
		row.AverageUSDPerHour = projection.windows[len(projection.windows)-1].DemandUSD / outlookHorizon.Hours()
		hour := time.Hour.Milliseconds()
		for at := nowMS; at < nowMS+24*hour; at += hour {
			row.PeakUSDPerHour = math.Max(row.PeakUSDPerHour, spec.rate(at))
		}
		if outlook.SustainableUSDPerHour > 0 {
			row.WeekLoad = row.AverageUSDPerHour / outlook.SustainableUSDPerHour
		}
		if spec.id == OutlookSmart && demand.profile.origins > 0 {
			// The band holds the forecast, as the runway's does.
			band := func(scale float64) *EngineOutlookBand {
				scaled := projectOutlook(accounts.accounts, nowMS, func(ms int64) float64 { return scale * spec.rate(ms) }, outlook.SampleHours)
				return &EngineOutlookBand{Scale: scale, Windows: scaled.windows, Drawable: scaled.drawable, WeekLeft: scaled.weekLeft}
			}
			row.Low, row.High = band(min(demand.profile.low, 1)), band(max(demand.profile.high, 1))
		}
		for _, plan := range plans {
			row.Additions = append(row.Additions, plan.size(accounts.accounts, nowMS, spec.rate, row.AverageUSDPerHour, outlook.SustainableUSDPerHour, outlook.SampleHours))
		}
		outlook.Models = append(outlook.Models, row)
	}
	return &outlook
}

// outlookRemaining is the most the accounts can spend within each window,
// without and with the resets inside it.
func outlookRemaining(accounts []outlookAccount, nowMS int64) []EngineOutlookRemaining {
	rows := make([]EngineOutlookRemaining, 0, len(outlookWindowHours))
	for _, hours := range outlookWindowHours {
		endMS := nowMS + int64(hours*float64(time.Hour.Milliseconds()))
		// A window as long as the one asked about, or longer, does not reset
		// inside it; a shorter one turns over as it does.
		cycling := hours > outlookFiveHour.Hours()
		row := EngineOutlookRemaining{Hours: hours}
		withFive := 0.0
		for _, account := range accounts {
			row.OnHandUSD += account.drawable(nowMS, endMS, cycling, false)
			withFive += account.drawable(nowMS, endMS, true, false)
			row.WithResetsUSD += account.drawable(nowMS, endMS, true, true)
		}
		row.FiveHourRefillUSD = math.Max(0, withFive-row.OnHandUSD)
		row.WeekRefillUSD = math.Max(0, row.WithResetsUSD-withFive)
		rows = append(rows, row)
	}
	return rows
}

// outlookResets lists each account's running windows' next resets within
// the horizon, soonest first.
func outlookResets(accounts []outlookAccount, nowMS int64) []EngineOutlookReset {
	endMS := nowMS + outlookHorizon.Milliseconds()
	resets := []EngineOutlookReset{}
	for _, account := range accounts {
		if account.weekReset > nowMS && account.weekReset <= endMS {
			resets = append(resets, EngineOutlookReset{
				CredentialID: account.id, EmailMask: account.label, Window: "seven_day", AtMS: account.weekReset,
				AddsUSD: math.Max(0, account.weekFull-account.week),
			})
		}
		if account.fiveLimited && account.fiveReset > nowMS && account.fiveReset <= endMS {
			full := math.Min(account.fiveFull, account.week)
			resets = append(resets, EngineOutlookReset{
				CredentialID: account.id, EmailMask: account.label, Window: "five_hour", AtMS: account.fiveReset,
				AddsUSD: math.Max(0, full-math.Min(account.five, account.week)),
			})
		}
	}
	slices.SortStableFunc(resets, func(a, b EngineOutlookReset) int { return cmp.Compare(a.AtMS, b.AtMS) })
	return resets
}

// outlookPlan is an account of one plan as an addition to the pool.
type outlookPlan struct {
	plan, tier string
	weekUSD    float64
	fiveUSD    float64
	measured   int
}

// outlookPlans are runwayAddPlans that have a measured account in the
// channel, in that order. One added account is the plan's median measured
// week and median 5-hour window, up to the budget lines of the group the
// plan's accounts are in.
func outlookPlans(pool EnginePool, channel string) []outlookPlan {
	groups := make(map[int]EngineGroup, len(pool.Groups))
	for _, group := range pool.Groups {
		groups[group.ID] = group
	}
	values := EnginePlanValues(pool.Accounts)
	plans := []outlookPlan{}
	for _, add := range runwayAddPlans {
		index := slices.IndexFunc(values, func(value EnginePlanValue) bool { return value.Plan == add.plan && value.Tier == add.tier })
		if index < 0 {
			continue
		}
		weekBudget, fiveBudget := 1.0, 1.0
		var fives []float64
		budgeted := false
		for _, account := range pool.Accounts {
			group, ok := groups[account.GroupID]
			if !ok || group.Channel != channel || account.Plan != add.plan || account.Tier != add.tier {
				continue
			}
			if !budgeted && group.QuotaBudget {
				weekBudget, fiveBudget, budgeted = group.SevenDayBudget/100, group.FiveHourBudget/100, true
			}
			if five := account.FiveHourCapacityUSD; five != nil && *five > 0 {
				fives = append(fives, *five)
			}
		}
		plan := outlookPlan{plan: add.plan, tier: add.tier, weekUSD: values[index].WeekUSD * weekBudget, measured: values[index].Measured}
		if plan.weekUSD <= 0 {
			continue
		}
		if len(fives) > 0 {
			slices.Sort(fives)
			middle := len(fives) / 2
			median := fives[middle]
			if len(fives)%2 == 0 {
				median = (fives[middle-1] + fives[middle]) / 2
			}
			plan.fiveUSD = median * fiveBudget
		}
		plans = append(plans, plan)
	}
	return plans
}

// size counts the plan's accounts a demand calls for: enough for a weekly
// load of 100% at its average, and the fewest that leave the next 7 days
// without unserved demand.
func (plan outlookPlan) size(accounts []outlookAccount, nowMS int64, rate func(ms int64) float64, average, sustainable float64, sampleHours []float64) EngineOutlookAddition {
	addition := EngineOutlookAddition{Plan: plan.plan, Tier: plan.tier, WeekUSD: plan.weekUSD, FiveHourUSD: plan.fiveUSD, Measured: plan.measured}
	// Whole accounts: a shortfall of a cent still takes one.
	if short := (average - sustainable) * outlookWeek.Hours(); short > 0 {
		addition.KeepUp = int(math.Ceil(short/plan.weekUSD - 1e-9))
	}
	added := outlookAccount{
		week: plan.weekUSD, weekFull: plan.weekUSD,
		five: plan.fiveUSD, fiveFull: plan.fiveUSD, fiveLimited: plan.fiveUSD > 0,
	}
	covers := func(count int) bool {
		grown := slices.Clone(accounts)
		for range count {
			grown = append(grown, added)
		}
		windows := projectOutlook(grown, nowMS, rate, sampleHours).windows
		return windows[len(windows)-1].ShortUSD <= 0
	}
	// More accounts never serve less, so the fewest that cover is found by
	// halving.
	if covers(0) {
		zero := 0
		addition.CoverWeek = &zero
		return addition
	}
	if !covers(outlookMaxAddition) {
		return addition
	}
	short, enough := 0, outlookMaxAddition
	for enough-short > 1 {
		middle := (short + enough) / 2
		if covers(middle) {
			enough = middle
		} else {
			short = middle
		}
	}
	addition.CoverWeek = &enough
	return addition
}

var poolOutlookCache struct {
	mu      sync.Mutex
	outlook EngineOutlook
	readAt  time.Time
	found   bool
	flight  singleflight.Group
}

// FetchPoolOutlook reads the Claude pool's outlook: the pool as
// FetchEnginePool shares it, run forward under each demand model. A pool
// that is not configured, or that could not be read or estimated, returns
// without models. One outlook is shared for outlookTTL, and concurrent
// callers share one computation.
func FetchPoolOutlook() EngineOutlook {
	poolOutlookCache.mu.Lock()
	if poolOutlookCache.found && time.Since(poolOutlookCache.readAt) < outlookTTL {
		cached := poolOutlookCache.outlook
		poolOutlookCache.mu.Unlock()
		return cached
	}
	poolOutlookCache.mu.Unlock()
	value, _, _ := poolOutlookCache.flight.Do("claude", func() (any, error) {
		outlook := readPoolOutlook()
		if outlook.Configured && outlook.Error == "" {
			poolOutlookCache.mu.Lock()
			poolOutlookCache.outlook, poolOutlookCache.readAt, poolOutlookCache.found = outlook, time.Now(), true
			poolOutlookCache.mu.Unlock()
		}
		return outlook, nil
	})
	return value.(EngineOutlook)
}

func readPoolOutlook() EngineOutlook {
	empty := EngineOutlook{
		Channel: "claude", Remaining: []EngineOutlookRemaining{}, Resets: []EngineOutlookReset{},
		SampleHours: []float64{}, Models: []EngineOutlookModel{},
	}
	pool := FetchEnginePool()
	empty.Configured, empty.ObservedAt = pool.Configured, pool.ObservedAt
	if !pool.Configured {
		return empty
	}
	if empty.Error = cmp.Or(pool.Error, pool.EstimateError); empty.Error != "" {
		return empty
	}
	now := time.UnixMilli(pool.ObservedAt)
	var demand outlookDemand
	demand.profile, demand.series, demand.firstHour = vendorDemandHistory(model.VendorClaude, now)
	usageError := ""
	usage, err := FetchPoolUsage(model.VendorClaude)
	switch {
	case err != nil:
		usageError = err.Error()
	case usage.EngineError != "":
		usageError = usage.EngineError
	default:
		for _, window := range usage.Windows {
			switch window.Hours {
			case 1:
				demand.hourUSD = window.EngineUSD
			case 12:
				demand.halfDayUSD = window.EngineUSD
			case 24:
				demand.dayUSD = window.EngineUSD
			}
		}
	}
	outlook := poolOutlook(pool, "claude", pool.ObservedAt, demand)
	if outlook == nil {
		return empty
	}
	outlook.UsageError = usageError
	return *outlook
}

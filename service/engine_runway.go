package service

import (
	"math"
	"time"
)

const (
	// runwayHorizon is how far the projection looks ahead. It runs on the last
	// day's spend, which says little about the week after this one.
	runwayHorizon = 7 * 24 * time.Hour
	runwayWeek    = 7 * 24 * time.Hour
	runwayWindow  = 5 * time.Hour
	// An account's week-to-date rate is left out of the weekly average until
	// its window is this old; a few hours of one window say little.
	runwayMinElapsed = 12 * time.Hour
)

// runwayExcluded are statuses the engine leaves out of its estimate: these
// accounts serve nothing until an operator acts, so they add no supply.
var runwayExcluded = map[string]bool{
	"suspended":                true,
	"disabled":                 true,
	"blacklisted":              true,
	"reauthorization_required": true,
}

// EngineRunway is one channel's quota supply against its recent demand.
type EngineRunway struct {
	Channel string `json:"channel"`
	// BurnUSDPerHour is the channel's demand: every account's logged spend
	// over the last 24 hours, per hour, including accounts paused now, since
	// their traffic moves to the others.
	BurnUSDPerHour float64 `json:"burn_usd_per_hour"`
	// WeekToDateUSDPerHour checks it over a longer span: what each counted
	// account has used since its weekly reset, per hour, with the last day's
	// rate for an account whose window is younger than runwayMinElapsed.
	WeekToDateUSDPerHour float64 `json:"week_to_date_usd_per_hour"`
	// SustainableUSDPerHour is what the weekly resets bring back on average:
	// the counted accounts' weekly capacity up to their budget lines, over a
	// week. Demand above it drains the remainder.
	SustainableUSDPerHour float64 `json:"sustainable_usd_per_hour"`
	// PeakUSDPerHour is the most the counted accounts serve in an hour with
	// fresh 5-hour windows: their 5-hour capacity up to the budget line, over
	// five hours. Counted accounts without a 5-hour capacity are left out.
	PeakUSDPerHour float64 `json:"peak_usd_per_hour"`
	// WeekRemainingUSD and WeekCapacityUSD are summed over the counted
	// accounts; capacity is each account's full week up to its budget line.
	WeekRemainingUSD float64 `json:"week_remaining_usd"`
	WeekCapacityUSD  float64 `json:"week_capacity_usd"`
	// WeekLoad is demand over sustainable supply. Under 1 the pool refills
	// faster than it is spent.
	WeekLoad float64 `json:"week_load"`
	// Over HorizonHours at the last day's demand: the hours with no weekly
	// quota left anywhere, and the share of demand served.
	ShortHours   float64 `json:"short_hours"`
	ServedShare  float64 `json:"served_share"`
	HorizonHours float64 `json:"horizon_hours"`
	// LowestUSD is the least weekly quota left at any moment of the horizon,
	// and LowestHours when; 0 once there is a gap. It moves smoothly where
	// the first gap can jump: a pool that nearly runs dry before a large
	// reset shows a small lowest point either way.
	LowestUSD   float64 `json:"lowest_usd"`
	LowestHours float64 `json:"lowest_hours"`
	// WeekHours is when demand first finds no weekly quota left, and
	// FirstShortHours how long that first gap lasts; nil without a gap.
	WeekHours       *float64 `json:"week_hours"`
	FirstShortHours *float64 `json:"first_short_hours"`
	// FiveHourRemainingUSD and FiveHourHours are read by consoles released
	// before the peak figure; a 5-hour window resets within five hours, so
	// FiveHourHours is not a runway.
	FiveHourRemainingUSD float64  `json:"five_hour_remaining_usd"`
	FiveHourHours        *float64 `json:"five_hour_hours"`
	// Counted accounts have a weekly remainder, capacity and reset time;
	// Unknown ones could serve but lack one of them and add no supply.
	Counted int `json:"counted"`
	Unknown int `json:"unknown"`
	// Curve is the weekly quota left at each whole hour of the horizon,
	// from now: HorizonHours+1 points, cents. Empty without demand.
	Curve []float64 `json:"curve"`
	// ProfileHours is the hours of use the daily shape of demand is drawn
	// from; 0 projects demand flat at its 24-hour average.
	ProfileHours int `json:"profile_hours"`
	// PeakHourUSDPerHour is demand in the busiest hour of the day.
	PeakHourUSDPerHour float64 `json:"peak_hour_usd_per_hour"`
	// GrowthPerDay is how much use grew a day over the last week; the
	// Trend scenario carries it on, damped.
	GrowthPerDay float64 `json:"growth_per_day"`
	// HeadroomScale is the largest multiple of demand the pool serves for
	// the whole horizon without a gap; nil above runwayMaxScale.
	HeadroomScale *float64 `json:"headroom_scale"`
	// Trend projects demand growing on; Low and High scale it to the 10th
	// and 90th percentiles of how past forecasts compared with the use that
	// followed, widened to hold demand as now. Each is nil without the
	// history it needs.
	Trend *EngineRunwayScenario `json:"trend"`
	Low   *EngineRunwayScenario `json:"low"`
	High  *EngineRunwayScenario `json:"high"`
	// BandForecasts is the past forecasts Low and High are drawn from.
	BandForecasts int `json:"band_forecasts"`
	// Addition is how many accounts of runwayAddPlan would close the gap;
	// nil without demand or without a measured account of the plan.
	Addition *EngineRunwayAddition `json:"addition"`
}

// EngineRunwayAddition sizes the accounts to add in one plan, priced by
// what the pool's own accounts of that plan were measured to serve.
type EngineRunwayAddition struct {
	Plan string `json:"plan"`
	Tier string `json:"tier"`
	// WeekUSD is one account's weekly capacity up to its budget line: the
	// plan's median measured account at BudgetPercent.
	WeekUSD       float64 `json:"week_usd"`
	BudgetPercent float64 `json:"budget_percent"`
	Measured      int     `json:"measured"`
	// ForLoad brings the weekly load to 100% at today's demand, ForTrend at
	// the trend's demand at the end of the horizon (ForLoad without one):
	// what keeps the pool from running down week after week.
	ForLoad  int `json:"for_load"`
	ForTrend int `json:"for_trend"`
	// ForWeek is the fewest added accounts, each starting a full week now,
	// that leave the next 7 days without a gap at today's demand; nil when
	// even runwayMaxAddition do not.
	ForWeek *int `json:"for_week"`
}

// EngineRunwayScenario is the projection under another demand.
type EngineRunwayScenario struct {
	// DemandScale is the scenario's demand over the base demand; for the
	// trend, at the end of the horizon.
	DemandScale     float64   `json:"demand_scale"`
	ShortHours      float64   `json:"short_hours"`
	ServedShare     float64   `json:"served_share"`
	WeekHours       *float64  `json:"week_hours"`
	FirstShortHours *float64  `json:"first_short_hours"`
	Curve           []float64 `json:"curve"`
}

type runwayAccount struct {
	remaining float64
	full      float64
	resetMS   int64
}

// runwayMaxScale bounds the headroom search: a pool that lasts at this many
// times its demand is not short of quota.
const runwayMaxScale = 4.0

// The plan additions are sized in, and the most the 7-day search tries.
const (
	runwayAddPlan     = "Max"
	runwayAddTier     = "default_claude_max_5x"
	runwayMaxAddition = 30
)

// poolRunway sets the channel's demand against its quota supply. Over the next
// runwayHorizon, demand runs at the last 24 hours' spend, moved through the
// day by the profile's shape, and is spread over the accounts in proportion
// to what each has left, as the engine's headroom routing roughly does, so
// every account drains at the same rate. At its weekly reset an account
// returns to its full budget, discarding what it had left. When nothing is
// left, demand goes unserved until the next reset. Returns nil when the
// channel has no accounts.
func poolRunway(pool EnginePool, channel string, nowMS int64, profile demandProfile) *EngineRunway {
	groups := make(map[int]EngineGroup, len(pool.Groups))
	for _, group := range pool.Groups {
		groups[group.ID] = group
	}
	hourMS := float64(time.Hour.Milliseconds())
	runway := EngineRunway{Channel: channel, HorizonHours: runwayHorizon.Hours()}
	var accounts []runwayAccount
	seen := false
	for _, account := range pool.Accounts {
		group, ok := groups[account.GroupID]
		if !ok || group.Channel != channel {
			continue
		}
		seen = true
		burn := deref(account.BurnUSDPerHour)
		runway.BurnUSDPerHour += burn
		if !group.Enabled || runwayExcluded[account.Status] {
			continue
		}
		remaining, capacity := account.SevenDayRemainingUSD, account.SevenDayCapacityUSD
		if remaining == nil || capacity == nil || account.SevenDayReset <= 0 {
			runway.Unknown++
			continue
		}
		weekCeiling, fiveCeiling := 1.0, 1.0
		if group.QuotaBudget {
			weekCeiling, fiveCeiling = group.SevenDayBudget/100, group.FiveHourBudget/100
		}
		reset := account.SevenDayReset
		for reset <= nowMS {
			reset += runwayWeek.Milliseconds()
		}
		full := *capacity * weekCeiling
		accounts = append(accounts, runwayAccount{remaining: max(*remaining, 0), full: full, resetMS: reset})
		runway.Counted++
		runway.WeekRemainingUSD += max(*remaining, 0)
		runway.WeekCapacityUSD += full
		runway.FiveHourRemainingUSD += max(deref(account.FiveHourRemainingUSD), 0)
		if five := account.FiveHourCapacityUSD; five != nil {
			runway.PeakUSDPerHour += *five * fiveCeiling / runwayWindow.Hours()
		}
		elapsed := runwayWeek.Hours() - float64(reset-nowMS)/hourMS
		if elapsed >= runwayMinElapsed.Hours() {
			runway.WeekToDateUSDPerHour += *capacity * account.SevenDay / 100 / elapsed
		} else {
			runway.WeekToDateUSDPerHour += burn
		}
	}
	if !seen {
		return nil
	}
	runway.SustainableUSDPerHour = runway.WeekCapacityUSD / runwayWeek.Hours()
	burn := runway.BurnUSDPerHour
	if burn <= 0 {
		runway.ServedShare = 1
		return &runway
	}
	if runway.SustainableUSDPerHour > 0 {
		runway.WeekLoad = burn / runway.SustainableUSDPerHour
	}
	fiveHours := runway.FiveHourRemainingUSD / burn
	runway.FiveHourHours = &fiveHours
	runway.ProfileHours = profile.hours
	runway.PeakHourUSDPerHour = burn * profile.peak()
	runway.GrowthPerDay = profile.growthPerDay()

	at := func(scale float64) func(ms int64) float64 {
		return func(ms int64) float64 { return burn * scale * profile.at(ms) }
	}
	base := projectRunway(accounts, nowMS, at(1))
	runway.ShortHours, runway.ServedShare = base.ShortHours, base.ServedShare
	runway.LowestUSD, runway.LowestHours = base.lowestUSD, base.lowestHours
	runway.WeekHours, runway.FirstShortHours, runway.Curve = base.WeekHours, base.FirstShortHours, base.Curve

	if profile.growth != 0 {
		trend := projectRunway(accounts, nowMS, func(ms int64) float64 {
			return at(profile.growthAt(float64(ms-nowMS) / hourMS / 24))(ms)
		})
		trend.DemandScale = profile.growthAt(runwayHorizon.Hours() / 24)
		runway.Trend = &trend.EngineRunwayScenario
	}
	if profile.origins > 0 {
		// The band holds demand as now, even when past forecasts all fell
		// short of the use that followed.
		lowScale, highScale := min(profile.low, 1), max(profile.high, 1)
		low, high := projectRunway(accounts, nowMS, at(lowScale)), projectRunway(accounts, nowMS, at(highScale))
		low.DemandScale, high.DemandScale = lowScale, highScale
		runway.Low, runway.High, runway.BandForecasts = &low.EngineRunwayScenario, &high.EngineRunwayScenario, profile.origins
	}

	// The largest scale without a gap, to within 0.1% of demand.
	if projectRunway(accounts, nowMS, at(runwayMaxScale)).WeekHours != nil {
		lo, hi := 0.0, runwayMaxScale
		for hi-lo > 0.001 {
			mid := (lo + hi) / 2
			if projectRunway(accounts, nowMS, at(mid)).WeekHours == nil {
				lo = mid
			} else {
				hi = mid
			}
		}
		runway.HeadroomScale = &lo
	}
	runway.Addition = runwayAddition(pool, groups, channel, &runway, accounts, nowMS, at(1))
	return &runway
}

// runwayAddition sizes runwayAddPlan accounts against the runway's demand.
// One account adds its plan's median measured weekly capacity, up to the
// budget line of the group its plan's accounts are in. Nil without a
// measured account of the plan.
func runwayAddition(pool EnginePool, groups map[int]EngineGroup, channel string, runway *EngineRunway,
	accounts []runwayAccount, nowMS int64, rate func(ms int64) float64) *EngineRunwayAddition {
	var value *EnginePlanValue
	for _, plan := range EnginePlanValues(pool.Accounts) {
		if plan.Plan == runwayAddPlan && plan.Tier == runwayAddTier {
			value = &plan
			break
		}
	}
	if value == nil {
		return nil
	}
	budget := 100.0
	for _, account := range pool.Accounts {
		group, ok := groups[account.GroupID]
		if ok && group.Channel == channel && account.Plan == runwayAddPlan && account.Tier == runwayAddTier {
			if group.QuotaBudget {
				budget = group.SevenDayBudget
			}
			break
		}
	}
	week := value.WeekUSD * budget / 100
	if week <= 0 {
		return nil
	}
	addition := EngineRunwayAddition{
		Plan: value.Plan, Tier: value.Tier, WeekUSD: week, BudgetPercent: budget, Measured: value.Measured,
	}
	// Whole accounts: a shortfall of a cent still takes one.
	closing := func(demand float64) int {
		short := (demand - runway.SustainableUSDPerHour) * runwayWeek.Hours()
		if short <= 0 {
			return 0
		}
		return int(math.Ceil(short/week - 1e-9))
	}
	addition.ForLoad = closing(runway.BurnUSDPerHour)
	addition.ForTrend = addition.ForLoad
	if runway.Trend != nil {
		addition.ForTrend = closing(runway.BurnUSDPerHour * runway.Trend.DemandScale)
	}
	weekEnd := nowMS + runwayWeek.Milliseconds()
	added := append([]runwayAccount(nil), accounts...)
	for count := 0; count <= runwayMaxAddition; count++ {
		if projectRunway(added, nowMS, rate).WeekHours == nil {
			addition.ForWeek = &count
			break
		}
		added = append(added, runwayAccount{remaining: week, full: week, resetMS: weekEnd})
	}
	return &addition
}

type runwayProjection struct {
	EngineRunwayScenario
	lowestUSD   float64
	lowestHours float64
}

// projectRunway runs the accounts forward over runwayHorizon from nowMS at
// demand rate(ms) dollars an hour, which holds within each UTC clock hour.
// It steps from one clock hour, reset, or curve sample to the next. A reset
// is applied before the sample at the same moment, so a reset on the hour
// reads as refilled.
func projectRunway(start []runwayAccount, nowMS int64, rate func(ms int64) float64) runwayProjection {
	accounts := append([]runwayAccount(nil), start...)
	hour := time.Hour.Milliseconds()
	hourMS := float64(hour)
	endMS := nowMS + runwayHorizon.Milliseconds()
	result := runwayProjection{EngineRunwayScenario: EngineRunwayScenario{
		DemandScale: 1, Curve: make([]float64, 0, int(runwayHorizon.Hours())+1),
	}}
	left := 0.0
	for _, account := range accounts {
		left += account.remaining
	}
	result.lowestUSD = left
	served, demanded := 0.0, 0.0
	firstOpen := false
	sample := func(ms int64) {
		for len(result.Curve) <= int(runwayHorizon.Hours()) && nowMS+int64(len(result.Curve))*hour <= ms {
			result.Curve = append(result.Curve, math.Round(left*100)/100)
		}
	}
	for atMS := nowMS; atMS < endMS; {
		for i := range accounts {
			if accounts[i].resetMS <= atMS {
				left += accounts[i].full - accounts[i].remaining
				accounts[i].remaining = accounts[i].full
				accounts[i].resetMS += runwayWeek.Milliseconds()
			}
		}
		sample(atMS)
		untilMS := min(endMS, (atMS/hour+1)*hour, nowMS+int64(len(result.Curve))*hour)
		for _, account := range accounts {
			untilMS = min(untilMS, account.resetMS)
		}
		span := float64(untilMS-atMS) / hourMS
		perHour := rate(atMS)
		need := perHour * span
		demanded += need
		if left > 0 {
			firstOpen = false
		}
		switch {
		case need <= 0:
			// A quiet hour inside a gap is still an hour without quota.
			if left <= 0 && result.WeekHours != nil {
				result.ShortHours += span
				if firstOpen {
					*result.FirstShortHours += span
				}
			}
		case need >= left:
			lasts := left / perHour
			if result.WeekHours == nil {
				startHours := float64(atMS-nowMS)/hourMS + lasts
				length := 0.0
				result.WeekHours, result.FirstShortHours = &startHours, &length
				firstOpen = true
			}
			if firstOpen {
				*result.FirstShortHours += span - lasts
			}
			result.ShortHours += span - lasts
			if result.lowestUSD > 0 {
				result.lowestUSD, result.lowestHours = 0, float64(atMS-nowMS)/hourMS+lasts
			}
			served += left
			left = 0
			for i := range accounts {
				accounts[i].remaining = 0
			}
		default:
			scale := (left - need) / left
			served += need
			left -= need
			if left < result.lowestUSD {
				result.lowestUSD, result.lowestHours = left, float64(untilMS-nowMS)/hourMS
			}
			for i := range accounts {
				accounts[i].remaining *= scale
			}
		}
		atMS = untilMS
	}
	sample(endMS)
	result.ServedShare = 1
	if demanded > 0 {
		result.ServedShare = served / demanded
	}
	return result
}

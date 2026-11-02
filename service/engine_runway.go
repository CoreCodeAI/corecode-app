package service

import "time"

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
}

type runwayAccount struct {
	remaining float64
	full      float64
	resetMS   int64
}

// poolRunway sets the channel's demand against its quota supply. Over the next
// runwayHorizon, at the last 24 hours' spend, demand is spread over the
// accounts in proportion to what each has left, as the engine's headroom
// routing roughly does, so every account drains at the same rate. At its
// weekly reset an account returns to its full budget, discarding what it had
// left. When nothing is left, demand goes unserved until the next reset.
// Returns nil when the channel has no accounts.
func poolRunway(pool EnginePool, channel string, nowMS int64) *EngineRunway {
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

	endMS := nowMS + runwayHorizon.Milliseconds()
	atMS, left, served := nowMS, runway.WeekRemainingUSD, 0.0
	runway.LowestUSD = left
	for {
		next := -1
		for i, account := range accounts {
			if next < 0 || account.resetMS < accounts[next].resetMS {
				next = i
			}
		}
		untilMS := endMS
		if next >= 0 && accounts[next].resetMS < endMS {
			untilMS = accounts[next].resetMS
		}
		span := float64(untilMS-atMS) / hourMS
		need := burn * span
		switch {
		case span <= 0:
		case need >= left:
			lasts := left / burn
			if runway.WeekHours == nil {
				start := float64(atMS-nowMS)/hourMS + lasts
				length := span - lasts
				runway.WeekHours, runway.FirstShortHours = &start, &length
			}
			runway.ShortHours += span - lasts
			if runway.LowestUSD > 0 {
				runway.LowestUSD, runway.LowestHours = 0, float64(atMS-nowMS)/hourMS+lasts
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
			if left < runway.LowestUSD {
				runway.LowestUSD, runway.LowestHours = left, float64(untilMS-nowMS)/hourMS
			}
			for i := range accounts {
				accounts[i].remaining *= scale
			}
		}
		if untilMS == endMS {
			break
		}
		left += accounts[next].full - accounts[next].remaining
		accounts[next].remaining = accounts[next].full
		accounts[next].resetMS += runwayWeek.Milliseconds()
		atMS = untilMS
	}
	runway.ServedShare = served / (burn * runwayHorizon.Hours())
	return &runway
}

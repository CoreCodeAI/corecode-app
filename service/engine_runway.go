package service

import "time"

const (
	// runwayHorizon is how far the runway looks ahead. Every account resets
	// its week within the first seven days, so a pool still serving after two
	// weeks is close to its steady state; the load says whether it lasts.
	runwayHorizon = 14 * 24 * time.Hour
	runwayWeek    = 7 * 24 * time.Hour
)

// runwayExcluded are statuses the engine leaves out of its estimate: these
// accounts serve nothing until an operator acts, so they add no supply.
var runwayExcluded = map[string]bool{
	"suspended":                true,
	"disabled":                 true,
	"blacklisted":              true,
	"reauthorization_required": true,
}

// EngineRunway is how long one channel's pool lasts at its recent spend.
type EngineRunway struct {
	Channel string `json:"channel"`
	// BurnUSDPerHour is the channel's demand: every account's logged spend
	// over the last 24 hours, per hour, including accounts paused now, since
	// their traffic moves to the others.
	BurnUSDPerHour float64 `json:"burn_usd_per_hour"`
	// WeekRemainingUSD and WeekCapacityUSD are summed over the counted
	// accounts; capacity is each account's full week up to its budget line.
	WeekRemainingUSD float64 `json:"week_remaining_usd"`
	WeekCapacityUSD  float64 `json:"week_capacity_usd"`
	// WeekLoad is a week of demand over a week of capacity. Under 1 the pool
	// refills faster than it is spent.
	WeekLoad float64 `json:"week_load"`
	// WeekHours is when demand first finds no weekly quota left; nil when the
	// pool still serves at HorizonHours, or when nothing was spent.
	WeekHours    *float64 `json:"week_hours"`
	HorizonHours float64  `json:"horizon_hours"`
	// FiveHourHours is the counted accounts' 5-hour remainder at that demand.
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

// poolRunway projects how long the channel's weekly quota lasts at the spend
// of the last 24 hours. Between resets the demand is spread over the accounts
// in proportion to what each has left, as the engine's headroom routing
// roughly does, so every account drains at the same rate and none is left
// with quota it cannot spend. At its weekly reset an account returns to its
// full budget, discarding what it had left. Returns nil when the channel has
// no accounts.
func poolRunway(pool EnginePool, channel string, nowMS int64) *EngineRunway {
	groups := make(map[int]EngineGroup, len(pool.Groups))
	for _, group := range pool.Groups {
		groups[group.ID] = group
	}
	runway := EngineRunway{Channel: channel, HorizonHours: runwayHorizon.Hours()}
	var accounts []runwayAccount
	seen := false
	for _, account := range pool.Accounts {
		group, ok := groups[account.GroupID]
		if !ok || group.Channel != channel {
			continue
		}
		seen = true
		runway.BurnUSDPerHour += deref(account.BurnUSDPerHour)
		if !group.Enabled || runwayExcluded[account.Status] {
			continue
		}
		remaining, capacity := account.SevenDayRemainingUSD, account.SevenDayCapacityUSD
		if remaining == nil || capacity == nil || account.SevenDayReset <= 0 {
			runway.Unknown++
			continue
		}
		ceiling := 1.0
		if group.QuotaBudget {
			ceiling = group.SevenDayBudget / 100
		}
		reset := account.SevenDayReset
		for reset <= nowMS {
			reset += runwayWeek.Milliseconds()
		}
		accounts = append(accounts, runwayAccount{remaining: max(*remaining, 0), full: *capacity * ceiling, resetMS: reset})
		runway.Counted++
		runway.WeekRemainingUSD += max(*remaining, 0)
		runway.WeekCapacityUSD += *capacity * ceiling
		runway.FiveHourRemainingUSD += max(deref(account.FiveHourRemainingUSD), 0)
	}
	if !seen {
		return nil
	}
	burn := runway.BurnUSDPerHour
	if burn <= 0 {
		return &runway
	}
	if runway.WeekCapacityUSD > 0 {
		runway.WeekLoad = burn * runwayWeek.Hours() / runway.WeekCapacityUSD
	}
	fiveHours := runway.FiveHourRemainingUSD / burn
	runway.FiveHourHours = &fiveHours

	hourMS := float64(time.Hour.Milliseconds())
	endMS := nowMS + runwayHorizon.Milliseconds()
	atMS, left := nowMS, runway.WeekRemainingUSD
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
		spend := burn * float64(untilMS-atMS) / hourMS
		if spend >= left {
			hours := (float64(atMS-nowMS) + left/burn*hourMS) / hourMS
			runway.WeekHours = &hours
			return &runway
		}
		if untilMS == endMS {
			return &runway
		}
		scale := (left - spend) / left
		left = 0
		for i := range accounts {
			accounts[i].remaining *= scale
			if i == next {
				accounts[i].remaining = accounts[i].full
				accounts[i].resetMS += runwayWeek.Milliseconds()
			}
			left += accounts[i].remaining
		}
		atMS = untilMS
	}
}

package model

import (
	"cmp"
	"math"
	"slices"
)

// The usage movers say where a change in spending came from: each customer's
// spend in the range against their usual level before it, the customers
// grouped by why they moved, and the ones who grew the most.
//
// The usual level is the spend of the baseline: the range's length or seven
// days before the range's start, whichever is longer, scaled to the range's
// length. A 24-hour range is weighed against the average day of the week
// before it, so one busy or quiet day before it does not set the bar. It costs
// one grouped read of quota_data (one row per customer), one read of the
// accounts registered since the baseline began, and three small reads for the
// risers listed.
const (
	// moversListed is how many of the customers who grew the most are named.
	moversListed = 20
	// moversBaselineMinDays is the shortest baseline: a shorter range is
	// weighed against its average over this many days.
	moversBaselineMinDays = 7
)

// Why a customer's spend moved, by when they registered and what they spent
// in the baseline.
const (
	// MoverNew registered in the range.
	MoverNew = "new"
	// MoverRecent registered in the baseline, so their usual level counts days
	// before they existed.
	MoverRecent = "recent"
	// MoverReturning registered before the baseline and spent nothing in it.
	MoverReturning = "returning"
	// MoverGrowing spent at least their usual level.
	MoverGrowing = "growing"
	// MoverShrinking spent less than their usual level, nothing included.
	MoverShrinking = "shrinking"
)

var moverKinds = []string{MoverNew, MoverRecent, MoverReturning, MoverGrowing, MoverShrinking}

// UsageMoverGroup is the customers of one kind: how many, what they spent in
// the range and at their usual level, and the difference. Money is in quota
// dollars.
type UsageMoverGroup struct {
	Kind        string  `json:"kind"`
	Customers   int64   `json:"customers"`
	CurrentUSD  float64 `json:"current_usd"`
	BaselineUSD float64 `json:"baseline_usd"`
	DeltaUSD    float64 `json:"delta_usd"`
}

// UsageMover is one of the customers whose spend grew the most over their
// usual level. TopupPaid and SubscriptionPaid are everything they ever paid,
// in the payment currency; the rest of the money is in quota dollars.
// InviterID is the account that invited them, zero when none did. MainModel
// is the model with the most spend in the range.
type UsageMover struct {
	UserRef
	Kind             string  `json:"kind"`
	Remark           string  `json:"remark"`
	RegisteredAt     int64   `json:"registered_at"`
	InviterID        int     `json:"inviter_id"`
	TopupPaid        float64 `json:"topup_paid"`
	SubscriptionPaid float64 `json:"subscription_paid"`
	CurrentUSD       float64 `json:"current_usd"`
	BaselineUSD      float64 `json:"baseline_usd"`
	DeltaUSD         float64 `json:"delta_usd"`
	MainModel        string  `json:"main_model"`
}

// UsageMovers is the movers block of the customers view. BaselineStart is
// where the baseline begins (it ends at the range's start) and BaselineDays
// its length in days. CurrentUSD is the range's spend, BaselineUSD the usual
// level of the same customers, DeltaUSD the difference. Groups holds every
// kind in a fixed order, and Risers the customers who grew the most, largest
// first.
type UsageMovers struct {
	BaselineStart int64             `json:"baseline_start"`
	BaselineDays  float64           `json:"baseline_days"`
	CurrentUSD    float64           `json:"current_usd"`
	BaselineUSD   float64           `json:"baseline_usd"`
	DeltaUSD      float64           `json:"delta_usd"`
	Groups        []UsageMoverGroup `json:"groups"`
	Risers        []UsageMover      `json:"risers"`
}

// readUsageMovers weighs the range's spend per customer (rangeQuota, staff
// already left out) against each one's usual level. modelQuota is the range's
// spend per customer and model, for the risers' main model.
func readUsageMovers(r InsightsRange, staff map[int]bool, rangeQuota map[int]int64,
	modelQuota map[int]map[string]int64) (*UsageMovers, error) {
	span := r.End - r.Start
	if span <= 0 {
		span = 1
	}
	baselineStart := insightHourKey(r.Start - max(span, moversBaselineMinDays*86400))
	baselineSpan := r.Start - baselineStart
	scale := float64(span) / float64(baselineSpan)

	var baselineRows []struct {
		UserId int
		Quota  int64
	}
	if err := DB.Model(&QuotaData{}).
		Select("user_id, SUM(quota) AS quota").
		Where("created_at >= ? AND created_at < ?", baselineStart, r.Start).
		Group("user_id").Find(&baselineRows).Error; err != nil {
		return nil, err
	}
	baseline := make(map[int]float64, len(baselineRows))
	for _, row := range baselineRows {
		if !staff[row.UserId] && row.Quota > 0 {
			baseline[row.UserId] = float64(row.Quota) * scale
		}
	}

	// Only accounts registered since the baseline began are new or recent; the
	// rest are older, so the read stays as small as the site's sign-ups.
	var registered []struct {
		Id        int
		CreatedAt int64
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, created_at").
		Where("created_at >= ?", baselineStart).Find(&registered).Error; err != nil {
		return nil, err
	}
	registeredAt := make(map[int]int64, len(registered))
	for _, user := range registered {
		registeredAt[user.Id] = user.CreatedAt
	}

	type mover struct {
		id                int
		kind              string
		current, baseline float64
	}
	movers := make([]mover, 0, len(rangeQuota)+len(baseline))
	add := func(id int) {
		current, usual := float64(rangeQuota[id]), baseline[id]
		var kind string
		switch at, recent := registeredAt[id]; {
		case recent && at >= r.Start:
			kind = MoverNew
		case recent:
			kind = MoverRecent
		case usual == 0:
			kind = MoverReturning
		case current >= usual:
			kind = MoverGrowing
		default:
			kind = MoverShrinking
		}
		movers = append(movers, mover{id: id, kind: kind, current: current, baseline: usual})
	}
	for id := range rangeQuota {
		add(id)
	}
	for id := range baseline {
		if _, spent := rangeQuota[id]; !spent {
			add(id)
		}
	}

	type tally struct {
		customers         int64
		current, baseline float64
	}
	tallies := make(map[string]*tally, len(moverKinds))
	var total tally
	for _, m := range movers {
		kind := tallies[m.kind]
		if kind == nil {
			kind = &tally{}
			tallies[m.kind] = kind
		}
		for _, sum := range []*tally{kind, &total} {
			sum.customers++
			sum.current += m.current
			sum.baseline += m.baseline
		}
	}
	result := &UsageMovers{BaselineStart: baselineStart, BaselineDays: roundTo(float64(baselineSpan)/86400, 2),
		CurrentUSD: scaledUSD(total.current), BaselineUSD: scaledUSD(total.baseline), DeltaUSD: scaledUSD(total.current - total.baseline),
		Groups: make([]UsageMoverGroup, 0, len(moverKinds)), Risers: []UsageMover{}}
	for _, kind := range moverKinds {
		sum := tallies[kind]
		if sum == nil {
			sum = &tally{}
		}
		result.Groups = append(result.Groups, UsageMoverGroup{Kind: kind, Customers: sum.customers,
			CurrentUSD: scaledUSD(sum.current), BaselineUSD: scaledUSD(sum.baseline), DeltaUSD: scaledUSD(sum.current - sum.baseline)})
	}

	slices.SortFunc(movers, func(a, b mover) int {
		return cmp.Or(cmp.Compare(b.current-b.baseline, a.current-a.baseline), cmp.Compare(a.id, b.id))
	})
	risers := make([]mover, 0, moversListed)
	for _, m := range movers {
		if len(risers) == moversListed || m.current <= m.baseline {
			break
		}
		risers = append(risers, m)
	}
	if len(risers) == 0 {
		return result, nil
	}

	ids := make([]int, len(risers))
	for i, m := range risers {
		ids[i] = m.id
	}
	var users []struct {
		Id        int
		Username  string
		Remark    string
		CreatedAt int64
		InviterId int
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, username, remark, created_at, inviter_id").
		Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	details := make(map[int]int, len(users))
	for i, user := range users {
		details[user.Id] = i
	}
	accounts, err := ReadUserSpendAccounts(ids)
	if err != nil {
		return nil, err
	}
	for _, m := range risers {
		riser := UsageMover{
			UserRef: UserRef{UserID: m.id}, Kind: m.kind,
			CurrentUSD: scaledUSD(m.current), BaselineUSD: scaledUSD(m.baseline), DeltaUSD: scaledUSD(m.current - m.baseline),
			MainModel: topModel(modelQuota[m.id]),
		}
		if i, found := details[m.id]; found {
			user := users[i]
			riser.Username, riser.Remark, riser.RegisteredAt, riser.InviterID = user.Username, user.Remark, user.CreatedAt, user.InviterId
		}
		if account := accounts[m.id]; account != nil {
			riser.TopupPaid, riser.SubscriptionPaid = account.TopupPaid, account.SubscriptionPaid
		}
		result.Risers = append(result.Risers, riser)
	}
	return result, nil
}

// scaledUSD is quotaUSD for a quota the baseline's scale has made fractional.
func scaledUSD(quota float64) float64 {
	return quotaUSD(int64(math.Round(quota)))
}

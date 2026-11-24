package model

import (
	"cmp"
	"slices"
)

// The customers view names who the money comes from: the biggest customers of
// the range with their account history, how concentrated spending is, and the
// customers among the month's biggest whose use has dropped off.
//
// It is read-only and cheap by design. Three grouped reads of quota_data reach the
// database: the range by customer and model, the thirty days to the range's end
// by customer (one row each), and the same thirty days by hour for only the
// customers shown or watched (at most seventy). The rows stay in the database
// and only their sums arrive. The twenty customers shown cost four small reads
// more (accounts, payments, keys, names).
const (
	// customersListed is how many customers the profile table names.
	customersListed = 20
	// churnWatched is how many of the month's biggest customers are watched for a drop in use.
	churnWatched = 50
	// churnWindowDays is the month the watched customers are chosen from.
	churnWindowDays = 30
	// churnDropShare: a customer whose last seven days came to less than this
	// share of the seven before them has dropped off.
	churnDropShare = 0.5
	// churnIdleDays: a customer with no request in this many days has gone quiet.
	churnIdleDays = 3
	// customerTrendDays is the length of the daily trend of a listed customer.
	customerTrendDays = 7
)

// CustomerProfile is one of the range's biggest customers. Quota figures are in
// quota dollars (what new-api charged, ¥1 each) except TopupPaid and
// SubscriptionPaid, which are in the payment currency (top_ups.money).
// LifetimeUSD is everything the account ever spent, BalanceUSD what is left in
// the wallet. Trend is the account's spend in each of the last seven days
// counted back from the range's end in blocks of 24 hours, oldest first.
// MainModel is the model with the most spend in the range; MainGroup the group
// of the key that has spent the most over the account's life, since request
// rollups do not keep a group. LastUsedAt is when a key last spent quota
// (zero when none has), and ActiveDays the days of the last thirty (24-hour
// blocks back from the range's end) with a request.
type CustomerProfile struct {
	UserRef
	Remark           string    `json:"remark"`
	RegisteredAt     int64     `json:"registered_at"`
	TopupPaid        float64   `json:"topup_paid"`
	SubscriptionPaid float64   `json:"subscription_paid"`
	LifetimeUSD      float64   `json:"lifetime_usd"`
	BalanceUSD       float64   `json:"balance_usd"`
	QuotaUSD         float64   `json:"quota_usd"`
	Share            float64   `json:"share"`
	Trend            []float64 `json:"trend"`
	MainModel        string    `json:"main_model"`
	MainGroup        string    `json:"main_group"`
	LastUsedAt       int64     `json:"last_used_at"`
	ActiveDays       int64     `json:"active_days"`
}

// Why a customer is on the churn list.
const (
	ChurnDropped = "dropped"
	ChurnIdle    = "idle"
)

// ChurnWarning is a customer among the thirty days' biggest whose use dropped:
// Last7USD and Previous7USD are their spend in the last seven days and the
// seven before, counted back from the range's end in blocks of 24 hours;
// Reasons says which rule flagged them (ChurnDropped: the last seven days came
// to under half the previous seven; ChurnIdle: no request in the last three
// days). A customer with nothing in the previous seven days cannot have
// dropped. LastRequestAt is the start of the last hour with a request.
type ChurnWarning struct {
	UserRef
	MonthUSD      float64  `json:"month_usd"`
	Last7USD      float64  `json:"last7_usd"`
	Previous7USD  float64  `json:"previous7_usd"`
	LastRequestAt int64    `json:"last_request_at"`
	Reasons       []string `json:"reasons"`
}

// CustomerInsights is the customers view. CustomersSpending counts the
// customers with spend in the range and TotalUSD what they spent; Top5Share,
// Top10Share and Top20Share are the largest customers' share of it. Watched is
// how many customers the churn list chose from (up to churnWatched, fewer on a
// small site).
type CustomerInsights struct {
	CustomersSpending int64             `json:"customers_spending"`
	TotalUSD          float64           `json:"total_usd"`
	Top5Share         float64           `json:"top5_share"`
	Top10Share        float64           `json:"top10_share"`
	Top20Share        float64           `json:"top20_share"`
	Top               []CustomerProfile `json:"top"`
	Watched           int64             `json:"watched"`
	Churn             []ChurnWarning    `json:"churn"`
}

type customerRangeRow struct {
	UserId    int
	ModelName string
	Quota     int64
}

type customerHourRow struct {
	UserId    int
	CreatedAt int64
	Quota     int64
	Count     int64 `gorm:"column:requests"`
}

// customerBlock is one customer's use in a 24-hour block counted back from the
// range's end.
type customerBlock struct {
	quota    int64
	requests int64
}

// customerMonth is a customer's thirty days: the blocks, and the last hour
// with a request.
type customerMonth struct {
	blocks      [churnWindowDays]customerBlock
	total       int64
	lastRequest int64
}

func GetCustomerInsights(r InsightsRange) (*CustomerInsights, error) {
	staffIDs, err := StaffUserIDs()
	if err != nil {
		return nil, err
	}
	staff := make(map[int]bool, len(staffIDs))
	for _, id := range staffIDs {
		staff[id] = true
	}

	var rangeRows []customerRangeRow
	if err := DB.Model(&QuotaData{}).
		Select("user_id, model_name, SUM(quota) AS quota").
		Where("created_at >= ? AND created_at < ?", insightHourKey(r.Start), r.End).
		Group("user_id, model_name").Find(&rangeRows).Error; err != nil {
		return nil, err
	}
	rangeQuota := make(map[int]int64)
	modelQuota := make(map[int]map[string]int64)
	var total int64
	for _, row := range rangeRows {
		if staff[row.UserId] || row.Quota <= 0 {
			continue
		}
		rangeQuota[row.UserId] += row.Quota
		total += row.Quota
		if modelQuota[row.UserId] == nil {
			modelQuota[row.UserId] = make(map[string]int64)
		}
		modelQuota[row.UserId][row.ModelName] += row.Quota
	}

	// The month's spend per customer first: one row each, however many hours
	// they were active. Only the customers shown or watched then get their
	// hourly rows, so the read does not scale with the site's traffic.
	windowStart := insightHourKey(r.End - churnWindowDays*86400)
	var monthRows []struct {
		UserId int
		Quota  int64
	}
	if err := DB.Model(&QuotaData{}).
		Select("user_id, SUM(quota) AS quota").
		Where("created_at >= ? AND created_at < ?", windowStart, r.End).
		Group("user_id").Find(&monthRows).Error; err != nil {
		return nil, err
	}
	monthTotal := make(map[int]int64, len(monthRows))
	for _, row := range monthRows {
		if !staff[row.UserId] && row.Quota > 0 {
			monthTotal[row.UserId] = row.Quota
		}
	}

	result := &CustomerInsights{CustomersSpending: int64(len(rangeQuota)), TotalUSD: quotaUSD(total),
		Top: []CustomerProfile{}, Churn: []ChurnWarning{}}
	ranked := make([]int, 0, len(rangeQuota))
	for id := range rangeQuota {
		ranked = append(ranked, id)
	}
	slices.SortFunc(ranked, func(a, b int) int {
		return cmp.Or(cmp.Compare(rangeQuota[b], rangeQuota[a]), cmp.Compare(a, b))
	})
	topShare := func(n int) float64 {
		var sum int64
		for _, id := range ranked[:min(n, len(ranked))] {
			sum += rangeQuota[id]
		}
		return ratio(float64(sum), float64(total))
	}
	result.Top5Share, result.Top10Share, result.Top20Share = topShare(5), topShare(10), topShare(20)
	top := ranked[:min(customersListed, len(ranked))]

	// The month's biggest customers, whatever the range was.
	monthly := make([]int, 0, len(monthTotal))
	for id := range monthTotal {
		monthly = append(monthly, id)
	}
	slices.SortFunc(monthly, func(a, b int) int {
		return cmp.Or(cmp.Compare(monthTotal[b], monthTotal[a]), cmp.Compare(a, b))
	})
	watched := monthly[:min(churnWatched, len(monthly))]
	result.Watched = int64(len(watched))

	var hourRows []customerHourRow
	if err := DB.Model(&QuotaData{}).
		Select("user_id, created_at, SUM(quota) AS quota, SUM(count) AS requests").
		Where("created_at >= ? AND created_at < ? AND user_id IN ?", windowStart, r.End, slices.Concat(top, watched)).
		Group("user_id, created_at").Find(&hourRows).Error; err != nil {
		return nil, err
	}
	months := make(map[int]*customerMonth)
	for _, row := range hourRows {
		block := int((r.End - row.CreatedAt - 1) / 86400)
		if block < 0 || block >= churnWindowDays {
			continue
		}
		month := months[row.UserId]
		if month == nil {
			month = &customerMonth{}
			months[row.UserId] = month
		}
		month.blocks[block].quota += row.Quota
		month.blocks[block].requests += row.Count
		month.total += row.Quota
		if row.Count > 0 && row.CreatedAt > month.lastRequest {
			month.lastRequest = row.CreatedAt
		}
	}

	var warned []int
	for _, id := range watched {
		month := months[id]
		if month == nil {
			continue
		}
		var last7, previous7, recent int64
		for i, block := range month.blocks {
			switch {
			case i < 7:
				last7 += block.quota
			case i < 14:
				previous7 += block.quota
			}
			if i < churnIdleDays {
				recent += block.requests
			}
		}
		var reasons []string
		if previous7 > 0 && float64(last7) < float64(previous7)*churnDropShare {
			reasons = append(reasons, ChurnDropped)
		}
		if recent == 0 {
			reasons = append(reasons, ChurnIdle)
		}
		if len(reasons) == 0 {
			continue
		}
		warned = append(warned, id)
		result.Churn = append(result.Churn, ChurnWarning{
			UserRef: UserRef{UserID: id}, MonthUSD: quotaUSD(month.total), Last7USD: quotaUSD(last7),
			Previous7USD: quotaUSD(previous7), LastRequestAt: month.lastRequest, Reasons: reasons,
		})
	}

	wanted := slices.Concat(top, warned)
	names, err := usernamesByID(wanted)
	if err != nil {
		return nil, err
	}
	for i := range result.Churn {
		result.Churn[i].Username = names[result.Churn[i].UserID]
	}
	if len(top) == 0 {
		return result, nil
	}

	accounts, err := ReadUserSpendAccounts(top)
	if err != nil {
		return nil, err
	}
	var users []struct {
		Id        int
		Remark    string
		CreatedAt int64
		UsedQuota int64
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, remark, created_at, used_quota").Where("id IN ?", top).Find(&users).Error; err != nil {
		return nil, err
	}
	details := make(map[int]struct {
		Remark    string
		CreatedAt int64
		UsedQuota int64
	}, len(users))
	for _, user := range users {
		details[user.Id] = struct {
			Remark    string
			CreatedAt int64
			UsedQuota int64
		}{user.Remark, user.CreatedAt, user.UsedQuota}
	}
	var keys []struct {
		UserId       int
		Group        string `gorm:"column:key_group"`
		UsedQuota    int64
		AccessedTime int64
	}
	if err := DB.Model(&Token{}).Select("user_id, "+commonGroupCol+" AS key_group, used_quota, accessed_time").
		Where("user_id IN ?", top).Find(&keys).Error; err != nil {
		return nil, err
	}
	mainGroup := make(map[int]string, len(top))
	mainGroupQuota := make(map[int]int64, len(top))
	lastUsed := make(map[int]int64, len(top))
	for _, key := range keys {
		lastUsed[key.UserId] = max(lastUsed[key.UserId], key.AccessedTime)
		if _, seen := mainGroupQuota[key.UserId]; !seen || key.UsedQuota > mainGroupQuota[key.UserId] {
			mainGroupQuota[key.UserId] = key.UsedQuota
			mainGroup[key.UserId] = key.Group
		}
	}
	for _, id := range top {
		profile := CustomerProfile{
			UserRef:   UserRef{UserID: id, Username: names[id]},
			QuotaUSD:  quotaUSD(rangeQuota[id]),
			Share:     ratio(float64(rangeQuota[id]), float64(total)),
			Trend:     make([]float64, customerTrendDays),
			MainModel: topModel(modelQuota[id]),
			MainGroup: mainGroup[id],
		}
		if account := accounts[id]; account != nil {
			profile.TopupPaid = account.TopupPaid
			profile.SubscriptionPaid = account.SubscriptionPaid
			profile.BalanceUSD = quotaUSD(account.BalanceQuota)
		}
		detail := details[id]
		profile.Remark, profile.RegisteredAt, profile.LifetimeUSD = detail.Remark, detail.CreatedAt, quotaUSD(detail.UsedQuota)
		profile.LastUsedAt = lastUsed[id]
		if month := months[id]; month != nil {
			for i := range customerTrendDays {
				// Oldest first: the last element is the newest block.
				profile.Trend[customerTrendDays-1-i] = quotaUSD(month.blocks[i].quota)
			}
			for _, block := range month.blocks {
				if block.requests > 0 {
					profile.ActiveDays++
				}
			}
			profile.LastUsedAt = max(profile.LastUsedAt, month.lastRequest)
		}
		result.Top = append(result.Top, profile)
	}
	return result, nil
}

// topModel is the model with the most quota, the name first on a tie.
func topModel(quotas map[string]int64) string {
	var best string
	var most int64
	for name, quota := range quotas {
		if quota > most || (quota == most && best != "" && name < best) {
			best, most = name, quota
		}
	}
	return best
}

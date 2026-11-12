package service

import (
	"cmp"
	"context"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"golang.org/x/sync/singleflight"
)

// UserSpendWindowHours are the spans the funds view's user table reads, from
// the last hour to the last week.
var UserSpendWindowHours = []int64{1, 5, 12, 24, 168}

const (
	// userSpendTopN is how many customers the table lists, largest first.
	userSpendTopN = 100
	// userSpendTTL is how long one read of a window is shared.
	userSpendTTL = time.Minute
)

// UserSpend is what each customer used over the Hours before EndTime: new-api's
// charge, and gpt-load's official-price cost shared out to them.
//
// gpt-load does not know which new-api user sent a request: every request
// reaches it with the same channel key. It reports its cost by channel and
// model, so each model's cost is shared among the users of that model in
// proportion to what new-api charged them for it, with the group's ratio
// taken out so a group with a higher price does not take a larger share.
// The cost of models gpt-load reports only as a remainder is shared the same
// way over the provider's other models.
//
// QuotaUSD figures are new-api quota dollars, which customers pay ¥1 each
// for; EngineUSD figures are US dollars at official prices. Root's own use is
// counted apart and is not in Users.
type UserSpend struct {
	Hours            int64   `json:"hours"`
	StartTime        int64   `json:"start_time"`
	EndTime          int64   `json:"end_time"`
	USDExchangeRate  float64 `json:"usd_exchange_rate"`
	EngineConfigured bool    `json:"engine_configured"`
	// EngineError is set when gpt-load could not be read; every EngineUSD is
	// then zero.
	EngineError string `json:"engine_error,omitempty"`
	// Customers counts the non-root users with consumption in the window;
	// Users lists the largest userSpendTopN of them.
	Customers         int     `json:"customers"`
	QuotaUSD          float64 `json:"quota_usd"`
	RootQuotaUSD      float64 `json:"root_quota_usd"`
	EngineUSD         float64 `json:"engine_usd"`
	CustomerEngineUSD float64 `json:"customer_engine_usd"`
	RootEngineUSD     float64 `json:"root_engine_usd"`
	// UnattributedEngineUSD is gpt-load's cost on providers new-api charged
	// nobody for in the window, so it could not be shared out.
	UnattributedEngineUSD float64        `json:"unattributed_engine_usd"`
	Users                 []UserSpendRow `json:"users"`
}

// UserSpendRow is one customer's use in the window, with their current
// balance and everything they have ever paid (model.UserSpendAccount).
type UserSpendRow struct {
	model.UserRef
	Email            string  `json:"email"`
	Requests         int64   `json:"requests"`
	QuotaUSD         float64 `json:"quota_usd"`
	EngineUSD        float64 `json:"engine_usd"`
	TopupPaid        float64 `json:"topup_paid"`
	SubscriptionPaid float64 `json:"subscription_paid"`
	BalanceUSD       float64 `json:"balance_usd"`
}

var userSpendCache struct {
	mu      sync.Mutex
	entries map[int64]userSpendEntry
	flight  singleflight.Group
}

type userSpendEntry struct {
	spend  UserSpend
	readAt time.Time
}

// FetchUserSpend reads the window, sharing one read for userSpendTTL. hours
// must be one of UserSpendWindowHours.
func FetchUserSpend(hours int64) (UserSpend, error) {
	if !slices.Contains(UserSpendWindowHours, hours) {
		return UserSpend{}, fmt.Errorf("unknown window %d", hours)
	}
	userSpendCache.mu.Lock()
	if entry, ok := userSpendCache.entries[hours]; ok && time.Since(entry.readAt) < userSpendTTL {
		userSpendCache.mu.Unlock()
		return entry.spend, nil
	}
	userSpendCache.mu.Unlock()
	value, err, _ := userSpendCache.flight.Do(strconv.FormatInt(hours, 10), func() (any, error) {
		spend, err := readUserSpend(hours, time.Now())
		if err != nil {
			return nil, err
		}
		userSpendCache.mu.Lock()
		if userSpendCache.entries == nil {
			userSpendCache.entries = make(map[int64]userSpendEntry)
		}
		userSpendCache.entries[hours] = userSpendEntry{spend: spend, readAt: time.Now()}
		userSpendCache.mu.Unlock()
		return spend, nil
	})
	if err != nil {
		return UserSpend{}, err
	}
	return value.(UserSpend), nil
}

func readUserSpend(hours int64, now time.Time) (UserSpend, error) {
	end := now.Unix()
	start := end - hours*3600
	spend := UserSpend{
		Hours: hours, StartTime: start, EndTime: end,
		USDExchangeRate: operation_setting.USDExchangeRate, Users: []UserSpendRow{},
	}
	type engineResult struct {
		configured bool
		costs      map[string]*providerCost
		err        string
	}
	engineDone := make(chan engineResult, 1)
	go func() {
		configured, costs, err := readEngineModelCosts(start*1000, end*1000)
		engineDone <- engineResult{configured, costs, err}
	}()
	rows, err := model.ReadUserModelSpend(start, end)
	if err != nil {
		return spend, err
	}
	rootIDs, err := model.RootUserIDs()
	if err != nil {
		return spend, err
	}
	engine := <-engineDone
	spend.EngineConfigured, spend.EngineError = engine.configured, engine.err

	type userTotal struct {
		quota    int64
		requests int64
		engine   float64
	}
	totals := make(map[int]*userTotal)
	for _, row := range rows {
		total := totals[row.UserId]
		if total == nil {
			total = &userTotal{}
			totals[row.UserId] = total
		}
		total.quota += row.Quota
		total.requests += row.Requests
	}
	if engine.err == "" {
		engineChannels, err := model.EngineChannelIDs(operation_setting.EngineControlURL)
		if err != nil {
			return spend, err
		}
		shares, unattributed := shareEngineCost(engineRows(rows, engineChannels), engine.costs, ratio_setting.GetGroupRatioCopy())
		for id, usd := range shares {
			totals[id].engine = usd
		}
		spend.UnattributedEngineUSD = unattributed
		for _, cost := range engine.costs {
			spend.EngineUSD += cost.total
		}
	}

	var customerQuota, rootQuota int64
	var customers []int
	for id, total := range totals {
		if slices.Contains(rootIDs, id) {
			rootQuota += total.quota
			spend.RootEngineUSD += total.engine
			continue
		}
		customerQuota += total.quota
		spend.CustomerEngineUSD += total.engine
		customers = append(customers, id)
	}
	spend.Customers = len(customers)
	spend.QuotaUSD = roundUSD(float64(customerQuota) / common.QuotaPerUnit)
	spend.RootQuotaUSD = roundUSD(float64(rootQuota) / common.QuotaPerUnit)
	spend.EngineUSD, spend.CustomerEngineUSD = roundUSD(spend.EngineUSD), roundUSD(spend.CustomerEngineUSD)
	spend.RootEngineUSD, spend.UnattributedEngineUSD = roundUSD(spend.RootEngineUSD), roundUSD(spend.UnattributedEngineUSD)
	slices.SortFunc(customers, func(a, b int) int {
		return cmp.Or(cmp.Compare(totals[b].quota, totals[a].quota), cmp.Compare(totals[b].engine, totals[a].engine), cmp.Compare(a, b))
	})
	customers = customers[:min(len(customers), userSpendTopN)]
	accounts, err := model.ReadUserSpendAccounts(customers)
	if err != nil {
		return spend, err
	}
	for _, id := range customers {
		total := totals[id]
		row := UserSpendRow{
			UserRef:  model.UserRef{UserID: id},
			Requests: total.requests, QuotaUSD: roundUSD(float64(total.quota) / common.QuotaPerUnit), EngineUSD: roundUSD(total.engine),
		}
		if account := accounts[id]; account != nil {
			row.Username, row.Email = account.Username, account.Email
			row.TopupPaid, row.SubscriptionPaid = account.TopupPaid, account.SubscriptionPaid
			row.BalanceUSD = roundUSD(float64(account.BalanceQuota) / common.QuotaPerUnit)
		}
		spend.Users = append(spend.Users, row)
	}
	return spend, nil
}

// roundUSD keeps four places, as the other insights views do.
func roundUSD(value float64) float64 { return math.Round(value*1e4) / 1e4 }

// engineRows keeps the rows served by an engine channel, so the engine's cost
// goes only to the requests that reached it. With no engine channel known,
// every row is kept.
func engineRows(rows []model.UserModelSpend, engineChannels map[int]bool) []model.UserModelSpend {
	if len(engineChannels) == 0 {
		return rows
	}
	return slices.DeleteFunc(slices.Clone(rows), func(row model.UserModelSpend) bool {
		return !engineChannels[row.ChannelId]
	})
}

// providerCost is gpt-load's official-price cost on one provider's channels:
// by model where the engine names the model, and in total.
type providerCost struct {
	models map[string]float64
	total  float64
}

// shareEngineCost shares each provider's cost among the users new-api
// charged for that provider's models. A user's weight on a model is their
// charge with the group's ratio taken out. A model's named cost goes to its
// users; the rest of the provider's cost goes to the users of its models the
// engine did not name, or of all its models when it named every one. A
// provider nobody was charged for stays unattributed.
func shareEngineCost(rows []model.UserModelSpend, costs map[string]*providerCost, groupRatios map[string]float64) (map[int]float64, float64) {
	type modelWeights struct {
		users map[int]float64
		total float64
	}
	weights := make(map[string]map[string]*modelWeights)
	for _, row := range rows {
		if row.Quota <= 0 {
			continue
		}
		provider := model.ModelVendor(row.ModelName)
		if weights[provider] == nil {
			weights[provider] = make(map[string]*modelWeights)
		}
		entry := weights[provider][row.ModelName]
		if entry == nil {
			entry = &modelWeights{users: make(map[int]float64)}
			weights[provider][row.ModelName] = entry
		}
		ratio := groupRatios[row.LogGroup]
		if ratio <= 0 {
			ratio = 1
		}
		weight := float64(row.Quota) / ratio
		entry.users[row.UserId] += weight
		entry.total += weight
	}

	shares := make(map[int]float64)
	share := func(cost float64, models []*modelWeights) bool {
		var total float64
		for _, entry := range models {
			total += entry.total
		}
		if total <= 0 {
			return false
		}
		for _, entry := range models {
			for id, weight := range entry.users {
				shares[id] += cost * weight / total
			}
		}
		return true
	}
	var unattributed float64
	for provider, cost := range costs {
		models := weights[provider]
		rest := cost.total
		named := make(map[string]bool)
		for name, usd := range cost.models {
			entry := models[name]
			if entry == nil {
				continue
			}
			share(usd, []*modelWeights{entry})
			named[name] = true
			rest -= usd
		}
		if rest <= 1e-9 {
			continue
		}
		var unnamed, all []*modelWeights
		for name, entry := range models {
			all = append(all, entry)
			if !named[name] {
				unnamed = append(unnamed, entry)
			}
		}
		if !share(rest, unnamed) && !share(rest, all) {
			unattributed += rest
		}
	}
	return shares, unattributed
}

// engineModelCostReport is the part of the engine's /usage response read for
// the cost by model: the five largest, the rest only in the summary.
type engineModelCostReport struct {
	Summary struct {
		EstimatedCostNanoUSD string `json:"estimated_cost_nano_usd"`
	} `json:"summary"`
	Distributions struct {
		Model map[string]struct {
			Items []struct {
				Model                *string `json:"model"`
				EstimatedCostNanoUSD string  `json:"estimated_cost_nano_usd"`
			} `json:"items"`
		} `json:"model"`
	} `json:"distributions"`
}

// readEngineModelCosts reads gpt-load's cost in [fromMS, toMS) on every
// channel the pool has groups in, by the provider each channel serves.
func readEngineModelCosts(fromMS, toMS int64) (bool, map[string]*providerCost, string) {
	costs := make(map[string]*providerCost)
	base := strings.TrimRight(strings.TrimSpace(operation_setting.EngineControlURL), "/")
	key := strings.TrimSpace(operation_setting.EngineControlKey)
	if base == "" || key == "" {
		return false, costs, ""
	}
	pool := RecentEnginePool(2 * time.Minute)
	if pool.Error != "" {
		return true, costs, pool.Error
	}
	var channels []string
	for _, group := range pool.Groups {
		if group.Channel != "" && !slices.Contains(channels, group.Channel) {
			channels = append(channels, group.Channel)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error
	for _, channel := range channels {
		wg.Go(func() {
			query := url.Values{
				"from_ms":    {strconv.FormatInt(fromMS, 10)},
				"to_ms":      {strconv.FormatInt(toMS, 10)},
				"channel_id": {channel},
			}
			report, err := engineGet[engineModelCostReport](ctx, base, key, "/usage?"+query.Encode())
			var total float64
			models := make(map[string]float64)
			if err == nil {
				total, err = nanoStringUSD(report.Summary.EstimatedCostNanoUSD)
			}
			if err == nil {
				for _, item := range report.Distributions.Model["cost"].Items {
					if item.Model == nil || *item.Model == "" {
						continue
					}
					var usd float64
					if usd, err = nanoStringUSD(item.EstimatedCostNanoUSD); err != nil {
						break
					}
					models[*item.Model] += usd
				}
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			provider := ChannelProvider(channel)
			cost := costs[provider]
			if cost == nil {
				cost = &providerCost{models: make(map[string]float64)}
				costs[provider] = cost
			}
			cost.total += total
			for name, usd := range models {
				cost.models[name] += usd
			}
		})
	}
	wg.Wait()
	if firstErr != nil {
		return true, map[string]*providerCost{}, firstErr.Error()
	}
	return true, costs, ""
}

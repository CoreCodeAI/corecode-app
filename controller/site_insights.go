package controller

import (
	"cmp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// The root dashboard's views. Each reads start_time and end_time (unix
// seconds, end exclusive) and tz_offset (minutes east of UTC), and rejects a
// span longer than its own bound.

func insightsRange(c *gin.Context, maxDays int64) (model.InsightsRange, bool) {
	start, _ := strconv.ParseInt(c.Query("start_time"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end_time"), 10, 64)
	offset, err := strconv.ParseInt(c.DefaultQuery("tz_offset", "0"), 10, 64)
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return model.InsightsRange{}, false
	}
	r, ok := model.ResolveInsightsRange(start, end, offset*60, maxDays)
	if !ok {
		common.ApiErrorT(c, "Invalid parameters")
	}
	return r, ok
}

func serveInsights[T any](c *gin.Context, maxDays int64, read func(model.InsightsRange) (T, error)) {
	r, ok := insightsRange(c, maxDays)
	if !ok {
		return
	}
	result, err := read(r)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

// LiveUserConcurrency is one user's requests in flight on this instance.
// LimitSource is "user" for a per-user override, "tier" for a paid-total
// tier and "group" otherwise.
type LiveUserConcurrency struct {
	model.UserRef
	InFlight    int    `json:"in_flight"`
	Limit       int    `json:"limit"`
	LimitSource string `json:"limit_source"`
}

// UserConcurrencyOverride is one per-user limit, with the group limit it
// replaces.
type UserConcurrencyOverride struct {
	model.UserRef
	Group      string `json:"group"`
	Limit      int    `json:"limit"`
	GroupLimit int    `json:"group_limit"`
	InFlight   int    `json:"in_flight"`
}

// CapacityResponse adds the requests in flight on this process, the per-user
// limit's rejections and the engine pool to the logs view. Root is left out
// of all of them.
type CapacityResponse struct {
	*model.CapacityInsights
	InFlight            int                                 `json:"in_flight"`
	InFlightUsers       []LiveUserConcurrency               `json:"in_flight_users"`
	LimitRejections     []model.CountPoint                  `json:"limit_rejections"`
	LimitRejectionTotal int64                               `json:"limit_rejection_total"`
	LimitRejectedUsers  []model.UserCount                   `json:"limit_rejected_users"`
	ConcurrencyLimits   map[string]int                      `json:"concurrency_limits"`
	ConcurrencyTiers    []operation_setting.ConcurrencyTier `json:"concurrency_tiers"`
	UserLimits          []UserConcurrencyOverride           `json:"user_limits"`
	Pool                service.EnginePool                  `json:"pool"`
}

// capacityVendor is the vendor the capacity view is narrowed to, one of the
// pool's providers, or empty for every vendor.
func capacityVendor(c *gin.Context) string {
	vendor := c.Query("vendor")
	if slices.Contains(service.PoolProviders, vendor) {
		return vendor
	}
	return ""
}

func GetCapacityInsights(c *gin.Context) {
	serveInsights(c, model.InsightsMaxLogDays, func(r model.InsightsRange) (*CapacityResponse, error) {
		// Capacity shows the pool's totals, which change slowly, so it takes the
		// last read of up to two minutes rather than waiting on the engine. The
		// first read after a start still waits; it runs while the database works.
		poolDone := make(chan service.EnginePool, 1)
		go func() { poolDone <- service.RecentEnginePool(2 * time.Minute) }()
		insights, err := model.GetCapacityInsights(r, capacityVendor(c))
		if err != nil {
			return nil, err
		}
		response := &CapacityResponse{
			CapacityInsights:  insights,
			InFlightUsers:     []LiveUserConcurrency{},
			ConcurrencyLimits: operation_setting.GetTokenSetting().ConcurrencyLimits,
			ConcurrencyTiers:  operation_setting.GetTokenSetting().ConcurrencyTiers,
		}
		inFlight := middleware.UserConcurrencySnapshot()
		overrides := operation_setting.GetTokenSetting().UserConcurrencyLimits
		ids := make([]int, 0, len(inFlight)+len(overrides))
		for id := range inFlight {
			ids = append(ids, id)
		}
		for key := range overrides {
			if id, err := strconv.Atoi(key); err == nil {
				ids = append(ids, id)
			}
		}
		users, err := model.InsightsUsers(ids)
		if err != nil {
			return nil, err
		}
		for id, count := range inFlight {
			user := users[id]
			if user.Role >= common.RoleRootUser {
				continue
			}
			response.InFlight += count
			limit, source := operation_setting.EffectiveUserConcurrencyLimit(id, user.Group,
				func() float64 { return model.CachedUserPaidMoney(id) })
			response.InFlightUsers = append(response.InFlightUsers, LiveUserConcurrency{
				UserRef:     model.UserRef{UserID: id, Username: user.Username},
				InFlight:    count,
				Limit:       limit,
				LimitSource: source,
			})
		}
		response.UserLimits = []UserConcurrencyOverride{}
		for key, limit := range overrides {
			id, err := strconv.Atoi(key)
			if err != nil {
				continue
			}
			user := users[id]
			response.UserLimits = append(response.UserLimits, UserConcurrencyOverride{
				UserRef:    model.UserRef{UserID: id, Username: user.Username},
				Group:      user.Group,
				Limit:      limit,
				GroupLimit: operation_setting.GetUserConcurrencyLimit(user.Group),
				InFlight:   inFlight[id],
			})
		}
		slices.SortFunc(response.UserLimits, func(a, b UserConcurrencyOverride) int { return cmp.Compare(a.UserID, b.UserID) })
		slices.SortFunc(response.InFlightUsers, func(a, b LiveUserConcurrency) int {
			return cmp.Or(cmp.Compare(b.InFlight, a.InFlight), cmp.Compare(a.UserID, b.UserID))
		})
		response.LimitRejections, response.LimitRejectedUsers, err = model.ReadUserConcurrencyRejections(r.Start, r.End)
		if err != nil {
			return nil, err
		}
		for _, point := range response.LimitRejections {
			response.LimitRejectionTotal += point.Count
		}
		response.Pool = <-poolDone
		return response, nil
	})
}

// FinanceResponse adds what Claude cost at official prices beside what
// new-api charged for it, and what each plan's account serves in a week.
type FinanceResponse struct {
	*model.FinanceInsights
	EngineCost service.EngineDailyCost `json:"engine_cost"`
	// MatchedOfficialUSD and MatchedClaudeUSD cover the days the engine
	// reported; OfficialPerUSD is their ratio, the official-price cost of one
	// dollar new-api charged for Claude.
	MatchedOfficialUSD float64                   `json:"matched_official_usd"`
	MatchedClaudeUSD   float64                   `json:"matched_claude_usd"`
	OfficialPerUSD     float64                   `json:"official_per_usd"`
	Plans              []service.EnginePlanValue `json:"plans"`
	PlansError         string                    `json:"plans_error,omitempty"`
	// PlanAccounts counts every pool account by plan, for what the pool costs.
	PlanAccounts []service.EnginePlanCount `json:"plan_accounts"`
	// StartTime and EndTime are the range; MatchedSince is where the days the
	// engine reported begin, so a cost over time covers the same span.
	StartTime    int64 `json:"start_time"`
	EndTime      int64 `json:"end_time"`
	MatchedSince int64 `json:"matched_since"`
	// USDExchangeRate is yuan per US dollar. Customers pay ¥1 for each
	// quota dollar, so new-api's charge is in yuan; this converts it to the
	// dollars the engine's cost and the account prices are in.
	USDExchangeRate float64 `json:"usd_exchange_rate"`
}

func GetFinanceInsights(c *gin.Context) {
	serveInsights(c, model.InsightsMaxDays, func(r model.InsightsRange) (*FinanceResponse, error) {
		engineDone := make(chan service.EngineDailyCost, 1)
		go func() { engineDone <- service.FetchEngineDailyCost(r.Start, r.End, r.Offset) }()
		// Calibrated capacities change slowly, so the last read of the pool
		// serves, as on the capacity view.
		poolDone := make(chan service.EnginePool, 1)
		go func() { poolDone <- service.RecentEnginePool(2 * time.Minute) }()
		insights, err := model.GetFinanceInsights(r)
		if err != nil {
			return nil, err
		}
		response := &FinanceResponse{FinanceInsights: insights, EngineCost: <-engineDone}
		official, charged := service.MatchClaudeCost(insights.Daily, response.EngineCost)
		response.MatchedOfficialUSD, response.MatchedClaudeUSD = official, charged
		response.StartTime, response.EndTime = r.Start, r.End
		response.USDExchangeRate = operation_setting.USDExchangeRate
		response.MatchedSince = service.MatchedSince(r.Start, r.End, response.EngineCost)
		if charged > 0 {
			response.OfficialPerUSD = official / charged
		}
		pool := <-poolDone
		response.Plans = service.EnginePlanValues(pool.Accounts)
		response.PlanAccounts = service.EnginePlanCounts(pool)
		response.PlansError = cmp.Or(pool.Error, pool.EstimateError)
		return response, nil
	})
}

func GetRiskInsights(c *gin.Context) {
	serveInsights(c, model.InsightsMaxRiskDays, model.GetRiskInsights)
}

func GetGrowthInsights(c *gin.Context) {
	serveInsights(c, model.InsightsMaxDays, model.GetGrowthInsights)
}

// ActivityResponse adds what the engine recorded at official prices beside
// the quota new-api charged: Claude's cost, and every model's.
type ActivityResponse struct {
	*model.ActivityInsights
	EngineCost  service.EngineDailyCost `json:"engine_cost"`
	EngineTotal service.EngineDailyCost `json:"engine_total"`
	// USDExchangeRate is yuan per US dollar, as on the funds view: new-api's
	// charge is in yuan.
	USDExchangeRate float64 `json:"usd_exchange_rate"`
}

func GetActivityInsights(c *gin.Context) {
	serveInsights(c, model.InsightsMaxDays, func(r model.InsightsRange) (*ActivityResponse, error) {
		engineDone := make(chan service.EngineDailyCost, 1)
		go func() { engineDone <- service.FetchEngineDailyCost(r.Start, r.End, r.Offset) }()
		totalDone := make(chan service.EngineDailyCost, 1)
		go func() { totalDone <- service.FetchEngineDailyTotal(r.Start, r.End, r.Offset) }()
		insights, err := model.GetActivityInsights(r)
		if err != nil {
			return nil, err
		}
		return &ActivityResponse{
			ActivityInsights: insights,
			EngineCost:       <-engineDone,
			EngineTotal:      <-totalDone,
			USDExchangeRate:  operation_setting.USDExchangeRate,
		}, nil
	})
}

// maxInsightModels bounds the models query parameter; the site sells far
// fewer models than this.
const (
	maxInsightModels   = 100
	maxInsightModelLen = 128
)

// insightsModels reads the comma-separated models query parameter. Blank
// entries are dropped; an absent parameter selects every model.
func insightsModels(c *gin.Context) ([]string, bool) {
	var models []string
	for _, name := range strings.Split(c.Query("models"), ",") {
		name = strings.TrimSpace(name)
		if name == "" || slices.Contains(models, name) {
			continue
		}
		models = append(models, name)
	}
	if len(models) > maxInsightModels || slices.ContainsFunc(models, func(name string) bool {
		return len(name) > maxInsightModelLen
	}) {
		common.ApiErrorT(c, "Invalid parameters")
		return nil, false
	}
	return models, true
}

func GetQualityInsights(c *gin.Context) {
	models, ok := insightsModels(c)
	if !ok {
		return
	}
	serveInsights(c, model.InsightsMaxLogDays, func(r model.InsightsRange) (*model.QualityInsights, error) {
		return model.GetQualityInsights(r, models)
	})
}

// ChannelResponse adds the site's exchange rate to the channel view: revenue
// is in yuan, fees in US dollars.
type ChannelResponse struct {
	*model.ChannelInsights
	USDExchangeRate float64 `json:"usd_exchange_rate"`
}

func GetChannelInsights(c *gin.Context) {
	serveInsights(c, model.InsightsMaxDays, func(r model.InsightsRange) (*ChannelResponse, error) {
		insights, err := model.GetChannelInsights(r)
		if err != nil {
			return nil, err
		}
		return &ChannelResponse{ChannelInsights: insights, USDExchangeRate: operation_setting.USDExchangeRate}, nil
	})
}

// SetChannelCosts replaces the fees paid to promotion channels.
func SetChannelCosts(c *gin.Context) {
	var request struct {
		Costs []model.ChannelCost `json:"costs"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SaveChannelCosts(request.Costs); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetBusinessInsights(c *gin.Context) {
	serveInsights(c, model.InsightsMaxLogDays, model.GetBusinessInsights)
}

// GetEnginePool returns corecode-engine's groups and accounts, live. It takes
// no range: the engine reports its current state.
func GetEnginePool(c *gin.Context) {
	common.ApiSuccess(c, service.FetchEnginePool())
}

// SetEngineSubscriptionRenewal records the billing date an operator read for
// one provider organization in the engine; an empty renews_on removes it.
func SetEngineSubscriptionRenewal(c *gin.Context) {
	var request struct {
		RenewsOn         string `json:"renews_on"`
		OrganizationName string `json:"organization_name"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := service.SetEngineSubscriptionRenewal(c.Request.Context(), c.Param("organization_uuid"), request.RenewsOn, request.OrganizationName); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetPoolUsage returns one provider's use on new-api and gpt-load over the
// last hour to the last week, with a forecast. It takes no range.
func GetPoolUsage(c *gin.Context) {
	provider := c.DefaultQuery("provider", model.VendorClaude)
	if !slices.Contains(service.PoolProviders, provider) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	usage, err := service.FetchPoolUsage(provider)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, usage)
}

// GetUserSpendInsights returns each customer's use over the last `hours`
// (one of service.UserSpendWindowHours, 24 by default): new-api's charge and
// gpt-load's cost shared out to them, with their balance and what they paid.
func GetUserSpendInsights(c *gin.Context) {
	hours, err := strconv.ParseInt(c.DefaultQuery("hours", "24"), 10, 64)
	if err != nil || !slices.Contains(service.UserSpendWindowHours, hours) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	spend, err := service.FetchUserSpend(hours)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, spend)
}

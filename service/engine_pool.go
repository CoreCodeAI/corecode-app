package service

import (
	"cmp"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"golang.org/x/sync/singleflight"
)

// EngineAccount is one subscription account of corecode-engine's pool as the
// root dashboard shows it. Usage is in percent; the email is masked here.
type EngineAccount struct {
	CredentialID  int     `json:"credential_id"`
	GroupID       int     `json:"group_id"`
	Group         string  `json:"group"`
	EmailMask     string  `json:"email_mask"`
	Plan          string  `json:"plan"`
	Tier          string  `json:"tier"`
	Status        string  `json:"status"`
	FiveHour      float64 `json:"five_hour"`
	SevenDay      float64 `json:"seven_day"`
	FiveHourReset int64   `json:"five_hour_reset_ms"`
	SevenDayReset int64   `json:"seven_day_reset_ms"`
	CooldownUntil int64   `json:"cooldown_until_ms"`
	// Eligible reports an available account in an enabled group: the engine
	// already marks an account over a quota budget, so this is what its
	// scheduler may send requests to.
	Eligible bool `json:"eligible"`
	// Active is requests in flight; Sessions the conversations the engine
	// counts as running on the account.
	Active        int    `json:"active"`
	Sessions      int    `json:"sessions"`
	ObservedAt    int64  `json:"observed_at_ms"`
	Observation   string `json:"observation"`
	Successes     int64  `json:"successes"`
	Failures      int64  `json:"failures"`
	LastUsedAt    int64  `json:"last_used_at_ms"`
	LastFailure   string `json:"last_failure"`
	LastFailureAt int64  `json:"last_failure_at_ms"`
	// From the pool estimate, in USD; nil when the engine has no reading.
	FiveHourRemainingUSD *float64 `json:"five_hour_remaining_usd"`
	SevenDayRemainingUSD *float64 `json:"seven_day_remaining_usd"`
	BurnUSDPerHour       *float64 `json:"burn_usd_per_hour"`
	// SevenDayCapacityUSD is what a full week of the account serves at
	// official prices, as the engine calibrated it from the account's own
	// requests; Source is measured, recent, peer or unknown.
	SevenDayCapacityUSD    *float64 `json:"seven_day_capacity_usd"`
	SevenDayCapacitySource string   `json:"seven_day_capacity_source"`
}

// EngineGroup is one engine group with its accounts counted by status.
type EngineGroup struct {
	ID             int            `json:"id"`
	Name           string         `json:"name"`
	Channel        string         `json:"channel"`
	Enabled        bool           `json:"enabled"`
	InFlight       int            `json:"in_flight"`
	EffectiveLimit int            `json:"effective_limit"`
	OverrideLimit  *int           `json:"override_limit"`
	Accounts       int            `json:"accounts"`
	Eligible       int            `json:"eligible"`
	Slots          int            `json:"slots"`
	Counts         map[string]int `json:"counts"`
	QuotaBudget    bool           `json:"quota_budget"`
	FiveHourBudget float64        `json:"five_hour_budget"`
	SevenDayBudget float64        `json:"seven_day_budget"`
}

// EngineHorizon is the pool estimate's remaining dollars over one window.
type EngineHorizon struct {
	RemainingUSD     float64 `json:"remaining_usd"`
	RemainingLowUSD  float64 `json:"remaining_low_usd"`
	RemainingHighUSD float64 `json:"remaining_high_usd"`
	CapacityUSD      float64 `json:"capacity_usd"`
	Counted          int     `json:"counted"`
	Unknown          int     `json:"unknown"`
}

// EngineRefill is one account's five-hour window resetting soon.
type EngineRefill struct {
	CredentialID int     `json:"credential_id"`
	At           int64   `json:"at_ms"`
	AddsUSD      float64 `json:"adds_usd"`
}

// EnginePool summarizes the pool for the root dashboard.
type EnginePool struct {
	Configured            bool    `json:"configured"`
	Error                 string  `json:"error,omitempty"`
	ObservedAt            int64   `json:"observed_at_ms"`
	CredentialConcurrency int     `json:"credential_concurrency"`
	FiveHourBudget        float64 `json:"five_hour_budget"`
	SevenDayBudget        float64 `json:"seven_day_budget"`
	EligibleAccounts      int     `json:"eligible_accounts"`
	// EffectiveSlots adds up, per enabled group, eligible accounts times the
	// per-account limit, capped by the group's own limit.
	EffectiveSlots int             `json:"effective_slots"`
	InFlight       int             `json:"in_flight"`
	Groups         []EngineGroup   `json:"groups"`
	Accounts       []EngineAccount `json:"accounts"`
	FiveHour       *EngineHorizon  `json:"five_hour_estimate"`
	Week           *EngineHorizon  `json:"week_estimate"`
	Refills        []EngineRefill  `json:"refills"`
	// Runway is how long the Claude accounts last at their recent spend; nil
	// without an estimate or without Claude accounts.
	Runway        *EngineRunway `json:"runway"`
	EstimateError string        `json:"estimate_error,omitempty"`
}

type engineEnvelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

type engineBudget struct {
	Enabled         bool    `json:"enabled"`
	FiveHourPercent float64 `json:"five_hour_percent"`
	SevenDayPercent float64 `json:"seven_day_percent"`
}

type engineWindow struct {
	Utilization *float64 `json:"utilization"`
	ResetAt     *int64   `json:"reset_at_ms"`
}

type engineGroup struct {
	ID             int            `json:"id"`
	Name           string         `json:"name"`
	Channel        string         `json:"channel_id"`
	Enabled        bool           `json:"enabled"`
	Current        int            `json:"current"`
	OverrideLimit  *int           `json:"override_limit"`
	EffectiveLimit int            `json:"effective_limit"`
	QuotaSupported bool           `json:"quota_supported"`
	QuotaEffective engineBudget   `json:"quota_effective"`
	Counts         map[string]int `json:"counts"`
	Credentials    []struct {
		ID            int          `json:"id"`
		Name          string       `json:"name"`
		Status        string       `json:"status"`
		FiveHour      engineWindow `json:"five_hour"`
		SevenDay      engineWindow `json:"seven_day"`
		Active        int          `json:"active"`
		Sessions      int          `json:"sessions"`
		CooldownUntil *int64       `json:"cooldown_until_ms"`
		Activity      *struct {
			LastUsedAt    *int64 `json:"last_used_at_ms"`
			LastFailure   string `json:"last_failure_summary"`
			LastFailureAt *int64 `json:"last_failure_at_ms"`
			SuccessCount  int64  `json:"success_count"`
			FailureCount  int64  `json:"failure_count"`
		} `json:"activity"`
		Account *struct {
			State      string `json:"state"`
			ObservedAt *int64 `json:"observed_at_ms"`
			Email      string `json:"email"`
			Plan       string `json:"plan"`
			Tier       string `json:"tier"`
		} `json:"account"`
	} `json:"credentials"`
}

type engineConcurrency struct {
	ObservedAt         int64         `json:"observed_at_ms"`
	CredentialLimit    int           `json:"credential_limit"`
	DefaultQuotaBudget engineBudget  `json:"default_quota_budget"`
	Groups             []engineGroup `json:"groups"`
}

type engineEstimateHorizon struct {
	RemainingUSD     float64 `json:"remaining_usd"`
	RemainingLowUSD  float64 `json:"remaining_low_usd"`
	RemainingHighUSD float64 `json:"remaining_high_usd"`
	CapacityUSD      float64 `json:"capacity_usd"`
	Counted          int     `json:"counted"`
	Unknown          int     `json:"unknown"`
}

type engineEstimate struct {
	FiveHour engineEstimateHorizon `json:"five_hour"`
	Week     engineEstimateHorizon `json:"week"`
	Refills  []EngineRefill        `json:"refills"`
	Accounts []struct {
		CredentialID int `json:"credential_id"`
		FiveHour     struct {
			RemainingUSD *float64 `json:"remaining_usd"`
		} `json:"five_hour"`
		SevenDay struct {
			RemainingUSD *float64 `json:"remaining_usd"`
			CapacityUSD  *float64 `json:"capacity_usd"`
			Source       string   `json:"source"`
		} `json:"seven_day"`
		BurnUSDPerHour *float64 `json:"burn_usd_per_hour"`
	} `json:"accounts"`
}

// channelOrder ranks the Claude channel before every other channel.
func channelOrder(channel string) int {
	if channel == "claude" {
		return 0
	}
	return 1
}

// maskEmail keeps the first letter and the domain: b***@example.com.
func maskEmail(email string) string {
	local, domain, ok := strings.Cut(email, "@")
	if !ok || local == "" {
		return email
	}
	return local[:1] + "***@" + domain
}

func percent(window engineWindow) float64 {
	if window.Utilization == nil {
		return 0
	}
	return math.Round(*window.Utilization*1000) / 10
}

func deref[T any](value *T) T {
	var zero T
	if value == nil {
		return zero
	}
	return *value
}

func engineGet[T any](ctx context.Context, base string, key string, path string) (T, error) {
	var zero T
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api"+path, nil)
	if err != nil {
		return zero, err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return zero, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return zero, err
	}
	if response.StatusCode != http.StatusOK {
		return zero, fmt.Errorf("engine %s returned HTTP %d", path, response.StatusCode)
	}
	var envelope engineEnvelope[T]
	if err := common.Unmarshal(body, &envelope); err != nil {
		return zero, fmt.Errorf("engine %s: %w", path, err)
	}
	if envelope.Code != 0 {
		return zero, fmt.Errorf("engine %s: %s", path, envelope.Message)
	}
	return envelope.Data, nil
}

// enginePoolTTL is how long one complete read of the pool is shared. The
// capacity and pool views both show the pool, and the pool view refreshes
// every 15 s.
var enginePoolTTL = 5 * time.Second

var enginePoolCache struct {
	mu     sync.Mutex
	source string
	pool   EnginePool
	readAt time.Time
	flight singleflight.Group
}

// FetchEnginePool reads the pool from the engine's control API: every group
// and account from /group-concurrency, the page the engine's own console
// shows, and remaining dollars from its pool estimate. A missing URL or key
// returns Configured false; a failed read returns the error in the result so
// the rest of the dashboard still renders. A failed estimate leaves the
// accounts in place.
//
// A complete read is reused for enginePoolTTL, and concurrent callers share
// one read, which is not tied to any caller's request and gives up after 8 s.
// The result is shared between callers and must not be modified.
func FetchEnginePool() EnginePool {
	return enginePool(0)
}

// RecentEnginePool returns the last complete read of the pool when it is at
// most staleLimit old, without waiting for the engine; a read older than
// enginePoolTTL also starts a new one in the background, so the next caller
// gets fresher figures. Without such a read it waits like FetchEnginePool.
// It suits views that show the pool's slowly changing totals.
func RecentEnginePool(staleLimit time.Duration) EnginePool {
	return enginePool(staleLimit)
}

func enginePool(staleLimit time.Duration) EnginePool {
	base := strings.TrimRight(strings.TrimSpace(operation_setting.EngineControlURL), "/")
	key := strings.TrimSpace(operation_setting.EngineControlKey)
	if base == "" || key == "" {
		return EnginePool{Groups: []EngineGroup{}, Accounts: []EngineAccount{}, Refills: []EngineRefill{}}
	}
	source := base + "\x00" + key
	read := func() (any, error) {
		pool := readEnginePool(base, key)
		if pool.Error == "" && pool.EstimateError == "" {
			enginePoolCache.mu.Lock()
			enginePoolCache.source, enginePoolCache.pool, enginePoolCache.readAt = source, pool, time.Now()
			enginePoolCache.mu.Unlock()
		}
		return pool, nil
	}
	enginePoolCache.mu.Lock()
	cached, age := enginePoolCache.pool, time.Since(enginePoolCache.readAt)
	found := enginePoolCache.source == source
	enginePoolCache.mu.Unlock()
	if found && age < enginePoolTTL {
		return cached
	}
	if found && age < staleLimit {
		enginePoolCache.flight.DoChan(source, read)
		return cached
	}
	value, _, _ := enginePoolCache.flight.Do(source, read)
	return value.(EnginePool)
}

// readEnginePool asks the engine for the groups and the estimate at once and
// joins them.
func readEnginePool(base, key string) EnginePool {
	pool := EnginePool{Configured: true, Groups: []EngineGroup{}, Accounts: []EngineAccount{}, Refills: []EngineRefill{}}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var estimate engineEstimate
	var estimateErr error
	estimateDone := make(chan struct{})
	go func() {
		defer close(estimateDone)
		estimate, estimateErr = engineGet[engineEstimate](ctx, base, key, "/group-concurrency/pool-estimate")
	}()

	snapshot, err := engineGet[engineConcurrency](ctx, base, key, "/group-concurrency")
	if err != nil {
		pool.Error = err.Error()
		return pool
	}
	pool.ObservedAt = snapshot.ObservedAt
	pool.CredentialConcurrency = snapshot.CredentialLimit
	if snapshot.DefaultQuotaBudget.Enabled {
		pool.FiveHourBudget = snapshot.DefaultQuotaBudget.FiveHourPercent
		pool.SevenDayBudget = snapshot.DefaultQuotaBudget.SevenDayPercent
	}
	// Claude groups, and so their accounts, come first; the rest keep the
	// engine's order.
	slices.SortStableFunc(snapshot.Groups, func(a, b engineGroup) int {
		return cmp.Compare(channelOrder(a.Channel), channelOrder(b.Channel))
	})
	for _, group := range snapshot.Groups {
		row := EngineGroup{
			ID:             group.ID,
			Name:           group.Name,
			Channel:        group.Channel,
			Enabled:        group.Enabled,
			InFlight:       group.Current,
			EffectiveLimit: group.EffectiveLimit,
			OverrideLimit:  group.OverrideLimit,
			Accounts:       len(group.Credentials),
			Counts:         group.Counts,
			QuotaBudget:    group.QuotaSupported && group.QuotaEffective.Enabled,
		}
		if row.QuotaBudget {
			row.FiveHourBudget = group.QuotaEffective.FiveHourPercent
			row.SevenDayBudget = group.QuotaEffective.SevenDayPercent
		}
		pool.InFlight += group.Current
		for _, credential := range group.Credentials {
			account := EngineAccount{
				CredentialID:  credential.ID,
				GroupID:       group.ID,
				Group:         group.Name,
				EmailMask:     maskEmail(credential.Name),
				Status:        credential.Status,
				FiveHour:      percent(credential.FiveHour),
				SevenDay:      percent(credential.SevenDay),
				FiveHourReset: deref(credential.FiveHour.ResetAt),
				SevenDayReset: deref(credential.SevenDay.ResetAt),
				CooldownUntil: deref(credential.CooldownUntil),
				Eligible:      group.Enabled && credential.Status == "available",
				Active:        credential.Active,
				Sessions:      credential.Sessions,
			}
			if observed := credential.Account; observed != nil {
				if observed.Email != "" {
					account.EmailMask = maskEmail(observed.Email)
				}
				account.Plan, account.Tier = observed.Plan, observed.Tier
				account.Observation, account.ObservedAt = observed.State, deref(observed.ObservedAt)
			}
			if activity := credential.Activity; activity != nil {
				account.Successes, account.Failures = activity.SuccessCount, activity.FailureCount
				account.LastUsedAt = deref(activity.LastUsedAt)
				account.LastFailure, account.LastFailureAt = activity.LastFailure, deref(activity.LastFailureAt)
			}
			if account.Eligible {
				row.Eligible++
			}
			pool.Accounts = append(pool.Accounts, account)
		}
		if group.Enabled {
			row.Slots = row.Eligible * snapshot.CredentialLimit
			if group.EffectiveLimit > 0 {
				row.Slots = min(row.Slots, group.EffectiveLimit)
			}
		}
		pool.EligibleAccounts += row.Eligible
		pool.EffectiveSlots += row.Slots
		pool.Groups = append(pool.Groups, row)
	}

	<-estimateDone
	if estimateErr != nil {
		pool.EstimateError = estimateErr.Error()
		return pool
	}
	pool.FiveHour = &EngineHorizon{estimate.FiveHour.RemainingUSD, estimate.FiveHour.RemainingLowUSD,
		estimate.FiveHour.RemainingHighUSD, estimate.FiveHour.CapacityUSD, estimate.FiveHour.Counted, estimate.FiveHour.Unknown}
	pool.Week = &EngineHorizon{estimate.Week.RemainingUSD, estimate.Week.RemainingLowUSD,
		estimate.Week.RemainingHighUSD, estimate.Week.CapacityUSD, estimate.Week.Counted, estimate.Week.Unknown}
	if estimate.Refills != nil {
		pool.Refills = estimate.Refills
	}
	byID := make(map[int]int, len(pool.Accounts))
	for i, account := range pool.Accounts {
		byID[account.CredentialID] = i
	}
	for _, row := range estimate.Accounts {
		if i, ok := byID[row.CredentialID]; ok {
			pool.Accounts[i].FiveHourRemainingUSD = row.FiveHour.RemainingUSD
			pool.Accounts[i].SevenDayRemainingUSD = row.SevenDay.RemainingUSD
			pool.Accounts[i].BurnUSDPerHour = row.BurnUSDPerHour
			pool.Accounts[i].SevenDayCapacityUSD = row.SevenDay.CapacityUSD
			pool.Accounts[i].SevenDayCapacitySource = row.SevenDay.Source
		}
	}
	pool.Runway = poolRunway(pool, "claude", pool.ObservedAt)
	return pool
}

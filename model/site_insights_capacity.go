package model

import (
	"cmp"
	"slices"
)

// CapacityHour is one hour of the capacity view. PoolPeak is absent on an
// hour stored under an older rollup version, which did not have it.
type CapacityHour struct {
	Hour              int64 `json:"hour"`
	Requests          int64 `json:"requests"`
	Errors            int64 `json:"errors"`
	PeakConcurrency   int   `json:"peak_concurrency"`
	PoolPeak          *int  `json:"pool_peak,omitempty"`
	EngineRejections  int64 `json:"engine_rejections"`
	UpstreamRateLimit int64 `json:"upstream_rate_limits"`
}

// UserPeak is the most requests one user had in flight at once.
type UserPeak struct {
	UserRef
	Peak     int   `json:"peak"`
	PeakAt   int64 `json:"peak_at"`
	Requests int64 `json:"requests"`
}

// CapacityInsights reconstructs concurrency from the request logs: a log is
// written when a request ends, so it was in flight from created_at - use_time
// to created_at. Root's requests are left out. Requests rejected before
// reaching the relay, such as the per-user concurrency limit, are not in the
// logs; the controller adds those from model.UserConcurrencyRejection.
//
// PeakConcurrency is the site's peak, on every channel; PoolPeak the most
// requests the engine served at once, the largest hourly pool peak. Requests
// and Errors count each request once; Attempts and AttemptErrors count every
// try on a channel. StaleHours counts the range's hours still stored under an
// older rollup version, which counted attempts as requests and had no pool
// peak: while any is left, PoolPeak and Attempts are absent rather than
// summed over part of the range.
type CapacityInsights struct {
	Requests        int64          `json:"requests"`
	Errors          int64          `json:"errors"`
	Attempts        *int64         `json:"attempts,omitempty"`
	AttemptErrors   *int64         `json:"attempt_errors,omitempty"`
	PeakConcurrency int            `json:"peak_concurrency"`
	PeakAt          int64          `json:"peak_at"`
	PoolPeak        *int           `json:"pool_peak,omitempty"`
	PoolPeakAt      *int64         `json:"pool_peak_at,omitempty"`
	PeakRPM         int64          `json:"peak_rpm"`
	PeakRPMAt       int64          `json:"peak_rpm_at"`
	ErrorCategories []NamedCount   `json:"error_categories"`
	Hourly          []CapacityHour `json:"hourly"`
	UserPeaks       []UserPeak     `json:"user_peaks"`
	Truncated       bool           `json:"truncated"`
	StaleHours      int            `json:"stale_hours"`
}

// vendorSummary is an hour's summary reduced to one vendor's capacity
// figures; an hour without the vendor's requests is empty.
func vendorSummary(summary insightSummary, vendor string) insightSummary {
	reduced := insightSummary{Truncated: summary.Truncated}
	if found := summary.Vendors[vendor]; found != nil {
		reduced.Requests, reduced.Errors = found.Requests, found.Errors
		reduced.Attempts, reduced.AttemptErrors = found.Attempts, found.AttemptErrors
		reduced.Peak, reduced.PeakAt = found.Peak, found.PeakAt
		reduced.PoolPeak, reduced.PoolPeakAt = found.PoolPeak, found.PoolPeakAt
		reduced.PeakRPM, reduced.PeakRPMAt = found.PeakRPM, found.PeakRPMAt
		reduced.EngineRejections, reduced.UpstreamRateLimit = found.EngineRejections, found.UpstreamRateLimit
		reduced.Categories = found.Categories
	}
	return reduced
}

type concurrencyEvent struct {
	at     int64
	delta  int
	userID int
}

// GetCapacityInsights reads the range's capacity figures, for every vendor or,
// when vendor is set, for that vendor's models alone. Users' peaks are not
// split by vendor, so a vendor's view has none.
func GetCapacityInsights(r InsightsRange, vendor string) (*CapacityInsights, error) {
	hours, stale, err := loadInsightHoursStale(r)
	if err != nil {
		return nil, err
	}
	result := &CapacityInsights{Hourly: make([]CapacityHour, 0, len(hours)), UserPeaks: []UserPeak{}, StaleHours: stale}
	categories := make(map[string]int64)
	users := make(map[int]*UserPeak)
	var attempts, attemptErrors int64
	var poolPeak int
	var poolPeakAt int64
	for _, hour := range hours {
		summary := hour.summary
		if vendor != "" {
			summary = vendorSummary(hour.summary, vendor)
		}
		result.Requests += summary.Requests
		result.Errors += summary.Errors
		attempts += summary.Attempts
		attemptErrors += summary.AttemptErrors
		result.Truncated = result.Truncated || summary.Truncated
		if summary.Peak > result.PeakConcurrency {
			result.PeakConcurrency, result.PeakAt = summary.Peak, summary.PeakAt
		}
		if summary.PoolPeak > poolPeak {
			poolPeak, poolPeakAt = summary.PoolPeak, summary.PoolPeakAt
		}
		if summary.PeakRPM > result.PeakRPM {
			result.PeakRPM, result.PeakRPMAt = summary.PeakRPM, summary.PeakRPMAt
		}
		mergeCounts(categories, summary.Categories)
		row := CapacityHour{
			Hour:              hour.start,
			Requests:          summary.Requests,
			Errors:            summary.Errors,
			PeakConcurrency:   summary.Peak,
			EngineRejections:  summary.EngineRejections,
			UpstreamRateLimit: summary.UpstreamRateLimit,
		}
		if !hour.stale {
			row.PoolPeak = &summary.PoolPeak
		}
		result.Hourly = append(result.Hourly, row)
		if vendor != "" {
			continue
		}
		for id, row := range hour.users {
			user := users[id]
			if user == nil {
				user = &UserPeak{UserRef: UserRef{UserID: id}}
				users[id] = user
			}
			user.Requests += row.Requests
			if row.Peak > user.Peak {
				user.Peak, user.PeakAt = row.Peak, row.PeakAt
			}
		}
	}
	result.ErrorCategories = sortedCounts(categories)
	if stale == 0 {
		result.Attempts, result.AttemptErrors = &attempts, &attemptErrors
		result.PoolPeak, result.PoolPeakAt = &poolPeak, &poolPeakAt
	}
	result.UserPeaks = make([]UserPeak, 0, len(users))
	for _, user := range users {
		result.UserPeaks = append(result.UserPeaks, *user)
	}
	slices.SortFunc(result.UserPeaks, func(a, b UserPeak) int {
		return cmp.Or(cmp.Compare(b.Peak, a.Peak), cmp.Compare(b.Requests, a.Requests), cmp.Compare(a.UserID, b.UserID))
	})
	result.UserPeaks = result.UserPeaks[:min(len(result.UserPeaks), insightsTopN*2)]
	ids := make([]int, 0, len(result.UserPeaks))
	for _, user := range result.UserPeaks {
		ids = append(ids, user.UserID)
	}
	names, err := usernamesByID(ids)
	if err != nil {
		return nil, err
	}
	for i := range result.UserPeaks {
		result.UserPeaks[i].Username = names[result.UserPeaks[i].UserID]
	}
	return result, nil
}

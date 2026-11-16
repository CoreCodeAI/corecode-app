package model

import (
	"cmp"
	"slices"
	"time"
)

// The keys view names each API key's requests, failures and spend. An hour
// keeps one row per key, model and staff flag in InsightKeyHour, computed from
// the same folded requests and charges as the other rollups (computeInsightHour)
// and written with the hour in one transaction. The view reads the rows of
// the hours stored at insightHourVersion or later by SQL, and the open hours
// from memory, as the other views do.
//
// Token 0 is a request sent without a key (the playground, console calls). An
// hour keeps the customers' keys with the most spend and the most requests
// (keepTopKeys); the rest of its customers' keys are summed into one row with
// token insightKeyOther, so the totals stay whole while an hour holds at most
// 2*insightKeyTopN+2 keys of the customers. Staff keys are not bounded: staff
// are few, and the view lists them apart.
const (
	insightKeyTopN  = 200
	insightKeyOther = -1
	// insightsKeyListN is how many keys the keys view lists by spend.
	insightsKeyListN = 100
	// insightsKeyModelsN is how many models a key lists by spend.
	insightsKeyModelsN = 3
)

// InsightKeyHour is one API key's figures in an hour, for one model. Requests
// and errors count folded requests as the hour does; ClientErrors is the part
// of Errors the customer caused (customerFault). Quota is what the key's
// charges came to, net of refunds written in the hour. UserId is the key's
// owner, 0 for token 0 and for the other-keys row; TokenName is the name the
// logs carried, the fallback when the key is gone from the tokens table.
type InsightKeyHour struct {
	HourStart    int64  `gorm:"primaryKey;autoIncrement:false"`
	TokenId      int    `gorm:"primaryKey;autoIncrement:false"`
	Staff        bool   `gorm:"primaryKey;autoIncrement:false"`
	ModelName    string `gorm:"primaryKey;type:varchar(191)"`
	UserId       int    `gorm:"not null;default:0"`
	TokenName    string `gorm:"type:varchar(191);not null;default:''"`
	Requests     int64  `gorm:"not null;default:0"`
	Errors       int64  `gorm:"not null;default:0"`
	ClientErrors int64  `gorm:"not null;default:0"`
	Quota        int64  `gorm:"not null;default:0"`
}

// insightKeyRowKey identifies a key row within an hour or across hours.
type insightKeyRowKey struct {
	tokenID int
	staff   bool
	model   string
}

// keyOf returns the hour's row for a key's model, created on first use.
func (h *insightHour) keyOf(tokenID int, tokenName string, userID int, staff bool, model string) *InsightKeyHour {
	key := insightKeyRowKey{tokenID, staff, model}
	row := h.keys[key]
	if row == nil {
		row = &InsightKeyHour{HourStart: h.start, TokenId: tokenID, Staff: staff, ModelName: model}
		if tokenID > 0 {
			row.UserId = userID
		}
		h.keys[key] = row
	}
	if row.TokenName == "" {
		row.TokenName = tokenName
	}
	return row
}

// keepTopKeys folds the customers' keys outside the hour's top insightKeyTopN
// by spend and top insightKeyTopN by requests into the other-keys row. Token 0
// and staff rows are never folded.
func (h *insightHour) keepTopKeys() {
	type keyLoad struct {
		id       int
		requests int64
		quota    int64
	}
	loads := make(map[int]*keyLoad)
	for key, row := range h.keys {
		if key.staff || key.tokenID <= 0 {
			continue
		}
		load := loads[key.tokenID]
		if load == nil {
			load = &keyLoad{id: key.tokenID}
			loads[key.tokenID] = load
		}
		load.requests += row.Requests
		load.quota += row.Quota
	}
	if len(loads) <= insightKeyTopN {
		return
	}
	list := make([]*keyLoad, 0, len(loads))
	for _, load := range loads {
		list = append(list, load)
	}
	bySpend := slices.Clone(list)
	slices.SortFunc(bySpend, func(a, b *keyLoad) int {
		return cmp.Or(cmp.Compare(b.quota, a.quota), cmp.Compare(a.id, b.id))
	})
	byRequests := list
	slices.SortFunc(byRequests, func(a, b *keyLoad) int {
		return cmp.Or(cmp.Compare(b.requests, a.requests), cmp.Compare(a.id, b.id))
	})
	kept := make(map[int]bool, 2*insightKeyTopN)
	for _, load := range bySpend[:insightKeyTopN] {
		kept[load.id] = true
	}
	for _, load := range byRequests[:insightKeyTopN] {
		kept[load.id] = true
	}
	for key, row := range h.keys {
		if key.staff || key.tokenID <= 0 || kept[key.tokenID] {
			continue
		}
		other := h.keyOf(insightKeyOther, "", 0, false, key.model)
		other.Requests += row.Requests
		other.Errors += row.Errors
		other.ClientErrors += row.ClientErrors
		other.Quota += row.Quota
		delete(h.keys, key)
	}
}

// insightKeyTotals sums key rows over the hours of a range, keyed as the rows.
type insightKeyTotals map[insightKeyRowKey]*InsightKeyHour

func (t insightKeyTotals) add(key insightKeyRowKey, row *InsightKeyHour) {
	total := t[key]
	if total == nil {
		total = &InsightKeyHour{TokenId: key.tokenID, Staff: key.staff, ModelName: key.model}
		t[key] = total
	}
	if total.UserId == 0 {
		total.UserId = row.UserId
	}
	if total.TokenName == "" {
		total.TokenName = row.TokenName
	}
	total.Requests += row.Requests
	total.Errors += row.Errors
	total.ClientErrors += row.ClientErrors
	total.Quota += row.Quota
}

// sumStoredKeys adds the key rows of the stored hours of the range to totals,
// by SQL. Only rows of an hour stored at insightHourVersion or later count: a
// row of an older version belongs to an hour the keys view counts as stale.
func sumStoredKeys(r InsightsRange, totals insightKeyTotals) error {
	var rows []struct {
		TokenId      int
		Staff        bool
		ModelName    string
		UserId       int
		TokenName    string
		Requests     int64
		Errors       int64
		ClientErrors int64
		Quota        int64
	}
	err := DB.Model(&InsightKeyHour{}).
		Select("insight_key_hours.token_id, insight_key_hours.staff, insight_key_hours.model_name, "+
			"MAX(insight_key_hours.user_id) AS user_id, MAX(insight_key_hours.token_name) AS token_name, "+
			"SUM(insight_key_hours.requests) AS requests, SUM(insight_key_hours.errors) AS errors, "+
			"SUM(insight_key_hours.client_errors) AS client_errors, SUM(insight_key_hours.quota) AS quota").
		Joins("JOIN insight_hours ON insight_hours.hour_start = insight_key_hours.hour_start AND insight_hours.version >= ?", insightHourVersion).
		Where("insight_key_hours.hour_start >= ? AND insight_key_hours.hour_start < ?", insightHourKey(r.Start), r.End).
		Group("insight_key_hours.token_id, insight_key_hours.staff, insight_key_hours.model_name").
		Scan(&rows).Error
	if err != nil {
		return err
	}
	for _, row := range rows {
		totals.add(insightKeyRowKey{row.TokenId, row.Staff, row.ModelName}, &InsightKeyHour{
			UserId: row.UserId, TokenName: row.TokenName, Requests: row.Requests,
			Errors: row.Errors, ClientErrors: row.ClientErrors, Quota: row.Quota,
		})
	}
	return nil
}

// APIKeyUsage is one API key over the range. Owner is the user the key
// belongs to; token 0 is the requests sent without a key, and the other-keys
// row has no owner. FailedRequests are the requests that were not served;
// ClientFailures is the part the customer caused, and ServiceFailureRate is
// the rest over Requests. Share is the key's part of the spend of its side,
// customers or staff.
// TopModels are the key's three largest models by spend.
type APIKeyUsage struct {
	TokenID            int             `json:"token_id"`
	TokenName          string          `json:"token_name"`
	Owner              UserRef         `json:"owner"`
	Requests           int64           `json:"requests"`
	FailedRequests     int64           `json:"failed_requests"`
	ClientFailures     int64           `json:"client_failures"`
	ServiceFailureRate float64         `json:"service_failure_rate"`
	QuotaUSD           float64         `json:"quota_usd"`
	Share              float64         `json:"share"`
	TopModels          []KeyModelUsage `json:"top_models"`
}

// KeyModelUsage is one model of a key over the range.
type KeyModelUsage struct {
	Model    string  `json:"model"`
	Requests int64   `json:"requests"`
	QuotaUSD float64 `json:"quota_usd"`
}

// KeyInsights is the customers' keys over the range and the staff keys apart.
// The headline figures count customers only, as the other views do; Keys lists
// the customers' keys with the most spend, and token 0 always. ActiveKeys
// counts the named customer keys with a request; KeysTruncated says that some
// keys were folded into OtherKeys in an hour, so ActiveKeys is a lower bound.
// StaleHours counts the range's hours stored under an older version: their
// keys are not in the figures until they are rebuilt.
type KeyInsights struct {
	Requests           int64         `json:"requests"`
	FailedRequests     int64         `json:"failed_requests"`
	ClientFailures     int64         `json:"client_failures"`
	ServiceFailureRate float64       `json:"service_failure_rate"`
	QuotaUSD           float64       `json:"quota_usd"`
	ActiveKeys         int64         `json:"active_keys"`
	KeysTruncated      bool          `json:"keys_truncated,omitempty"`
	Keys               []APIKeyUsage `json:"keys"`
	OtherKeys          *APIKeyUsage  `json:"other_keys,omitempty"`
	StaffRequests      int64         `json:"staff_requests"`
	StaffQuotaUSD      float64       `json:"staff_quota_usd"`
	StaffKeys          []APIKeyUsage `json:"staff_keys"`
	// FailingUsers are the customers with the most service failures, most
	// first, at most failingUsersListed; staff and keys with no owner are left out.
	FailingUsers []FailingUser `json:"failing_users"`
	StaleHours   int           `json:"stale_hours"`
}

// failingUsersListed is how many customers KeyInsights.FailingUsers names.
const failingUsersListed = 20

// FailingUser is one customer's requests over the range, the ones the service
// failed (a failure the customer did not cause), and the model that failed
// most for them. TopModelFailures counts that model's service failures.
type FailingUser struct {
	UserRef
	Requests           int64   `json:"requests"`
	ServiceFailures    int64   `json:"service_failures"`
	ServiceFailureRate float64 `json:"service_failure_rate"`
	TopModel           string  `json:"top_model"`
	TopModelFailures   int64   `json:"top_model_failures"`
}

// failingUserTotal is one customer's figures before the ranking.
type failingUserTotal struct {
	requests int64
	failures int64
	models   map[string]int64
}

// failingUsers ranks the customers by service failures over the key totals.
// Rows of staff keys and rows with no owner (token 0, the folded other keys)
// are left out.
func failingUsers(totals insightKeyTotals, staffIDs []int) ([]FailingUser, error) {
	staff := make(map[int]bool, len(staffIDs))
	for _, id := range staffIDs {
		staff[id] = true
	}
	byUser := make(map[int]*failingUserTotal)
	for key, row := range totals {
		if key.staff || row.UserId <= 0 || staff[row.UserId] {
			continue
		}
		total := byUser[row.UserId]
		if total == nil {
			total = &failingUserTotal{models: make(map[string]int64)}
			byUser[row.UserId] = total
		}
		failures := row.Errors - row.ClientErrors
		total.requests += row.Requests
		total.failures += failures
		total.models[key.model] += failures
	}
	list := make([]FailingUser, 0, len(byUser))
	ids := make([]int, 0, len(byUser))
	for id, total := range byUser {
		if total.failures <= 0 {
			continue
		}
		user := FailingUser{UserRef: UserRef{UserID: id}, Requests: total.requests, ServiceFailures: total.failures,
			ServiceFailureRate: ratio(float64(total.failures), float64(total.requests))}
		for name, failures := range total.models {
			if failures > user.TopModelFailures || (failures == user.TopModelFailures && name < user.TopModel) {
				user.TopModel, user.TopModelFailures = name, failures
			}
		}
		list = append(list, user)
		ids = append(ids, id)
	}
	slices.SortFunc(list, func(a, b FailingUser) int {
		return cmp.Or(cmp.Compare(b.ServiceFailures, a.ServiceFailures), cmp.Compare(a.UserID, b.UserID))
	})
	list = list[:min(len(list), failingUsersListed)]
	names, err := usernamesByID(ids)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Username = names[list[i].UserID]
	}
	return list, nil
}

// keyTotal is one key's figures over the range, before the shares.
type keyTotal struct {
	usage  APIKeyUsage
	quota  int64
	models map[string]*keyModelTotal
}

// keyModelTotal is one model's figures within a key.
type keyModelTotal struct {
	requests int64
	quota    int64
}

// aggregateKeys groups the rows of one side (customers or staff) by key.
func aggregateKeys(totals insightKeyTotals, staff bool) map[int]*keyTotal {
	keys := make(map[int]*keyTotal)
	for key, row := range totals {
		if key.staff != staff {
			continue
		}
		total := keys[key.tokenID]
		if total == nil {
			total = &keyTotal{
				usage:  APIKeyUsage{TokenID: key.tokenID, TokenName: row.TokenName, Owner: UserRef{UserID: row.UserId}},
				models: make(map[string]*keyModelTotal),
			}
			keys[key.tokenID] = total
		}
		if total.usage.TokenName == "" {
			total.usage.TokenName = row.TokenName
		}
		total.usage.Requests += row.Requests
		total.usage.FailedRequests += row.Errors
		total.usage.ClientFailures += row.ClientErrors
		total.quota += row.Quota
		model := total.models[key.model]
		if model == nil {
			model = &keyModelTotal{}
			total.models[key.model] = model
		}
		model.requests += row.Requests
		model.quota += row.Quota
	}
	return keys
}

// keyOrder sorts keys by spend, then requests, then token id.
func keyOrder(a, b *keyTotal) int {
	return cmp.Or(cmp.Compare(b.quota, a.quota), cmp.Compare(b.usage.Requests, a.usage.Requests), cmp.Compare(a.usage.TokenID, b.usage.TokenID))
}

// keyList returns the keys a side lists, in keyOrder: the insightsKeyListN
// named keys with the most spend, and token 0 always. The other-keys row is
// not in it.
func keyList(keys map[int]*keyTotal) []*keyTotal {
	named := make([]*keyTotal, 0, len(keys))
	for id, total := range keys {
		if id > 0 {
			named = append(named, total)
		}
	}
	slices.SortFunc(named, keyOrder)
	list := named[:min(len(named), insightsKeyListN)]
	if none := keys[0]; none != nil && !slices.Contains(list, none) {
		list = append(list, none)
	}
	slices.SortFunc(list, keyOrder)
	return list
}

// usageOf turns a key's totals into its listed form. share is taken of the
// spend of the side the key is on; the names come from keyNames.
func usageOf(total *keyTotal, sideQuota int64, names map[int]string, tokenNames map[int]string) APIKeyUsage {
	usage := total.usage
	usage.Owner.Username = names[usage.Owner.UserID]
	if name := tokenNames[usage.TokenID]; name != "" {
		usage.TokenName = name
	}
	usage.ServiceFailureRate = ratio(float64(usage.FailedRequests-usage.ClientFailures), float64(usage.Requests))
	usage.QuotaUSD = quotaUSD(total.quota)
	usage.Share = ratio(float64(total.quota), float64(sideQuota))
	modelNames := make([]string, 0, len(total.models))
	for name := range total.models {
		modelNames = append(modelNames, name)
	}
	slices.SortFunc(modelNames, func(a, b string) int {
		ma, mb := total.models[a], total.models[b]
		return cmp.Or(cmp.Compare(mb.quota, ma.quota), cmp.Compare(mb.requests, ma.requests), cmp.Compare(a, b))
	})
	usage.TopModels = make([]KeyModelUsage, 0, min(len(modelNames), insightsKeyModelsN))
	for _, name := range modelNames[:min(len(modelNames), insightsKeyModelsN)] {
		model := total.models[name]
		usage.TopModels = append(usage.TopModels, KeyModelUsage{Model: name, Requests: model.requests, QuotaUSD: quotaUSD(model.quota)})
	}
	return usage
}

// keyNames reads the names of the keys and the usernames of their owners.
// Deleted keys and users keep their names: the tables are read unscoped.
func keyNames(tokenIDs []int, ownerIDs []int) (map[int]string, map[int]string, error) {
	tokenNames := make(map[int]string, len(tokenIDs))
	if len(tokenIDs) > 0 {
		var tokens []struct {
			Id   int
			Name string
		}
		if err := DB.Model(&Token{}).Unscoped().Select("id, name").Where("id IN ?", tokenIDs).Find(&tokens).Error; err != nil {
			return nil, nil, err
		}
		for _, token := range tokens {
			tokenNames[token.Id] = token.Name
		}
	}
	names, err := usernamesByID(ownerIDs)
	return names, tokenNames, err
}

// GetKeyInsights reads the keys of the range: the stored hours by SQL and the
// open hours from memory. StaleHours counts the hours still stored under an
// older version, whose keys are not in the figures.
func GetKeyInsights(r InsightsRange) (*KeyInsights, error) {
	hours, stale, err := loadInsightHoursStale(r)
	if err != nil {
		return nil, err
	}
	totals := make(insightKeyTotals)
	if err := sumStoredKeys(r, totals); err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	for _, hour := range hours {
		if insightHourFinal(hour.start, now) {
			continue
		}
		for key, row := range hour.keys {
			totals.add(key, row)
		}
	}

	customers := aggregateKeys(totals, false)
	staff := aggregateKeys(totals, true)
	result := &KeyInsights{StaleHours: stale}
	var customerQuota, staffQuota int64
	for id, total := range customers {
		result.Requests += total.usage.Requests
		result.FailedRequests += total.usage.FailedRequests
		result.ClientFailures += total.usage.ClientFailures
		customerQuota += total.quota
		if id > 0 && total.usage.Requests > 0 {
			result.ActiveKeys++
		}
	}
	for _, total := range staff {
		result.StaffRequests += total.usage.Requests
		staffQuota += total.quota
	}
	result.QuotaUSD = quotaUSD(customerQuota)
	result.StaffQuotaUSD = quotaUSD(staffQuota)
	result.ServiceFailureRate = ratio(float64(result.FailedRequests-result.ClientFailures), float64(result.Requests))
	other := customers[insightKeyOther]
	result.KeysTruncated = other != nil && (other.usage.Requests > 0 || other.quota != 0)

	customerList, staffList := keyList(customers), keyList(staff)
	var tokenIDs, ownerIDs []int
	for _, list := range [][]*keyTotal{customerList, staffList} {
		for _, total := range list {
			if total.usage.TokenID > 0 {
				tokenIDs = append(tokenIDs, total.usage.TokenID)
			}
			if total.usage.Owner.UserID > 0 {
				ownerIDs = append(ownerIDs, total.usage.Owner.UserID)
			}
		}
	}
	names, tokenNames, err := keyNames(tokenIDs, ownerIDs)
	if err != nil {
		return nil, err
	}
	result.Keys = make([]APIKeyUsage, 0, len(customerList))
	for _, total := range customerList {
		result.Keys = append(result.Keys, usageOf(total, customerQuota, names, tokenNames))
	}
	result.StaffKeys = make([]APIKeyUsage, 0, len(staffList))
	for _, total := range staffList {
		result.StaffKeys = append(result.StaffKeys, usageOf(total, staffQuota, names, tokenNames))
	}
	if result.KeysTruncated {
		usage := usageOf(other, customerQuota, names, tokenNames)
		result.OtherKeys = &usage
	}
	staffIDs, err := StaffUserIDs()
	if err != nil {
		return nil, err
	}
	if result.FailingUsers, err = failingUsers(totals, staffIDs); err != nil {
		return nil, err
	}
	return result, nil
}

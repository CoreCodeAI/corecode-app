package model

import (
	"cmp"
	"maps"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// RiskUser is a user in a shared-address cluster. Paid means a real top-up:
// the top-up row a plan order also writes carries no credit and does not
// count. Subscription means any plan order that succeeded, LimitedPlan a plan
// limited per user bought within 30 days of the range's end.
type RiskUser struct {
	UserRef
	Requests     int64   `json:"requests"`
	Paid         bool    `json:"paid"`
	Subscription bool    `json:"subscription"`
	LimitedPlan  bool    `json:"limited_plan"`
	CreatedAt    int64   `json:"created_at"`
	BalanceUSD   float64 `json:"balance_usd"`
}

// SharedIP is a client address several accounts used in the range: they sent
// requests, signed in, acted on their keys or opened a plan order from it. It
// is one person with several accounts, a shared machine, or a reseller, unless
// SharedExit marks it a proxy or NAT exit by the rule the purchase check uses,
// taken at the range's end.
type SharedIP struct {
	IP       string     `json:"ip"`
	Users    []RiskUser `json:"users"`
	Requests int64      `json:"requests"`
	// SubscriptionBuyers counts accounts in the cluster that bought a plan
	// limited per user within 30 days of the range's end, which flags repeated
	// purchases of a once-per-user trial.
	SubscriptionBuyers int  `json:"subscription_buyers"`
	NewMembers         int  `json:"new_members"`
	SharedExit         bool `json:"shared_exit"`
}

// CountPoint is a count at the start of an hour or day.
type CountPoint struct {
	At    int64 `json:"at"`
	Count int64 `json:"count"`
}

// DomainCount is how many accounts registered with one email domain.
type DomainCount struct {
	Domain      string `json:"domain"`
	Count       int64  `json:"count"`
	Whitelisted bool   `json:"whitelisted"`
}

// AliasCluster is the accounts whose addresses deliver to one inbox.
type AliasCluster struct {
	Canonical string    `json:"canonical"`
	Users     []UserRef `json:"users"`
}

// UnpaidSpender is a sign-up of the range that consumed credit and never
// paid: everything it spent was given. ConsumptionUSD is its consumption in
// the range at list price, GiftPlanUSD the part given plans covered.
type UnpaidSpender struct {
	UserRef
	ConsumptionUSD float64 `json:"consumption_usd"`
	GiftPlanUSD    float64 `json:"gift_plan_usd"`
	SignupMethod   string  `json:"signup_method"`
	Inviter        UserRef `json:"inviter"`
	CreatedAt      int64   `json:"created_at"`
}

// InviterSpenders is an inviter of unpaid spenders.
type InviterSpenders struct {
	UserRef
	Accounts       int64   `json:"accounts"`
	ConsumptionUSD float64 `json:"consumption_usd"`
}

// GiftBlockInviter is an inviter whose invitees' sign-up gifts were withheld
// by the anti-farm checks (ip_used, cap_reached, email_blocked).
type GiftBlockInviter struct {
	UserRef
	Blocked int64 `json:"blocked"`
	Gifted  int64 `json:"gifted"`
}

// riskMatureAge is how old a sign-up must be at the range's end to count
// toward the never-used share: a younger one has had little time to send a
// request.
const riskMatureAge = 6 * 3600

// riskSharedIPLimit bounds the shared addresses sent, after ranking.
const riskSharedIPLimit = 50

// RiskInsights collects the signals of abusive sign-ups and shared accounts.
//
// Sign-ups include accounts deleted since (DeletedSignups of them), so a farm
// that was cleaned up still shows; root is left out. ZeroUseAccounts counts
// sign-ups with no successful request, ZeroUseFailed those of them whose
// requests in the range all failed. SignupsMature counts the sign-ups created
// at least riskMatureAge before the range's end, ZeroUseMature and
// ZeroUseFailedMature the same of them, so the never-used share compares
// cohorts of a fair age.
//
// AliasEmails counts sign-ups whose address delivers to the same inbox as
// another account's (case, a plus tag and Gmail's dots ignored), and
// AliasPatternEmails those whose address has a plus tag or a dotted Gmail
// local part, which the alias restriction refuses. OffWhitelist counts
// email sign-ups off the domain allowlist while the restriction is on
// (EmailRestriction); it is zero while the restriction is off.
//
// SharedIPs is ranked by risk before the cut: addresses that are not shared
// exits first, then by plan buyers, members created in the range and size.
// SharedIPTotal counts every shared address, SharedExits those that are
// exits.
//
// SignupSpenders counts sign-ups that consumed in the range, UnpaidSpenders
// those of them that never paid, with UnpaidSpendUSD their consumption.
// SignupGifts counts the invite sign-up gift's outcomes in the range.
type RiskInsights struct {
	Signups             int64              `json:"signups"`
	DeletedSignups      int64              `json:"deleted_signups"`
	SignupSeries        []CountPoint       `json:"signup_series"`
	SeriesUnit          string             `json:"series_unit"`
	PeakSignups         CountPoint         `json:"peak_signups"`
	SignupMethods       []NamedCount       `json:"signup_methods"`
	EmailDomains        []DomainCount      `json:"email_domains"`
	AliasEmails         int64              `json:"alias_emails"`
	AliasPatternEmails  int64              `json:"alias_pattern_emails"`
	AliasClusters       []AliasCluster     `json:"alias_clusters"`
	EmailRestriction    bool               `json:"email_restriction"`
	OffWhitelist        int64              `json:"off_whitelist"`
	SharedIPs           []SharedIP         `json:"shared_ips"`
	SharedIPTotal       int                `json:"shared_ip_total"`
	SharedExits         int                `json:"shared_exits"`
	Debtors             []BalanceUser      `json:"debtors"`
	ZeroUseAccounts     int64              `json:"zero_use_accounts"`
	ZeroUseFailed       int64              `json:"zero_use_failed"`
	SignupsMature       int64              `json:"signups_mature"`
	ZeroUseMature       int64              `json:"zero_use_mature"`
	ZeroUseFailedMature int64              `json:"zero_use_failed_mature"`
	SignupSpenders      int64              `json:"signup_spenders"`
	UnpaidSpenders      int64              `json:"unpaid_spenders"`
	UnpaidSpendUSD      float64            `json:"unpaid_spend_usd"`
	UnpaidSpenderTop    []UnpaidSpender    `json:"unpaid_spender_top"`
	UnpaidInviters      []InviterSpenders  `json:"unpaid_inviters"`
	SignupGifts         []NamedCount       `json:"signup_gifts"`
	GiftBlockInviters   []GiftBlockInviter `json:"gift_block_inviters"`
}

type riskUserRow struct {
	Id           int
	Username     string
	Email        string
	Quota        int64
	RequestCount int
	CreatedAt    int64
	GitHubId     string `gorm:"column:github_id"`
	OidcId       string
	LinuxDOId    string `gorm:"column:linux_do_id"`
	WeChatId     string `gorm:"column:wechat_id"`
	TelegramId   string
	DiscordId    string
	InviterId    int
	DeletedAt    gorm.DeletedAt
}

func readRiskUsers(query func(tx *gorm.DB) *gorm.DB) ([]riskUserRow, error) {
	var rows []riskUserRow
	tx := DB.Model(&User{}).Select("id, username, email, quota, request_count, created_at, github_id, oidc_id, linux_do_id, wechat_id, telegram_id, discord_id, inviter_id, deleted_at")
	if query != nil {
		tx = query(tx)
	}
	return rows, tx.Find(&rows).Error
}

// readRiskUsersByID reads the users of ids, deleted ones included.
func readRiskUsersByID(ids []int) (map[int]riskUserRow, error) {
	users := make(map[int]riskUserRow, len(ids))
	for chunk := range slices.Chunk(ids, sharedAddressChunk) {
		rows, err := readRiskUsers(func(tx *gorm.DB) *gorm.DB { return tx.Unscoped().Where("id IN ?", chunk) })
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			users[row.Id] = row
		}
	}
	return users, nil
}

// pluckUserIDs returns the distinct user ids query finds among ids.
func pluckUserIDs(db *gorm.DB, model any, ids []int, query string, args ...any) (map[int]bool, error) {
	found := make(map[int]bool)
	for chunk := range slices.Chunk(ids, sharedAddressChunk) {
		var rows []int
		if err := db.Model(model).Where("user_id IN ?", chunk).Where(query, args...).
			Distinct("user_id").Pluck("user_id", &rows).Error; err != nil {
			return nil, err
		}
		for _, id := range rows {
			found[id] = true
		}
	}
	return found, nil
}

// signupMethod names how an account was created. Third-party sign-in leaves
// its id; otherwise an email address means the emailed link or code.
func signupMethod(user riskUserRow) string {
	switch {
	case user.OidcId != "":
		return "oidc"
	case user.LinuxDOId != "":
		return "linuxdo"
	case user.GitHubId != "":
		return "github"
	case user.DiscordId != "":
		return "discord"
	case user.TelegramId != "":
		return "telegram"
	case user.WeChatId != "":
		return "wechat"
	case user.Email != "":
		return "email"
	default:
		return "password"
	}
}

func emailDomain(email string) string {
	_, domain, ok := strings.Cut(strings.ToLower(strings.TrimSpace(email)), "@")
	if !ok {
		return ""
	}
	return domain
}

// aliasEmail reports a plus tag, or dots in a Gmail local part: the forms the
// alias restriction refuses. It does not mean another account has the inbox.
func aliasEmail(email string) bool {
	local, domain, ok := strings.Cut(strings.ToLower(email), "@")
	if !ok {
		return false
	}
	return strings.Contains(local, "+") || (domain == "gmail.com" || domain == "googlemail.com") && strings.Contains(local, ".")
}

// canonicalEmail is the inbox an address delivers to: lower case, without a
// plus tag, and for Gmail without dots.
func canonicalEmail(email string) string {
	local, domain, ok := strings.Cut(strings.ToLower(strings.TrimSpace(email)), "@")
	if !ok || domain == "" {
		return ""
	}
	local, _, _ = strings.Cut(local, "+")
	if domain == "googlemail.com" {
		domain = "gmail.com"
	}
	if domain == "gmail.com" {
		local = strings.ReplaceAll(local, ".", "")
	}
	if local == "" {
		return ""
	}
	return local + "@" + domain
}

func GetRiskInsights(r InsightsRange) (*RiskInsights, error) {
	signups, err := readRiskUsers(func(tx *gorm.DB) *gorm.DB {
		return tx.Unscoped().Where("created_at >= ? AND created_at < ? AND role < ?", r.Start, r.End, common.RoleRootUser)
	})
	if err != nil {
		return nil, err
	}
	result := &RiskInsights{Signups: int64(len(signups)), SeriesUnit: "hour", EmailRestriction: common.EmailDomainRestrictionEnabled}
	step := int64(3600)
	floor := r.HourStart
	if r.End-r.Start > 3*86400 {
		result.SeriesUnit, step, floor = "day", 86400, r.DayStart
	}
	series := make(map[int64]int64)
	for at := floor(r.Start); at < r.End; at += step {
		series[at] = 0
	}
	whitelist := make(map[string]bool, len(common.EmailDomainWhitelist))
	for _, domain := range common.EmailDomainWhitelist {
		if domain = strings.ToLower(strings.TrimSpace(domain)); domain != "" {
			whitelist[domain] = true
		}
	}
	// The restriction covers addresses typed in for a link or a code, not the
	// ones a third-party sign-in brings, and an empty list restricts nothing.
	restricted := common.EmailDomainRestrictionEnabled && len(whitelist) > 0
	methods := make(map[string]int64)
	domains := make(map[string]int64)
	zeroUse := make(map[int]bool)
	for _, user := range signups {
		series[floor(user.CreatedAt)]++
		method := signupMethod(user)
		methods[method]++
		if user.DeletedAt.Valid {
			result.DeletedSignups++
		}
		if domain := emailDomain(user.Email); domain != "" {
			domains[domain]++
			if restricted && method == "email" && !whitelist[domain] {
				result.OffWhitelist++
			}
			if aliasEmail(user.Email) {
				result.AliasPatternEmails++
			}
		}
		if user.RequestCount == 0 {
			result.ZeroUseAccounts++
			zeroUse[user.Id] = user.CreatedAt < r.End-riskMatureAge
		}
		if user.CreatedAt < r.End-riskMatureAge {
			result.SignupsMature++
			if user.RequestCount == 0 {
				result.ZeroUseMature++
			}
		}
	}
	for at, count := range series {
		result.SignupSeries = append(result.SignupSeries, CountPoint{At: at, Count: count})
		if count > result.PeakSignups.Count {
			result.PeakSignups = CountPoint{At: at, Count: count}
		}
	}
	slices.SortFunc(result.SignupSeries, func(a, b CountPoint) int { return cmp.Compare(a.At, b.At) })
	result.SignupMethods = sortedCounts(methods)
	for _, domain := range sortedCounts(domains) {
		result.EmailDomains = append(result.EmailDomains, DomainCount{Domain: domain.Name, Count: domain.Count, Whitelisted: whitelist[domain.Name]})
	}
	if len(result.EmailDomains) > 20 {
		result.EmailDomains = result.EmailDomains[:20]
	}

	if err := fillAliasClusters(signups, result); err != nil {
		return nil, err
	}
	if len(zeroUse) > 0 {
		failed, err := pluckUserIDs(LOG_DB, &Log{}, slices.Sorted(maps.Keys(zeroUse)),
			"type = ? AND created_at >= ? AND created_at < ?", LogTypeError, r.Start, r.End)
		if err != nil {
			return nil, err
		}
		for id := range failed {
			result.ZeroUseFailed++
			if zeroUse[id] {
				result.ZeroUseFailedMature++
			}
		}
	}
	if err := fillUnpaidSpenders(r, signups, result); err != nil {
		return nil, err
	}
	if err := fillSignupGifts(r, result); err != nil {
		return nil, err
	}
	if err := fillSharedIPs(r, result); err != nil {
		return nil, err
	}
	balances := &FinanceInsights{}
	if err := fillBalances(balances, nil); err != nil {
		return nil, err
	}
	result.Debtors = balances.Debtors
	return result, nil
}

// fillAliasClusters counts the sign-ups whose inbox another account, of any
// time, shares.
func fillAliasClusters(signups []riskUserRow, result *RiskInsights) error {
	wanted := make(map[string]bool)
	for _, user := range signups {
		if canonical := canonicalEmail(user.Email); canonical != "" {
			wanted[canonical] = true
		}
	}
	result.AliasClusters = []AliasCluster{}
	if len(wanted) == 0 {
		return nil
	}
	var accounts []struct {
		Id       int
		Username string
		Email    string
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, username, email").Where("email <> ''").Find(&accounts).Error; err != nil {
		return err
	}
	groups := make(map[string][]UserRef)
	for _, account := range accounts {
		if canonical := canonicalEmail(account.Email); wanted[canonical] {
			groups[canonical] = append(groups[canonical], UserRef{UserID: account.Id, Username: account.Username})
		}
	}
	for _, user := range signups {
		if len(groups[canonicalEmail(user.Email)]) > 1 {
			result.AliasEmails++
		}
	}
	for canonical, users := range groups {
		if len(users) < 2 {
			continue
		}
		slices.SortFunc(users, func(a, b UserRef) int { return cmp.Compare(a.UserID, b.UserID) })
		result.AliasClusters = append(result.AliasClusters, AliasCluster{Canonical: canonical, Users: users})
	}
	slices.SortFunc(result.AliasClusters, func(a, b AliasCluster) int {
		return cmp.Or(cmp.Compare(len(b.Users), len(a.Users)), cmp.Compare(a.Canonical, b.Canonical))
	})
	if len(result.AliasClusters) > 20 {
		result.AliasClusters = result.AliasClusters[:20]
	}
	return nil
}

// fillUnpaidSpenders finds the sign-ups that consumed in the range and never
// paid through a gateway, from the hourly rollup: gift farmers that share no
// address still show here. A sign-up of the range consumed nothing before it.
func fillUnpaidSpenders(r InsightsRange, signups []riskUserRow, result *RiskInsights) error {
	result.UnpaidSpenderTop = []UnpaidSpender{}
	result.UnpaidInviters = []InviterSpenders{}
	if len(signups) == 0 {
		return nil
	}
	byID := make(map[int]riskUserRow, len(signups))
	for _, user := range signups {
		byID[user.Id] = user
	}
	hours, err := loadInsightHours(r)
	if err != nil {
		return err
	}
	type spend struct{ quota, gift int64 }
	spent := make(map[int]*spend)
	for _, hour := range hours {
		for _, user := range hour.users {
			if _, ok := byID[user.UserId]; !ok {
				continue
			}
			entry := spent[user.UserId]
			if entry == nil {
				entry = &spend{}
				spent[user.UserId] = entry
			}
			entry.quota += user.Quota
			entry.gift += user.GiftQuota
		}
	}
	ids := make([]int, 0, len(spent))
	for id, entry := range spent {
		if entry.quota > 0 {
			ids = append(ids, id)
		}
	}
	result.SignupSpenders = int64(len(ids))
	if len(ids) == 0 {
		return nil
	}
	paid, err := pluckUserIDs(DB, &TopUp{}, ids, "status = ? AND money > 0 AND (payment_provider IS NULL OR payment_provider <> ?)",
		common.TopUpStatusSuccess, PaymentProviderBalance)
	if err != nil {
		return err
	}
	var unpaid []UnpaidSpender
	inviters := make(map[int]*InviterSpenders)
	inviterQuota := make(map[int]int64)
	var total int64
	for _, id := range ids {
		if paid[id] {
			continue
		}
		user := byID[id]
		entry := spent[id]
		total += entry.quota
		unpaid = append(unpaid, UnpaidSpender{
			UserRef:        UserRef{UserID: id, Username: user.Username},
			ConsumptionUSD: quotaUSD(entry.quota),
			GiftPlanUSD:    quotaUSD(entry.gift),
			SignupMethod:   signupMethod(user),
			Inviter:        UserRef{UserID: user.InviterId},
			CreatedAt:      user.CreatedAt,
		})
		if user.InviterId > 0 {
			inviter := inviters[user.InviterId]
			if inviter == nil {
				inviter = &InviterSpenders{UserRef: UserRef{UserID: user.InviterId}}
				inviters[user.InviterId] = inviter
			}
			inviter.Accounts++
			inviterQuota[user.InviterId] += entry.quota
		}
	}
	result.UnpaidSpenders = int64(len(unpaid))
	result.UnpaidSpendUSD = quotaUSD(total)
	slices.SortFunc(unpaid, func(a, b UnpaidSpender) int {
		return cmp.Or(cmp.Compare(b.ConsumptionUSD, a.ConsumptionUSD), cmp.Compare(a.UserID, b.UserID))
	})
	unpaid = unpaid[:min(len(unpaid), insightsTopN)]
	ranked := make([]InviterSpenders, 0, len(inviters))
	for _, inviter := range inviters {
		inviter.ConsumptionUSD = quotaUSD(inviterQuota[inviter.UserID])
		ranked = append(ranked, *inviter)
	}
	slices.SortFunc(ranked, func(a, b InviterSpenders) int {
		return cmp.Or(cmp.Compare(b.Accounts, a.Accounts), cmp.Compare(b.ConsumptionUSD, a.ConsumptionUSD), cmp.Compare(a.UserID, b.UserID))
	})
	ranked = ranked[:min(len(ranked), insightsTopN)]
	nameIDs := make([]int, 0, len(ranked)+len(unpaid))
	for _, inviter := range ranked {
		nameIDs = append(nameIDs, inviter.UserID)
	}
	for _, spender := range unpaid {
		if spender.Inviter.UserID > 0 {
			nameIDs = append(nameIDs, spender.Inviter.UserID)
		}
	}
	names, err := usernamesByID(nameIDs)
	if err != nil {
		return err
	}
	for i := range ranked {
		ranked[i].Username = names[ranked[i].UserID]
	}
	for i := range unpaid {
		unpaid[i].Inviter.Username = names[unpaid[i].Inviter.UserID]
	}
	result.UnpaidSpenderTop = unpaid
	result.UnpaidInviters = ranked
	return nil
}

// fillSignupGifts counts the invite sign-up gift's outcomes in the range and
// names the inviters whose invitees the anti-farm checks refused most.
// email_signup is a policy exclusion, not a block.
func fillSignupGifts(r InsightsRange, result *RiskInsights) error {
	var outcomes []struct {
		InviterId int
		Status    string
		Total     int64
	}
	if err := DB.Model(&AffiliateSignupGift{}).Select("inviter_id, status, COUNT(*) AS total").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).Group("inviter_id, status").Find(&outcomes).Error; err != nil {
		return err
	}
	statuses := make(map[string]int64)
	inviters := make(map[int]*GiftBlockInviter)
	for _, outcome := range outcomes {
		statuses[outcome.Status] += outcome.Total
		inviter := inviters[outcome.InviterId]
		if inviter == nil {
			inviter = &GiftBlockInviter{UserRef: UserRef{UserID: outcome.InviterId}}
			inviters[outcome.InviterId] = inviter
		}
		switch outcome.Status {
		case AffiliateSignupGiftIpUsed, AffiliateSignupGiftCapReached, AffiliateSignupGiftEmailBlocked:
			inviter.Blocked += outcome.Total
		case AffiliateSignupGiftGiven:
			inviter.Gifted += outcome.Total
		}
	}
	result.SignupGifts = sortedCounts(statuses)
	blocked := make([]GiftBlockInviter, 0, len(inviters))
	for _, inviter := range inviters {
		if inviter.Blocked > 0 {
			blocked = append(blocked, *inviter)
		}
	}
	slices.SortFunc(blocked, func(a, b GiftBlockInviter) int {
		return cmp.Or(cmp.Compare(b.Blocked, a.Blocked), cmp.Compare(b.Gifted, a.Gifted), cmp.Compare(a.UserID, b.UserID))
	})
	blocked = blocked[:min(len(blocked), insightsTopN)]
	ids := make([]int, 0, len(blocked))
	for _, inviter := range blocked {
		ids = append(ids, inviter.UserID)
	}
	names, err := usernamesByID(ids)
	if err != nil {
		return err
	}
	for i := range blocked {
		blocked[i].Username = names[blocked[i].UserID]
	}
	result.GiftBlockInviters = blocked
	return nil
}

// fillSharedIPs groups the addresses accounts used in the range: request
// logs, sign-in and key audit entries, console sessions and plan orders. It
// keeps those used by more than one account and ranks them by risk before
// the cut.
func fillSharedIPs(r InsightsRange, result *RiskInsights) error {
	type addressUse struct {
		UserId   int
		Ip       string
		Requests int64
	}
	var uses, found []addressUse
	if err := LOG_DB.Model(&Log{}).Select("user_id, ip, COUNT(*) AS requests").
		Where("created_at >= ? AND created_at < ? AND ip <> '' AND type IN ?", r.Start, r.End, []int{LogTypeConsume, LogTypeError}).
		Group("user_id, ip").Find(&uses).Error; err != nil {
		return err
	}
	if err := LOG_DB.Model(&AuditLog{}).Select("user_id, ip, 0 AS requests").
		Where("created_at >= ? AND created_at < ? AND ip <> '' AND user_id > 0 AND category IN ?", r.Start, r.End,
			[]string{AuditCategoryLogin, AuditCategorySecurity}).
		Group("user_id, ip").Find(&found).Error; err != nil {
		return err
	}
	uses = append(uses, found...)
	found = nil
	if err := DB.Model(&UserSession{}).Select("user_id, ip, 0 AS requests").
		Where("created_at >= ? AND created_at < ? AND ip <> '' AND user_id > 0", r.Start, r.End).
		Group("user_id, ip").Find(&found).Error; err != nil {
		return err
	}
	uses = append(uses, found...)
	found = nil
	if err := DB.Model(&SubscriptionOrder{}).Select("user_id, ip, 0 AS requests").
		Where("create_time >= ? AND create_time < ? AND ip <> '' AND user_id > 0", r.Start, r.End).
		Group("user_id, ip").Find(&found).Error; err != nil {
		return err
	}
	uses = append(uses, found...)

	byIP := make(map[string]map[int]int64)
	for _, use := range uses {
		if byIP[use.Ip] == nil {
			byIP[use.Ip] = make(map[int]int64)
		}
		byIP[use.Ip][use.UserId] += use.Requests
	}
	members := make(map[int]bool)
	ips := make([]string, 0, len(byIP))
	for ip, users := range byIP {
		if len(users) < 2 {
			delete(byIP, ip)
			continue
		}
		ips = append(ips, ip)
		for id := range users {
			members[id] = true
		}
	}
	result.SharedIPs = []SharedIP{}
	if len(byIP) == 0 {
		return nil
	}
	ids := slices.Sorted(maps.Keys(members))
	userByID, err := readRiskUsersByID(ids)
	if err != nil {
		return err
	}
	// A plan order also writes a top-up row with no credit; only a top-up
	// that credited the wallet is one.
	paid, err := pluckUserIDs(DB, &TopUp{}, ids, "status = ? AND money > 0 AND amount > 0", common.TopUpStatusSuccess)
	if err != nil {
		return err
	}
	subscribed, err := pluckUserIDs(DB, &SubscriptionOrder{}, ids, "status = ?", common.TopUpStatusSuccess)
	if err != nil {
		return err
	}
	limited := make(map[int]bool)
	for chunk := range slices.Chunk(ids, sharedAddressChunk) {
		buyers, err := limitedPlanBuyers(chunk, r.End-sharedAddressWindowSeconds)
		if err != nil {
			return err
		}
		for _, id := range buyers {
			limited[id] = true
		}
	}
	exits, err := sharedExits(ips, min(r.End, common.GetTimestamp()))
	if err != nil {
		return err
	}
	clusters := make([]SharedIP, 0, len(byIP))
	for ip, users := range byIP {
		cluster := SharedIP{IP: ip, SharedExit: exits[ip]}
		for id, requests := range users {
			user := userByID[id]
			cluster.Users = append(cluster.Users, RiskUser{
				UserRef:      UserRef{UserID: id, Username: user.Username},
				Requests:     requests,
				Paid:         paid[id],
				Subscription: subscribed[id],
				LimitedPlan:  limited[id],
				CreatedAt:    user.CreatedAt,
				BalanceUSD:   quotaUSD(user.Quota),
			})
			cluster.Requests += requests
			if limited[id] {
				cluster.SubscriptionBuyers++
			}
			if user.CreatedAt >= r.Start && user.CreatedAt < r.End {
				cluster.NewMembers++
			}
		}
		slices.SortFunc(cluster.Users, func(a, b RiskUser) int {
			return cmp.Or(cmp.Compare(b.Requests, a.Requests), cmp.Compare(a.UserID, b.UserID))
		})
		if cluster.SharedExit {
			result.SharedExits++
		}
		clusters = append(clusters, cluster)
	}
	slices.SortFunc(clusters, func(a, b SharedIP) int {
		return cmp.Or(compareBool(a.SharedExit, b.SharedExit), cmp.Compare(b.SubscriptionBuyers, a.SubscriptionBuyers),
			cmp.Compare(b.NewMembers, a.NewMembers), cmp.Compare(len(b.Users), len(a.Users)),
			cmp.Compare(b.Requests, a.Requests), cmp.Compare(a.IP, b.IP))
	})
	result.SharedIPTotal = len(clusters)
	result.SharedIPs = clusters[:min(len(clusters), riskSharedIPLimit)]
	return nil
}

// compareBool orders false before true.
func compareBool(a, b bool) int {
	switch {
	case a == b:
		return 0
	case a:
		return 1
	default:
		return -1
	}
}

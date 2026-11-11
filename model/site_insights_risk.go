package model

import (
	"cmp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// RiskUser is a user in a shared-address cluster.
type RiskUser struct {
	UserRef
	Requests     int64   `json:"requests"`
	Paid         bool    `json:"paid"`
	Subscription bool    `json:"subscription"`
	CreatedAt    int64   `json:"created_at"`
	BalanceUSD   float64 `json:"balance_usd"`
}

// SharedIP is a client address several accounts sent requests or signed in
// from: one person with several accounts, a shared machine, or a reseller.
type SharedIP struct {
	IP       string     `json:"ip"`
	Users    []RiskUser `json:"users"`
	Requests int64      `json:"requests"`
	// SubscriptionBuyers counts accounts in the cluster that bought a plan,
	// which flags repeated purchases of a once-per-user trial.
	SubscriptionBuyers int `json:"subscription_buyers"`
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

// riskMatureAge is how old a sign-up must be at the range's end to count
// toward the never-used share: a younger one has had little time to send a
// request.
const riskMatureAge = 6 * 3600

// RiskInsights collects the signals of abusive sign-ups and shared accounts.
// SignupsMature counts the sign-ups created at least riskMatureAge before
// the range's end, and ZeroUseMature those of them that never sent a
// request, so the never-used share compares cohorts of a fair age.
type RiskInsights struct {
	Signups         int64         `json:"signups"`
	SignupSeries    []CountPoint  `json:"signup_series"`
	SeriesUnit      string        `json:"series_unit"`
	PeakSignups     CountPoint    `json:"peak_signups"`
	SignupMethods   []NamedCount  `json:"signup_methods"`
	EmailDomains    []DomainCount `json:"email_domains"`
	AliasEmails     int64         `json:"alias_emails"`
	OffWhitelist    int64         `json:"off_whitelist"`
	SharedIPs       []SharedIP    `json:"shared_ips"`
	Debtors         []BalanceUser `json:"debtors"`
	ZeroUseAccounts int64         `json:"zero_use_accounts"`
	SignupsMature   int64         `json:"signups_mature"`
	ZeroUseMature   int64         `json:"zero_use_mature"`
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
}

func readRiskUsers(query func(tx *gorm.DB) *gorm.DB) ([]riskUserRow, error) {
	var rows []riskUserRow
	tx := DB.Model(&User{}).Select("id, username, email, quota, request_count, created_at, github_id, oidc_id, linux_do_id, wechat_id, telegram_id, discord_id, inviter_id")
	if query != nil {
		tx = query(tx)
	}
	return rows, tx.Find(&rows).Error
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

// aliasEmail reports a plus tag, or dots in a Gmail local part, both of which
// deliver to an address that already has an account.
func aliasEmail(email string) bool {
	local, domain, ok := strings.Cut(strings.ToLower(email), "@")
	if !ok {
		return false
	}
	return strings.Contains(local, "+") || (domain == "gmail.com" || domain == "googlemail.com") && strings.Contains(local, ".")
}

func GetRiskInsights(r InsightsRange) (*RiskInsights, error) {
	signups, err := readRiskUsers(func(tx *gorm.DB) *gorm.DB {
		return tx.Where("created_at >= ? AND created_at < ?", r.Start, r.End)
	})
	if err != nil {
		return nil, err
	}
	result := &RiskInsights{Signups: int64(len(signups)), SeriesUnit: "hour"}
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
		whitelist[strings.ToLower(domain)] = true
	}
	methods := make(map[string]int64)
	domains := make(map[string]int64)
	for _, user := range signups {
		series[floor(user.CreatedAt)]++
		methods[signupMethod(user)]++
		if domain := emailDomain(user.Email); domain != "" {
			domains[domain]++
			if !whitelist[domain] {
				result.OffWhitelist++
			}
			if aliasEmail(user.Email) {
				result.AliasEmails++
			}
		}
		if user.RequestCount == 0 {
			result.ZeroUseAccounts++
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

	if result.SharedIPs, err = sharedIPs(r); err != nil {
		return nil, err
	}
	balances := &FinanceInsights{}
	if err := fillBalances(balances, nil); err != nil {
		return nil, err
	}
	result.Debtors = balances.Debtors
	return result, nil
}

// sharedIPs groups the addresses of request logs and sign-in audit entries
// in the range by account, and keeps those used by more than one.
func sharedIPs(r InsightsRange) ([]SharedIP, error) {
	type addressUse struct {
		UserId   int
		Ip       string
		Requests int64
	}
	var requestUses, signInUses []addressUse
	if err := LOG_DB.Model(&Log{}).Select("user_id, ip, COUNT(*) AS requests").
		Where("created_at >= ? AND created_at < ? AND ip <> '' AND type IN ?", r.Start, r.End, []int{LogTypeConsume, LogTypeError}).
		Group("user_id, ip").Find(&requestUses).Error; err != nil {
		return nil, err
	}
	if err := LOG_DB.Model(&AuditLog{}).Select("user_id, ip, 0 AS requests").
		Where("created_at >= ? AND created_at < ? AND ip <> '' AND user_id > 0 AND category = ?", r.Start, r.End, AuditCategorySecurity).
		Group("user_id, ip").Find(&signInUses).Error; err != nil {
		return nil, err
	}
	byIP := make(map[string]map[int]int64)
	for _, use := range append(requestUses, signInUses...) {
		if byIP[use.Ip] == nil {
			byIP[use.Ip] = make(map[int]int64)
		}
		byIP[use.Ip][use.UserId] += use.Requests
	}
	var ids []int
	for ip, users := range byIP {
		if len(users) < 2 {
			delete(byIP, ip)
			continue
		}
		for id := range users {
			ids = append(ids, id)
		}
	}
	if len(byIP) == 0 {
		return []SharedIP{}, nil
	}
	users, err := readRiskUsers(func(tx *gorm.DB) *gorm.DB { return tx.Unscoped().Where("id IN ?", ids) })
	if err != nil {
		return nil, err
	}
	userByID := make(map[int]riskUserRow, len(users))
	for _, user := range users {
		userByID[user.Id] = user
	}
	var paidIDs, subscriberIDs []int
	if err := DB.Model(&TopUp{}).Where("user_id IN ? AND status = ? AND money > 0", ids, common.TopUpStatusSuccess).
		Distinct("user_id").Pluck("user_id", &paidIDs).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&SubscriptionOrder{}).Where("user_id IN ? AND status = ?", ids, common.TopUpStatusSuccess).
		Distinct("user_id").Pluck("user_id", &subscriberIDs).Error; err != nil {
		return nil, err
	}
	paid := make(map[int]bool, len(paidIDs))
	for _, id := range paidIDs {
		paid[id] = true
	}
	subscribed := make(map[int]bool, len(subscriberIDs))
	for _, id := range subscriberIDs {
		subscribed[id] = true
	}
	result := make([]SharedIP, 0, len(byIP))
	for ip, members := range byIP {
		cluster := SharedIP{IP: ip}
		for id, requests := range members {
			user := userByID[id]
			cluster.Users = append(cluster.Users, RiskUser{
				UserRef:      UserRef{UserID: id, Username: user.Username},
				Requests:     requests,
				Paid:         paid[id],
				Subscription: subscribed[id],
				CreatedAt:    user.CreatedAt,
				BalanceUSD:   quotaUSD(user.Quota),
			})
			cluster.Requests += requests
			if subscribed[id] {
				cluster.SubscriptionBuyers++
			}
		}
		slices.SortFunc(cluster.Users, func(a, b RiskUser) int { return cmp.Compare(b.Requests, a.Requests) })
		result = append(result, cluster)
	}
	slices.SortFunc(result, func(a, b SharedIP) int {
		return cmp.Or(cmp.Compare(len(b.Users), len(a.Users)), cmp.Compare(b.Requests, a.Requests), cmp.Compare(a.IP, b.IP))
	})
	if len(result) > 50 {
		result = result[:50]
	}
	return result, nil
}

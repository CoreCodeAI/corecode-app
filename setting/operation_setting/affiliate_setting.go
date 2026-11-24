package operation_setting

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// AffiliateSetting runs the invitation program. An affiliate on the
// commission reward earns their own rate on what the users they invited paid
// for and then consumed; one on the bonus reward earns InviteBonus once per
// invitee instead. A distributor channel also earns SecondLevelRate on the
// users its invitees invite. Rates are whole percents; money amounts are in
// the payment currency.
type AffiliateSetting struct {
	Enabled bool `json:"enabled"`
	// SelfServeRate is the default rate every user has while the program is
	// on, unless an administrator set another; 0 gives no one a default.
	SelfServeRate int `json:"self_serve_rate"`
	// MaxRate bounds the rate an administrator can grant.
	MaxRate         int `json:"max_rate"`
	SecondLevelRate int `json:"second_level_rate"`
	// MinWithdrawal is the smallest payout a channel can request.
	MinWithdrawal int `json:"min_withdrawal"`
	// GiftPlanId and RetailGiftPlanId are the subscription plans a
	// distributor's and a retail channel's invitees receive, free, when they
	// sign up; 0 gives that tier's invitees nothing.
	GiftPlanId       int `json:"gift_plan_id"`
	RetailGiftPlanId int `json:"retail_gift_plan_id"`
	// GiftDailyCap bounds the sign-up gifts one inviter's invitees receive in
	// 24 hours; 0 is no bound.
	GiftDailyCap int `json:"gift_daily_cap"`
	// GiftIpLimit bounds the sign-up gifts, a channel's plan or the invite
	// bonus, given to sign-ups from one address in 30 days; 0 is no bound.
	GiftIpLimit int `json:"gift_ip_limit"`
	// InviteBonus is what an inviter on the bonus reward and each of their
	// invitees receive, in display currency: the invitee when they sign up,
	// the inviter once the invitee has paid at least as much. 0 gives
	// nothing.
	InviteBonus float64 `json:"invite_bonus"`
	// GiftBlockedEmailDomains lists address domains, one per line or comma
	// separated, whose sign-ups receive no gift.
	GiftBlockedEmailDomains string `json:"gift_blocked_email_domains"`
	// ReservedCodeWords lists words, one per line or comma separated, that a
	// user may not choose as their code. Root's codes are not checked.
	ReservedCodeWords string `json:"reserved_code_words"`
}

var affiliateSetting = AffiliateSetting{
	SelfServeRate:     10,
	MaxRate:           30,
	SecondLevelRate:   5,
	MinWithdrawal:     100,
	GiftDailyCap:      50,
	GiftIpLimit:       5,
	InviteBonus:       5,
	ReservedCodeWords: "corecode\nalphafox\nanthropic\nclaude\nofficial\nguanfang\nadmin\nsupport\nkefu",
}

func init() {
	config.GlobalConfig.Register("affiliate_setting", &affiliateSetting)
}

func GetAffiliateSetting() *AffiliateSetting {
	return &affiliateSetting
}

// ValidateAffiliateOption checks one affiliate_setting field value before it
// is saved.
func ValidateAffiliateOption(field string, value string) error {
	switch field {
	case "self_serve_rate", "max_rate", "second_level_rate":
		if number, err := strconv.Atoi(value); err != nil || number < 0 || number > 100 {
			return fmt.Errorf("Affiliate %s must be a whole percent between 0 and 100", field)
		}
	case "min_withdrawal", "gift_plan_id", "retail_gift_plan_id", "gift_daily_cap", "gift_ip_limit":
		if number, err := strconv.Atoi(value); err != nil || number < 0 {
			return fmt.Errorf("Affiliate %s must be a non-negative whole number", field)
		}
	case "invite_bonus":
		if number, err := strconv.ParseFloat(value, 64); err != nil || number < 0 || number > 1000 {
			return fmt.Errorf("Affiliate %s must be an amount between 0 and 1000", field)
		}
	}
	return nil
}

// CodeReserved reports whether a user may not choose code for themselves:
// it is a ReservedCodeWords entry, or a simple sequence such as 888, 6688,
// 1234 or abc. Case, hyphens and underscores are ignored, so Core-Code and
// 8_8_8 are caught too; a code that only contains a word, such as
// my-corecode, is not.
func (s *AffiliateSetting) CodeReserved(code string) bool {
	normalize := strings.NewReplacer("-", "", "_", "")
	code = normalize.Replace(strings.ToLower(code))
	for word := range strings.FieldsFuncSeq(strings.ToLower(s.ReservedCodeWords), func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == ' ' || r == '\t'
	}) {
		if word = normalize.Replace(word); code == word {
			return true
		}
	}
	if code == "" {
		return true
	}
	ascending, descending := true, true
	for i := 1; i < len(code); i++ {
		ascending = ascending && code[i] == code[i-1]+1
		descending = descending && code[i] == code[i-1]-1
	}
	if ascending || descending {
		return true
	}
	distinct, allDigits := map[byte]bool{}, true
	for i := range len(code) {
		distinct[code[i]] = true
		allDigits = allDigits && code[i] >= '0' && code[i] <= '9'
	}
	return len(distinct) == 1 || allDigits && len(distinct) <= 2
}

// GiftEmailDomainBlocked reports whether an address's domain is on
// GiftBlockedEmailDomains, matching the domain itself or any parent of it.
func (s *AffiliateSetting) GiftEmailDomainBlocked(email string) bool {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	domain := strings.ToLower(strings.TrimSpace(email[at+1:]))
	for blocked := range strings.FieldsFuncSeq(strings.ToLower(s.GiftBlockedEmailDomains), func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == ' ' || r == '\t'
	}) {
		blocked = strings.TrimPrefix(blocked, "@")
		if domain == blocked || strings.HasSuffix(domain, "."+blocked) {
			return true
		}
	}
	return false
}

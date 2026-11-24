package model

import (
	"errors"
	"net"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AffiliateSignupGift records what happened when an invitee signed up: a
// channel's gift plan or the invite bonus was given, or why it was withheld.
// One row per invitee keeps a user from receiving either twice, and the rows
// are what the per-address and per-inviter limits count.
type AffiliateSignupGift struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex"`
	InviterId int    `json:"inviter_id" gorm:"index"`
	PlanId    int    `json:"plan_id"` // 0 for the invite bonus
	// Quota is the invite bonus put in the invitee's wallet, 0 for a plan.
	Quota     int64  `json:"quota" gorm:"type:bigint;not null;default:0"`
	Ip        string `json:"ip" gorm:"type:varchar(64);index"`
	// Network is the address's IPv4 /24 or IPv6 /64, recorded for looking
	// into farms; the per-address limit counts Ip.
	Network   string `json:"network" gorm:"type:varchar(64);index"`
	Status    string `json:"status" gorm:"type:varchar(16);not null"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime;index"`
}

const (
	AffiliateSignupGiftGiven        = "gifted"
	AffiliateSignupGiftIpUsed       = "ip_used"
	AffiliateSignupGiftCapReached   = "cap_reached"
	AffiliateSignupGiftEmailBlocked = "email_blocked"
	AffiliateSignupGiftEmailSignup  = "email_signup"

	// affiliateSignupGiftWindow is how far back the per-inviter daily cap
	// looks.
	affiliateSignupGiftWindow = 24 * 60 * 60
	// affiliateGiftAddressWindow is how far back the per-address limit looks.
	affiliateGiftAddressWindow = 30 * 24 * 60 * 60
)

// GiveAffiliateSignupGift gives a user who just signed up with an invite
// code their inviter's sign-up gift: a promotion channel tier's gift plan,
// free, or, for an inviter on the bonus reward, InviteBonus in the wallet. It
// returns the plan and the subscription when a plan was given, and nils
// otherwise: the bonus was given, the inviter has nothing to give, the user
// was already handled, or a limit withheld the gift.
//
// Only a sign-up through an OAuth provider, such as Google or linux.do,
// receives a gift: an email address costs a farm far less than one of those
// accounts. The other limits are an address that already received
// GiftIpLimit gifts of either kind in the last 30 days, an inviter whose
// invitees already received GiftDailyCap gifts in the last 24 hours, and an
// address domain on GiftBlockedEmailDomains. A withheld gift is recorded with
// its reason and never given later. The inviter's affiliate row is locked
// first, so concurrent sign-ups through one inviter count the cap one at a
// time.
func GiveAffiliateSignupGift(userId int, inviterId int, ip string, viaOAuth bool) (*SubscriptionPlan, *UserSubscription, error) {
	setting := operation_setting.GetAffiliateSetting()
	if userId <= 0 || inviterId <= 0 || !setting.Enabled {
		return nil, nil, nil
	}
	if len(ip) > 64 {
		ip = ip[:64]
	}
	var plan *SubscriptionPlan
	var subscription *UserSubscription
	var bonus int
	var invitee User
	var inviter User
	err := DB.Transaction(func(tx *gorm.DB) error {
		var affiliate Affiliate
		if err := lockForUpdate(tx).Where("user_id = ?", inviterId).First(&affiliate).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var err error
		plan, err = affiliateGiftPlanWithTx(tx, inviterId)
		if err != nil {
			return err
		}
		if plan == nil {
			if affiliate.Tier != "" || affiliate.Reward == AffiliateRewardCommission || affiliate.Rate <= 0 {
				return nil
			}
			if bonus, err = AffiliateInviteBonusQuota(); err != nil || bonus <= 0 {
				return err
			}
		}
		if err := tx.Select("id", "username", "status").Where("id = ?", inviterId).First(&inviter).Error; err != nil {
			return err
		}
		if inviter.Status != common.UserStatusEnabled {
			plan, bonus = nil, 0
			return nil
		}
		if err := lockForUpdate(tx).Select("id", "username", "email", "inviter_id").Where("id = ?", userId).First(&invitee).Error; err != nil {
			return err
		}
		if invitee.InviterId != inviterId {
			plan, bonus = nil, 0
			return nil
		}

		status := AffiliateSignupGiftGiven
		switch {
		case !viaOAuth:
			status = AffiliateSignupGiftEmailSignup
		case setting.GiftEmailDomainBlocked(invitee.Email):
			status = AffiliateSignupGiftEmailBlocked
		}
		if status == AffiliateSignupGiftGiven && ip != "" && setting.GiftIpLimit > 0 {
			var sameAddress int64
			if err := tx.Model(&AffiliateSignupGift{}).Where("ip = ? AND status = ? AND created_at >= ?", ip, AffiliateSignupGiftGiven, common.GetTimestamp()-affiliateGiftAddressWindow).
				Count(&sameAddress).Error; err != nil {
				return err
			}
			if sameAddress >= int64(setting.GiftIpLimit) {
				status = AffiliateSignupGiftIpUsed
			}
		}
		if status == AffiliateSignupGiftGiven && setting.GiftDailyCap > 0 {
			var given int64
			if err := tx.Model(&AffiliateSignupGift{}).Where("inviter_id = ? AND status = ? AND created_at >= ?", inviterId, AffiliateSignupGiftGiven, common.GetTimestamp()-affiliateSignupGiftWindow).
				Count(&given).Error; err != nil {
				return err
			}
			if given >= int64(setting.GiftDailyCap) {
				status = AffiliateSignupGiftCapReached
			}
		}

		gift := AffiliateSignupGift{
			UserId:    userId,
			InviterId: inviterId,
			Ip:        ip,
			Network:   signupGiftNetwork(ip),
			Status:    status,
		}
		if plan != nil {
			gift.PlanId = plan.Id
		} else {
			gift.Quota = int64(bonus)
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&gift)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 || status != AffiliateSignupGiftGiven {
			if result.RowsAffected == 1 {
				common.SysLog(common.LogText("withheld the sign-up gift of user %d invited by %d: %s", userId, inviterId, status))
			}
			plan, bonus = nil, 0
			return nil
		}
		if plan == nil {
			return creditTopUpQuota(tx, userId, bonus, nil)
		}
		subscription, err = CreateUserSubscriptionFromPlanTx(tx, userId, plan, SubscriptionSourceAffiliateGift)
		return err
	})
	if err != nil {
		return nil, nil, err
	}
	if bonus > 0 {
		syncCreditUserQuotaCache(userId, bonus, common.LogText("invite bonus"))
		RecordLog(userId, LogTypeSystem, common.NewMessage("Invitation bonus {{quota}}", map[string]any{"quota": logger.FormatQuota(bonus)}))
		return nil, nil, nil
	}
	if plan == nil || subscription == nil {
		return nil, nil, nil
	}
	if subscription.PrevUserGroup != "" {
		refreshSubscriptionUserGroupCache(userId, common.LogText("affiliate sign-up gift"))
	}
	RecordLog(userId, LogTypeSystem, common.NewMessage("Your inviter gave you the plan {{plan}}", map[string]any{"plan": plan.Title}))
	RecordLog(inviterId, LogTypeSystem, common.NewMessage("You gave {{user}} the plan {{plan}}", map[string]any{"user": invitee.Username, "plan": plan.Title}))
	return plan, subscription, nil
}

// signupGiftNetwork is an address's IPv4 /24 or IPv6 /64. An address that
// does not parse is its own network.
func signupGiftNetwork(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	if v4 := parsed.To4(); v4 != nil {
		return (&net.IPNet{IP: v4.Mask(net.CIDRMask(24, 32)), Mask: net.CIDRMask(24, 32)}).String()
	}
	return (&net.IPNet{IP: parsed.Mask(net.CIDRMask(64, 128)), Mask: net.CIDRMask(64, 128)}).String()
}

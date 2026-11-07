package model

import (
	"errors"
	"net"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AffiliateSignupGift records what happened when a channel's invitee signed
// up: the gift plan was given, or why it was withheld. One row per invitee
// keeps a user from receiving it twice, and the rows are what the per-network
// and per-channel limits count.
type AffiliateSignupGift struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex"`
	InviterId int    `json:"inviter_id" gorm:"index"`
	PlanId    int    `json:"plan_id"`
	Ip        string `json:"ip" gorm:"type:varchar(64);index"`
	// Network is the address's signupGiftNetwork. Rows from before it existed
	// leave it empty and are matched by Ip.
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

	// affiliateSignupGiftWindow is how far back the per-address and
	// per-channel limits look.
	affiliateSignupGiftWindow = 24 * 60 * 60
)

// GiveAffiliateSignupGift gives a user who just signed up with a promotion
// channel's code the channel tier's gift plan, free. It returns the plan and
// the subscription, or nils when nothing was given: the inviter is not a
// channel or its tier has no plan, the user was already handled, or a limit
// withheld it.
//
// Only a sign-up through an OAuth provider, such as Google or linux.do,
// receives it: an email address costs a farm far less than one of those
// accounts. The other limits are a network, an IPv4 /24 or an IPv6 /64, that
// already received a gift in the last 24 hours, a channel whose invitees
// already received GiftDailyCap gifts in that time, and an address domain on
// GiftBlockedEmailDomains. A withheld gift is
// recorded with its reason and never given later. The inviter's affiliate row
// is locked first, so concurrent sign-ups through one channel count the cap
// one at a time.
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
		if err != nil || plan == nil {
			return err
		}
		if err := tx.Select("id", "username", "status").Where("id = ?", inviterId).First(&inviter).Error; err != nil {
			return err
		}
		if inviter.Status != common.UserStatusEnabled {
			plan = nil
			return nil
		}
		if err := lockForUpdate(tx).Select("id", "username", "email", "inviter_id").Where("id = ?", userId).First(&invitee).Error; err != nil {
			return err
		}
		if invitee.InviterId != inviterId {
			plan = nil
			return nil
		}

		status := AffiliateSignupGiftGiven
		since := common.GetTimestamp() - affiliateSignupGiftWindow
		network := signupGiftNetwork(ip)
		switch {
		case !viaOAuth:
			status = AffiliateSignupGiftEmailSignup
		case setting.GiftEmailDomainBlocked(invitee.Email):
			status = AffiliateSignupGiftEmailBlocked
		}
		if status == AffiliateSignupGiftGiven && ip != "" {
			var sameNetwork int64
			if err := tx.Model(&AffiliateSignupGift{}).Where("(network = ? OR ip = ?) AND status = ? AND created_at >= ?", network, ip, AffiliateSignupGiftGiven, since).
				Count(&sameNetwork).Error; err != nil {
				return err
			}
			if sameNetwork > 0 {
				status = AffiliateSignupGiftIpUsed
			}
		}
		if status == AffiliateSignupGiftGiven && setting.GiftDailyCap > 0 {
			var given int64
			if err := tx.Model(&AffiliateSignupGift{}).Where("inviter_id = ? AND status = ? AND created_at >= ?", inviterId, AffiliateSignupGiftGiven, since).
				Count(&given).Error; err != nil {
				return err
			}
			if given >= int64(setting.GiftDailyCap) {
				status = AffiliateSignupGiftCapReached
			}
		}

		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&AffiliateSignupGift{
			UserId:    userId,
			InviterId: inviterId,
			PlanId:    plan.Id,
			Ip:        ip,
			Network:   network,
			Status:    status,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 || status != AffiliateSignupGiftGiven {
			if result.RowsAffected == 1 {
				common.SysLog(common.LogText("withheld the sign-up gift of user %d invited by %d: %s", userId, inviterId, status))
			}
			plan = nil
			return nil
		}
		subscription, err = CreateUserSubscriptionFromPlanTx(tx, userId, plan, SubscriptionSourceAffiliateGift)
		return err
	})
	if err != nil {
		return nil, nil, err
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

// signupGiftNetwork is the network the per-address limit counts an address
// in: its IPv4 /24 or IPv6 /64. A farm rotates through the addresses of a few
// proxy subnets, so one gift per address let a subnet collect dozens. An
// address that does not parse is its own network.
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

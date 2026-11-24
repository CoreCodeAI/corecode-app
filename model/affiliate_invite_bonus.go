package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AffiliateInviteBonus records an inviter's invite bonus for one invitee:
// given once the invitee had paid at least the bonus, or withheld because the
// two share an address. One row per invitee pays it once, however many
// servers run the settlement. The invitee's own bonus, given at sign-up, is an
// AffiliateSignupGift.
type AffiliateInviteBonus struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex"` // the invitee
	InviterId int    `json:"inviter_id" gorm:"index"`
	Quota     int64  `json:"quota" gorm:"type:bigint;not null"`
	Status    string `json:"status" gorm:"type:varchar(16);not null"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime;index"`
}

const (
	AffiliateInviteBonusGiven       = "gifted"
	AffiliateInviteBonusSelfInvited = "self_invited"
)

// AffiliateInviteBonusQuota is InviteBonus in quota, 0 when the bonus is off.
func AffiliateInviteBonusQuota() (int, error) {
	bonus := operation_setting.GetAffiliateSetting().InviteBonus
	if bonus <= 0 {
		return 0, nil
	}
	return common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(bonus).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Floor())
}

// SumAffiliateInviteBonuses is the quota the invite bonus has given an
// inviter for their invitees' payments.
func SumAffiliateInviteBonuses(inviterId int) (int64, error) {
	var total int64
	err := DB.Model(&AffiliateInviteBonus{}).Where("inviter_id = ? AND status = ?", inviterId, AffiliateInviteBonusGiven).
		Select("COALESCE(SUM(quota), 0)").Scan(&total).Error
	return total, err
}

// AffiliateInviteBonusesDue returns, in user order after afterId, up to limit
// invitees whose inviter is on the bonus reward, who have a paid top-up and
// whose inviter has no invite bonus for them yet. PayAffiliateInviteBonus
// decides whether they paid enough.
func AffiliateInviteBonusesDue(afterId int, limit int) ([]int, error) {
	var ids []int
	err := DB.Table("users").
		Joins("JOIN affiliates ON affiliates.user_id = users.inviter_id").
		Where("users.id > ? AND users.inviter_id > 0 AND users.deleted_at IS NULL", afterId).
		Where("affiliates.reward <> ? AND affiliates.tier = ? AND affiliates.rate > 0", AffiliateRewardCommission, "").
		Where("users.id NOT IN (?)", DB.Model(&AffiliateInviteBonus{}).Select("user_id")).
		Where("users.id IN (?)", paidTopUps(DB).Select("user_id")).
		Order("users.id").Limit(limit).Pluck("users.id", &ids).Error
	return ids, err
}

// PayAffiliateInviteBonus gives an invitee's inviter, when they are on the
// bonus reward, InviteBonus in the wallet once the invitee has paid at least
// that much since their referral started, and reports whether it was given.
// Payments count as for commission: through a gateway, not offline. An
// inviter who shares an address with the invitee (SharesAddress) gets
// nothing, unless a root user exempted them (AffiliateAddressExemption), and
// the refusal is recorded so it is never paid later.
func PayAffiliateInviteBonus(userId int) (bool, error) {
	setting := operation_setting.GetAffiliateSetting()
	if !setting.Enabled {
		return false, nil
	}
	bonus, err := AffiliateInviteBonusQuota()
	if err != nil || bonus <= 0 {
		return false, err
	}
	bonusCents := decimal.NewFromFloat(setting.InviteBonus).Mul(affiliatePrice()).Mul(decimal.NewFromInt(100)).Ceil().IntPart()
	var invitee User
	if err := DB.Select("id", "username", "inviter_id").Where("id = ?", userId).First(&invitee).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	inviterId := invitee.InviterId
	if inviterId <= 0 {
		return false, nil
	}
	// Addresses are read before the transaction: the request log may be the
	// same database, and SQLite serves one connection.
	exempt, err := AffiliateAddressExempt(inviterId)
	if err != nil {
		return false, err
	}
	selfInvited := false
	if !exempt {
		if selfInvited, err = SharesAddress(inviterId, userId, common.GetTimestamp()); err != nil {
			return false, err
		}
	}
	given := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		var inviter User
		if err := tx.Select("id", "status").Where("id = ?", inviterId).First(&inviter).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var affiliate Affiliate
		if err := tx.Where("user_id = ?", inviterId).First(&affiliate).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if inviter.Status != common.UserStatusEnabled || affiliate.Rate <= 0 || affiliate.Tier != "" || affiliate.Reward == AffiliateRewardCommission {
			return nil
		}
		var referral AffiliateReferral
		if err := tx.Select("paid_cents_at_start").Where("user_id = ?", userId).First(&referral).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		paidCents, err := affiliatePaidCents(tx, userId)
		if err != nil {
			return err
		}
		if paidCents-referral.PaidCentsAtStart < bonusCents {
			return nil
		}
		status := AffiliateInviteBonusGiven
		if selfInvited {
			status = AffiliateInviteBonusSelfInvited
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&AffiliateInviteBonus{
			UserId:    userId,
			InviterId: inviterId,
			Quota:     int64(bonus),
			Status:    status,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		if selfInvited {
			common.SysLog(common.LogText("affiliate: no invite bonus to user %d on user %d, who shares an address with them", inviterId, userId))
			return nil
		}
		if err := creditTopUpQuota(tx, inviterId, bonus, nil); err != nil {
			return err
		}
		given = true
		return nil
	})
	if err != nil || !given {
		return false, err
	}
	syncCreditUserQuotaCache(inviterId, bonus, common.LogText("invite bonus"))
	RecordLog(inviterId, LogTypeSystem, common.NewMessage("Invitation bonus for the first payment of {{user}}: {{quota}}",
		map[string]any{"user": invitee.Username, "quota": logger.FormatQuota(bonus)}))
	return true, nil
}

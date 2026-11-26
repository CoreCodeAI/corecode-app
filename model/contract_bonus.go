package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserContractBonus is the top-up bonus a customer was promised outside the
// site's tiers, such as an enterprise's 10% on every transfer. Rate is a
// fraction above 0 and at most 1. A customer earns this rate or the site's
// tier for the amount, whichever is higher, on every top-up: online, on chain
// and offline. A customer without a row has no contract rate.
type UserContractBonus struct {
	UserId      int     `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Rate        float64 `json:"rate" gorm:"not null"`
	UpdatedBy   int     `json:"updated_by" gorm:"not null;default:0"`
	UpdatedTime int64   `json:"updated_time" gorm:"bigint;not null;default:0"`
}

func (UserContractBonus) TableName() string {
	return "user_contract_bonuses"
}

// GetContractBonusRate returns the user's contract bonus rate, or 0 when the
// user has none.
func GetContractBonusRate(userId int) (float64, error) {
	var row UserContractBonus
	err := DB.Where("user_id = ?", userId).Limit(1).Find(&row).Error
	if err != nil {
		return 0, err
	}
	return row.Rate, nil
}

// TopUpBonusTiersFor returns the bonus tiers the user earns: the site's
// tiers, raised to the user's contract rate where it is higher.
func TopUpBonusTiersFor(userId int) (map[int]float64, error) {
	rate, err := GetContractBonusRate(userId)
	if err != nil {
		return nil, err
	}
	return operation_setting.BonusTiersWithContract(rate), nil
}

// SetContractBonusRate sets the user's contract bonus rate; 0 removes it.
// It returns the rate the user had before.
func SetContractBonusRate(userId int, rate float64, adminId int) (previous float64, err error) {
	if err := operation_setting.ValidateContractBonusRate(rate); err != nil {
		return 0, common.NewMessage(err.Error())
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Select("id").Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		var row UserContractBonus
		if err := lockForUpdate(tx).Where("user_id = ?", userId).Limit(1).Find(&row).Error; err != nil {
			return err
		}
		previous = row.Rate
		if rate == 0 {
			return tx.Where("user_id = ?", userId).Delete(&UserContractBonus{}).Error
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"rate", "updated_by", "updated_time"}),
		}).Create(&UserContractBonus{UserId: userId, Rate: rate, UpdatedBy: adminId, UpdatedTime: common.GetTimestamp()}).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, common.NewMessage("User not found")
	}
	return previous, err
}

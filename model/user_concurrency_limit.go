package model

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
)

// UserConcurrencyLimitsOptionKey stores the per-user concurrency overrides
// (operation_setting.TokenSetting.UserConcurrencyLimits).
const UserConcurrencyLimitsOptionKey = "token_setting.user_concurrency_limits"

// SetUserConcurrencyLimit sets a user's concurrency override, or removes it
// when limit is nil so the group and tier limits apply again. It edits the
// stored option under a row lock rather than the in-memory copy, which may lag
// a change another server made since its last sync. It reports whether the
// stored value changed.
func SetUserConcurrencyLimit(userID int, limit *int) (bool, error) {
	key := UserConcurrencyLimitsOptionKey
	id := strconv.Itoa(userID)
	value := ""
	changed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		option := Option{Key: key}
		if err := tx.FirstOrCreate(&option, Option{Key: key}).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where(&Option{Key: key}).First(&option).Error; err != nil {
			return err
		}
		limits := map[string]int{}
		if strings.TrimSpace(option.Value) != "" {
			if err := common.UnmarshalJsonStr(option.Value, &limits); err != nil {
				return err
			}
		}
		if limits == nil {
			limits = map[string]int{}
		}
		current, had := limits[id]
		if limit == nil {
			if !had {
				return nil
			}
			delete(limits, id)
		} else {
			if had && current == *limit {
				return nil
			}
			limits[id] = *limit
		}
		encoded, err := common.Marshal(limits)
		if err != nil {
			return err
		}
		value = string(encoded)
		if err := operation_setting.ValidateUserConcurrencyLimits(value); err != nil {
			return err
		}
		option.Value = value
		changed = true
		return tx.Save(&option).Error
	})
	if err != nil || !changed {
		return false, err
	}
	BumpSyncTopic(SyncTopicOptions)
	return true, updateOptionMap(key, value)
}

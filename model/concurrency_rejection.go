package model

import (
	"cmp"
	"slices"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// UserConcurrencyRejection counts the 429s the per-user concurrency limit
// returned to one user in one hour. Those requests never reach the request
// logs, so this table is the only record of them. Each server adds its own
// counts, so both colors of a release land in the same row.
type UserConcurrencyRejection struct {
	HourStart  int64 `json:"hour_start" gorm:"primaryKey;autoIncrement:false"`
	UserId     int   `json:"user_id" gorm:"primaryKey;autoIncrement:false;index"`
	Rejections int64 `json:"rejections" gorm:"not null;default:0"`
}

// ConcurrencyRejectionKey names one row of UserConcurrencyRejection.
type ConcurrencyRejectionKey struct {
	HourStart int64
	UserId    int
}

// AddUserConcurrencyRejections adds each count to its row, creating the row
// when it is new. It returns the counts it could not write, for a later try.
func AddUserConcurrencyRejections(counts map[ConcurrencyRejectionKey]int64) map[ConcurrencyRejectionKey]int64 {
	failed := make(map[ConcurrencyRejectionKey]int64)
	for key, count := range counts {
		if err := addUserConcurrencyRejections(key, count); err != nil {
			common.SysError(common.LogText("failed to record concurrency rejections: %s", err.Error()))
			failed[key] = count
		}
	}
	return failed
}

func addUserConcurrencyRejections(key ConcurrencyRejectionKey, count int64) error {
	increment := func() (int64, error) {
		result := DB.Model(&UserConcurrencyRejection{}).
			Where("hour_start = ? AND user_id = ?", key.HourStart, key.UserId).
			Update("rejections", gorm.Expr("rejections + ?", count))
		return result.RowsAffected, result.Error
	}
	updated, err := increment()
	if err != nil || updated > 0 {
		return err
	}
	if err := DB.Create(&UserConcurrencyRejection{HourStart: key.HourStart, UserId: key.UserId, Rejections: count}).Error; err == nil {
		return nil
	}
	// The other color created the row between the update and the insert.
	updated, err = increment()
	if err == nil && updated == 0 {
		err = gorm.ErrRecordNotFound
	}
	return err
}

// UserCount is one user's count in a dashboard list.
type UserCount struct {
	UserRef
	Count int64 `json:"count"`
}

// ReadUserConcurrencyRejections returns the limit's 429s in [start, end) by
// hour and the users turned away most, staff (administrators and root)
// excluded.
func ReadUserConcurrencyRejections(start, end int64) ([]CountPoint, []UserCount, error) {
	var rows []UserConcurrencyRejection
	if err := DB.Where("hour_start >= ? AND hour_start < ?", start-start%3600, end).
		Where("user_id NOT IN (?)", DB.Model(&User{}).Unscoped().Select("id").Where("role >= ?", common.RoleAdminUser)).
		Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	hours := make(map[int64]int64)
	users := make(map[int]int64)
	for _, row := range rows {
		hours[row.HourStart] += row.Rejections
		users[row.UserId] += row.Rejections
	}
	points := make([]CountPoint, 0, len(hours))
	for hour, count := range hours {
		points = append(points, CountPoint{At: hour, Count: count})
	}
	slices.SortFunc(points, func(a, b CountPoint) int { return cmp.Compare(a.At, b.At) })
	ids := make([]int, 0, len(users))
	top := make([]UserCount, 0, len(users))
	for id, count := range users {
		ids = append(ids, id)
		top = append(top, UserCount{UserRef: UserRef{UserID: id}, Count: count})
	}
	slices.SortFunc(top, func(a, b UserCount) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), cmp.Compare(a.UserID, b.UserID))
	})
	top = top[:min(len(top), insightsTopN)]
	names, err := usernamesByID(ids)
	if err != nil {
		return nil, nil, err
	}
	for i := range top {
		top[i].Username = names[top[i].UserID]
	}
	return points, top, nil
}

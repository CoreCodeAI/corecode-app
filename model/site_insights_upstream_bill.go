package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CoreCode fork: the upstream bill of a Sub2API site. Sub2API answers no
// per-request log to a key, so its bill is read as day totals: what one key
// was charged for each model on each day. The reader lives in
// service/upstream_cost_task.go; the view adds these rows beside the
// request-level UpstreamCost rows of new-api sites.

// UpstreamBillDayOffset is the zone a Sub2API site counts its days in: UTC+8.
// Its usage endpoint takes a date in the site's own zone, which is UTC+8 by
// default; a site set to another zone shifts every day by that difference.
const UpstreamBillDayOffset = 8 * 3600

// UpstreamBillDay is what one channel's upstream key was charged for one model
// on one supplier day. DayStart is the Unix second the day begins, in the
// UTC+8 day. ModelName is the name the upstream billed (the name our channel
// sent it), or empty for a day with no billed model, which marks the day as
// read. CostUSD is actual_cost, the amount deducted from the key's balance;
// StandardCostUSD is cost, the same usage at the site's list price before the
// account and user multipliers. ReadAt is the Unix second the row was read.
type UpstreamBillDay struct {
	ChannelId       int     `gorm:"primaryKey;autoIncrement:false"`
	DayStart        int64   `gorm:"primaryKey;autoIncrement:false;index"`
	ModelName       string  `gorm:"primaryKey;type:varchar(191)"`
	Requests        int64   `gorm:"not null;default:0"`
	CostUSD         float64 `gorm:"not null;default:0"`
	StandardCostUSD float64 `gorm:"not null;default:0"`
	ReadAt          int64   `gorm:"not null;default:0"`
}

// SaveUpstreamBillDays replaces the channel's rows from the day from on with
// rows. A row the upstream no longer reports for those days is deleted, and
// a row it still reports overwrites the stored one, so a day the upstream
// lowered is corrected. Two servers reading at once write the same rows.
func SaveUpstreamBillDays(channelID int, from int64, rows []UpstreamBillDay) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("channel_id = ? AND day_start >= ?", channelID, from).Delete(&UpstreamBillDay{}).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "channel_id"}, {Name: "day_start"}, {Name: "model_name"}},
			DoUpdates: clause.AssignmentColumns([]string{"requests", "cost_usd", "standard_cost_usd", "read_at"}),
		}).CreateInBatches(rows, 200).Error
	})
}

// UpstreamBillCovers reports whether the channel's stored bill reaches back
// to the day from, that is whether a row for that day or an earlier one is
// stored. A channel whose bill does not is backfilled.
func UpstreamBillCovers(channelID int, from int64) (bool, error) {
	var count int64
	err := DB.Model(&UpstreamBillDay{}).Where("channel_id = ? AND day_start <= ?", channelID, from).Count(&count).Error
	return count > 0, err
}

// ReadUpstreamBillDays returns the rows of the days that begin in [from, to).
func ReadUpstreamBillDays(from, to int64) ([]UpstreamBillDay, error) {
	var rows []UpstreamBillDay
	err := DB.Where("day_start >= ? AND day_start < ?", from, to).Find(&rows).Error
	return rows, err
}

// UpstreamBillReads returns, per channel with a stored bill, when its newest
// row was read.
func UpstreamBillReads() (map[int]int64, error) {
	var latest []struct {
		ChannelId int
		ReadAt    int64
	}
	if err := DB.Model(&UpstreamBillDay{}).Select("channel_id, MAX(read_at) AS read_at").Group("channel_id").Scan(&latest).Error; err != nil {
		return nil, err
	}
	reads := make(map[int]int64, len(latest))
	for _, row := range latest {
		reads[row.ChannelId] = row.ReadAt
	}
	return reads, nil
}

// PruneUpstreamBillDays deletes the rows of days older than the retention.
func PruneUpstreamBillDays(now int64) error {
	return DB.Where("day_start < ?", now-UpstreamCostRetentionDays*86400).Delete(&UpstreamBillDay{}).Error
}

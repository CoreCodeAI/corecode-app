package model

// HourlyQuotaWithPrefix sums quota_data's quota per hour for the models
// whose names start with prefix, over hours starting in [from, to), unix
// seconds. quota_data stores each hour at its start, so the keys are hour
// starts; an hour without use is absent.
func HourlyQuotaWithPrefix(prefix string, from, to int64) (map[int64]int64, error) {
	var rows []struct {
		CreatedAt int64 `gorm:"column:created_at"`
		Quota     int64 `gorm:"column:quota"`
	}
	err := DB.Table("quota_data").
		Select("created_at, SUM(quota) AS quota").
		Where("created_at >= ? AND created_at < ? AND model_name LIKE ?", from, to, prefix+"%").
		Group("created_at").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	hours := make(map[int64]int64, len(rows))
	for _, row := range rows {
		hours[row.CreatedAt] += row.Quota
	}
	return hours, nil
}

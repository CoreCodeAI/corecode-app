package model

// HourlyVendorQuota sums quota_data's quota per hour for the models sold
// under vendor (ModelVendor), over hours starting in [from, to), unix
// seconds. Each of the vendor's prefixes is read with LIKE; a model an
// earlier prefix gives another vendor, such as gpt-image- under gpt-, is
// left out. quota_data stores each hour at its start, so the keys are hour
// starts; an hour without use is absent.
func HourlyVendorQuota(vendor string, from, to int64) (map[int64]int64, error) {
	hours := make(map[int64]int64)
	for _, prefix := range VendorPrefixes(vendor) {
		var rows []struct {
			CreatedAt int64  `gorm:"column:created_at"`
			ModelName string `gorm:"column:model_name"`
			Quota     int64  `gorm:"column:quota"`
		}
		err := DB.Table("quota_data").
			Select("created_at, model_name, SUM(quota) AS quota").
			Where("created_at >= ? AND created_at < ? AND model_name LIKE ?", from, to, prefix+"%").
			Group("created_at, model_name").
			Find(&rows).Error
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			if ModelVendor(row.ModelName) == vendor {
				hours[row.CreatedAt] += row.Quota
			}
		}
	}
	return hours, nil
}

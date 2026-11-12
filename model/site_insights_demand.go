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

// dayProfileDays is how many whole days the day profile averages over.
const dayProfileDays = 14

// DayProfile is how a typical day's requests spread over its hours: Hours[h]
// is the share of the requests that arrived in UTC hour h, over the last
// Days whole UTC days. The dashboard uses it to tell how much of a day a part
// of it usually holds, and so what a day still running will come to. Hours is
// empty when those days saw no requests.
type DayProfile struct {
	Hours []float64 `json:"hours"`
	Days  int       `json:"days"`
}

// GetDayProfile reads the day profile from the hourly quota_data rows of the
// dayProfileDays whole UTC days before now's.
func GetDayProfile(now int64) (*DayProfile, error) {
	end := now - ((now%86400)+86400)%86400
	start := end - dayProfileDays*86400
	var rows []struct {
		CreatedAt int64 `gorm:"column:created_at"`
		Requests  int64 `gorm:"column:requests"`
	}
	err := DB.Table("quota_data").
		Select("created_at, SUM(count) AS requests").
		Where("created_at >= ? AND created_at < ?", start, end).
		Group("created_at").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	var byHour [24]int64
	var total int64
	for _, row := range rows {
		byHour[((row.CreatedAt%86400)+86400)%86400/3600] += row.Requests
		total += row.Requests
	}
	profile := &DayProfile{Hours: []float64{}, Days: dayProfileDays}
	if total <= 0 {
		return profile, nil
	}
	for _, requests := range byHour {
		profile.Hours = append(profile.Hours, roundTo(float64(requests)/float64(total), 6))
	}
	return profile, nil
}

package model

import (
	"gorm.io/gorm/clause"
)

// CoreCode addition: the day the site insights digest last went out. It is
// one option row, so two servers and a restart agree on it. The row is
// written with conditional updates only: a runner claims a report day by
// changing the stored day to it, and only the runner whose update changed a
// row owns that day's send.
const siteInsightsDigestSentDayKey = "site_insights_digest.sent_day"

// ClaimSiteInsightsDigestDay claims the report day (YYYY-MM-DD, Beijing) for
// one send. It returns the day stored before the claim, which the caller
// hands back to ReleaseSiteInsightsDigestDay if the send fails, and whether
// this call owns the day.
func ClaimSiteInsightsDigestDay(day string) (previous string, claimed bool, err error) {
	if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: siteInsightsDigestSentDayKey}).Error; err != nil {
		return "", false, err
	}
	var option Option
	if err := DB.Where(&Option{Key: siteInsightsDigestSentDayKey}).First(&option).Error; err != nil {
		return "", false, err
	}
	if option.Value == day {
		return option.Value, false, nil
	}
	result := DB.Model(&Option{}).Where(&Option{Key: siteInsightsDigestSentDayKey}).
		Where("value <> ?", day).Update("value", day)
	if result.Error != nil {
		return "", false, result.Error
	}
	return option.Value, result.RowsAffected == 1, nil
}

// ReleaseSiteInsightsDigestDay gives a claimed day back when its send failed,
// so the next run sends it. It changes the row only while it still holds the
// claimed day.
func ReleaseSiteInsightsDigestDay(previous string, day string) error {
	return DB.Model(&Option{}).Where(&Option{Key: siteInsightsDigestSentDayKey}).
		Where("value = ?", day).Update("value", previous).Error
}

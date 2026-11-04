package model

import "gorm.io/gorm"

// countUpTo counts the rows query matches, stopping at limit, so a page total
// never makes the database visit more than limit rows.
//
// GORM's Count keeps a LIMIT clause, which then applies to the single count
// row: query.Limit(n).Count(&total) still counts every matching row. The limit
// has to sit inside a subquery. query itself is left unchanged, so the caller
// can page it afterwards.
func countUpTo(query *gorm.DB, limit int) (int64, error) {
	var total int64
	capped := query.Session(&gorm.Session{}).Select("1").Limit(limit)
	err := query.Session(&gorm.Session{NewDB: true}).Table("(?) AS capped_rows", capped).Count(&total).Error
	return total, err
}

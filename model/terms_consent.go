package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm/clause"
)

// TermsVersionMaxLength bounds the terms version a consent row stores.
const TermsVersionMaxLength = 32

// termsConsentUserAgentMaxLength bounds the stored user agent, in characters.
const termsConsentUserAgentMaxLength = 255

// UserTermsConsent records that a customer accepted one version of the terms,
// with where the acceptance came from. The first acceptance of a version is
// the evidence; accepting the same version again keeps that row.
type UserTermsConsent struct {
	Id         int    `json:"id"`
	UserId     int    `json:"user_id" gorm:"not null;uniqueIndex:idx_user_terms_version,priority:1"`
	Version    string `json:"version" gorm:"type:varchar(32);not null;uniqueIndex:idx_user_terms_version,priority:2"`
	AcceptedAt int64  `json:"accepted_at" gorm:"bigint;not null"`
	Ip         string `json:"ip" gorm:"type:varchar(64)"`
	UserAgent  string `json:"user_agent" gorm:"type:varchar(255)"`
}

// RecordTermsConsent stores a customer's acceptance of version. A repeated
// acceptance of the same version is a no-op.
func RecordTermsConsent(userId int, version string, ip string, userAgent string) error {
	if userId <= 0 || version == "" || len(version) > TermsVersionMaxLength {
		return errors.New("invalid terms consent")
	}
	if runes := []rune(userAgent); len(runes) > termsConsentUserAgentMaxLength {
		userAgent = string(runes[:termsConsentUserAgentMaxLength])
	}
	consent := UserTermsConsent{
		UserId:     userId,
		Version:    version,
		AcceptedAt: common.GetTimestamp(),
		Ip:         ip,
		UserAgent:  userAgent,
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&consent).Error
}

// HasAcceptedTerms reports whether the customer accepted version.
func HasAcceptedTerms(userId int, version string) (bool, error) {
	if userId <= 0 || version == "" {
		return false, nil
	}
	var ids []int
	err := DB.Model(&UserTermsConsent{}).
		Where("user_id = ? AND version = ?", userId, version).
		Limit(1).
		Pluck("id", &ids).Error
	if err != nil {
		return false, err
	}
	return len(ids) > 0, nil
}

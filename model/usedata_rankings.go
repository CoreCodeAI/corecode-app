package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type RankingQuotaTotal struct {
	ModelName   string `json:"model_name"`
	TotalTokens int64  `json:"total_tokens"`
}

type RankingQuotaBucket struct {
	ModelName string `json:"model_name"`
	Bucket    int64  `json:"bucket"`
	Tokens    int64  `json:"tokens"`
}

// rankingTokensSum counts every token: token_used leaves out the cache reads
// and writes, which Claude Code traffic is mostly made of.
const rankingTokensSum = "sum(token_used + cache_read_tokens + cache_creation_tokens)"

func GetRankingQuotaTotals(startTime int64, endTime int64) ([]RankingQuotaTotal, error) {
	var rows []RankingQuotaTotal
	query := DB.Table("quota_data").
		Select("model_name, " + rankingTokensSum + " as total_tokens").
		Where("model_name <> ''").
		Group("model_name").
		Having(rankingTokensSum + " > 0").
		Order("total_tokens DESC")
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

type ModelUsageTotal struct {
	ModelName string `json:"model_name"`
	Requests  int64  `json:"requests"`
	Tokens    int64  `json:"tokens"`
}

// GetModelUsageTotals sums requests and tokens per model, including models
// that used no tokens.
func GetModelUsageTotals(startTime int64, endTime int64) ([]ModelUsageTotal, error) {
	var rows []ModelUsageTotal
	query := DB.Table("quota_data").
		Select("model_name, sum(count) as requests, sum(token_used) as tokens").
		Where("model_name <> ''").
		Group("model_name")
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

// GetRankingQuotaBuckets groups usage into buckets of bucketSize seconds whose
// boundaries fall on multiples of bucketSize in the zone offsetSeconds east of
// UTC, so a day bucket starts at the viewer's midnight. Bucket keeps the UTC
// Unix time of each boundary.
func GetRankingQuotaBuckets(startTime int64, endTime int64, bucketSize int64, offsetSeconds int64) ([]RankingQuotaBucket, error) {
	if bucketSize <= 0 {
		bucketSize = 3600
	}
	bucketExpr := rankingBucketExpr(bucketSize, offsetSeconds)
	var rows []RankingQuotaBucket
	query := DB.Table("quota_data").
		Select(fmt.Sprintf("model_name, %s as bucket, %s as tokens", bucketExpr, rankingTokensSum)).
		Where("model_name <> ''").
		Group(fmt.Sprintf("model_name, %s", bucketExpr)).
		Having(rankingTokensSum + " > 0").
		Order("bucket ASC")
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

func rankingBucketExpr(bucketSize int64, offsetSeconds int64) string {
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return fmt.Sprintf("FLOOR((created_at + %d) / %d) * %d - %d", offsetSeconds, bucketSize, bucketSize, offsetSeconds)
	}
	return fmt.Sprintf("((created_at + %d) / %d) * %d - %d", offsetSeconds, bucketSize, bucketSize, offsetSeconds)
}

func applyRankingQuotaTimeRange(query *gorm.DB, startTime int64, endTime int64) *gorm.DB {
	if startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	return query
}

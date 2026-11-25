package model

import (
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const (
	BatchUpdateTypeUserQuota = iota
	BatchUpdateTypeTokenQuota
	BatchUpdateTypeUsedQuota
	BatchUpdateTypeChannelUsedQuota
	BatchUpdateTypeRequestCount
	BatchUpdateTypeCount // if you add a new type, you need to add a new map and a new lock
)

var batchUpdateStores []map[int]int
var batchUpdateLocks []sync.Mutex

// batchUpdateWriting serializes batch writes, so a flush at shutdown waits for
// the writes of a periodic batch already in progress.
var batchUpdateWriting sync.Mutex

func init() {
	for range BatchUpdateTypeCount {
		batchUpdateStores = append(batchUpdateStores, make(map[int]int))
		batchUpdateLocks = append(batchUpdateLocks, sync.Mutex{})
	}
}

func InitBatchUpdater() {
	gopool.Go(func() {
		for {
			time.Sleep(time.Duration(common.BatchUpdateInterval) * time.Second)
			batchUpdate()
		}
	})
}

// batchShutdownRetryDelays spaces the shutdown flush's attempts at writes the
// database did not take, such as during a database restart. Their sum stays
// well inside docker stop's 10-second grace period, which also covers the HTTP
// shutdown and the other flushes.
var batchShutdownRetryDelays = []time.Duration{250 * time.Millisecond, 500 * time.Millisecond, time.Second, 2 * time.Second}

// FlushBatchUpdates writes the quota changes still held in memory. Shutdown
// calls it once the server has stopped admitting requests: the periodic writer
// leaves up to one interval of charges and refunds in memory, and they are lost
// with the process. Writes the database did not take are tried again for a few
// seconds; what still remains is logged row by row, so it can be reconciled.
func FlushBatchUpdates() {
	for _, delay := range batchShutdownRetryDelays {
		if batchUpdate() == 0 {
			return
		}
		time.Sleep(delay)
	}
	if batchUpdate() == 0 {
		return
	}
	stores := takeBatchUpdateStores()
	for _, row := range batchRows(stores) {
		common.SysError(common.LogText("batch update lost at shutdown: %s", row.describe))
	}
}

func addNewRecord(type_ int, id int, value int) {
	batchUpdateLocks[type_].Lock()
	defer batchUpdateLocks[type_].Unlock()
	old, ok := batchUpdateStores[type_][id]
	if !ok {
		batchUpdateStores[type_][id] = value
		return
	}

	sum := old + value
	if (value > 0 && sum < old) || (value < 0 && sum > old) {
		common.SysError(common.LogText("batch update overflow: type=%d id=%d old=%d value=%d", type_, id, old, value))
		if value > 0 {
			sum = math.MaxInt
		} else {
			sum = math.MinInt
		}
	}
	batchUpdateStores[type_][id] = sum
}

// takeBatchUpdateStores swaps every pending store for an empty one, or
// returns nil when nothing is pending.
func takeBatchUpdateStores() []map[int]int {
	hasData := false
	for i := range BatchUpdateTypeCount {
		batchUpdateLocks[i].Lock()
		hasData = len(batchUpdateStores[i]) > 0
		batchUpdateLocks[i].Unlock()
		if hasData {
			break
		}
	}
	if !hasData {
		return nil
	}
	stores := make([]map[int]int, BatchUpdateTypeCount)
	for i := range BatchUpdateTypeCount {
		batchUpdateLocks[i].Lock()
		stores[i] = batchUpdateStores[i]
		batchUpdateStores[i] = make(map[int]int)
		batchUpdateLocks[i].Unlock()
	}
	return stores
}

// batchRows turns taken stores into row writes: users first, then tokens, both
// money, then the channels' usage statistics. A user's quota, used quota and
// request count go in one statement.
func batchRows(stores []map[int]int) []batchRow {
	userQuota := stores[BatchUpdateTypeUserQuota]
	usedQuota := stores[BatchUpdateTypeUsedQuota]
	requestCount := stores[BatchUpdateTypeRequestCount]
	userIDs := make(map[int]struct{}, len(userQuota)+len(usedQuota)+len(requestCount))
	for _, store := range []map[int]int{userQuota, usedQuota, requestCount} {
		for id := range store {
			userIDs[id] = struct{}{}
		}
	}

	rows := make([]batchRow, 0, len(userIDs)+len(stores[BatchUpdateTypeTokenQuota])+len(stores[BatchUpdateTypeChannelUsedQuota]))
	for id := range userIDs {
		quota, used, count := userQuota[id], usedQuota[id], requestCount[id]
		if quota == 0 && used == 0 && count == 0 {
			continue
		}
		rows = append(rows, batchRow{
			describe: fmt.Sprintf("user_id=%d quota_delta=%d used_quota_delta=%d request_count_delta=%d", id, quota, used, count),
			write: func(tx *gorm.DB) error {
				return tx.Model(&User{}).Where("id = ?", id).Updates(map[string]any{
					"quota":         gorm.Expr("quota + ?", quota),
					"used_quota":    gorm.Expr("used_quota + ?", used),
					"request_count": gorm.Expr("request_count + ?", count),
				}).Error
			},
			requeue: func() {
				for kind, value := range map[int]int{BatchUpdateTypeUserQuota: quota, BatchUpdateTypeUsedQuota: used, BatchUpdateTypeRequestCount: count} {
					if value != 0 {
						addNewRecord(kind, id, value)
					}
				}
			},
		})
	}
	for id, quota := range stores[BatchUpdateTypeTokenQuota] {
		rows = append(rows, batchRow{
			describe: fmt.Sprintf("token_id=%d remain_quota_delta=%d", id, quota),
			write: func(tx *gorm.DB) error {
				return tx.Model(&Token{}).Where("id = ?", id).Updates(tokenQuotaUpdates(-quota, time.Now())).Error
			},
			requeue: func() { addNewRecord(BatchUpdateTypeTokenQuota, id, quota) },
		})
	}
	for id, quota := range stores[BatchUpdateTypeChannelUsedQuota] {
		rows = append(rows, batchRow{
			describe: fmt.Sprintf("channel_id=%d used_quota_delta=%d", id, quota),
			write: func(tx *gorm.DB) error {
				return tx.Model(&Channel{}).Where("id = ?", id).Update("used_quota", gorm.Expr("used_quota + ?", quota)).Error
			},
			requeue: func() { addNewRecord(BatchUpdateTypeChannelUsedQuota, id, quota) },
		})
	}
	return rows
}

// batchUpdate writes the pending deltas and returns how many rows it queued
// again because the database did not take them. A failed write never loses a
// delta that provably did not commit: its row goes back into the queue, merged
// with any change made since, and the next run tries it again.
func batchUpdate() int {
	batchUpdateWriting.Lock()
	defer batchUpdateWriting.Unlock()
	stores := takeBatchUpdateStores()
	if stores == nil {
		return 0
	}

	common.SysLog(common.LogText("batch update started"))
	var flush batchFlush
	for _, row := range batchRows(stores) {
		flush.apply(row)
	}
	if flush.requeued == 0 && flush.dropped == 0 {
		common.SysLog(common.LogText("batch update finished"))
		return 0
	}
	common.SysError(common.LogText("batch update incomplete: applied=%d requeued=%d dropped=%d: %v", flush.applied, flush.requeued, flush.dropped, flush.firstErr))
	return flush.requeued
}

func RecordExist(err error) (bool, error) {
	if err == nil {
		return true, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return false, err
}

func shouldUpdateRedis(fromDB bool, err error) bool {
	return common.RedisEnabled && fromDB && err == nil
}

package setting

import (
	"fmt"
	"math"
	"strconv"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// maxRateLimitDurationSeconds is the largest window the count cap is computed
// against (24h). Token-bucket capacity is count*duration; this keeps that
// product inside int64 when the window is at most a day.
const maxRateLimitDurationSeconds = 24 * 60 * 60

// maxModelRequestRateLimitCount is math.MaxInt64 / maxRateLimitDurationSeconds.
// It is the largest count that cannot overflow int64(count)*duration for a
// window of at most 24 hours.
const maxModelRequestRateLimitCount int64 = math.MaxInt64 / maxRateLimitDurationSeconds

var ModelRequestRateLimitEnabled = false
var ModelRequestRateLimitDurationMinutes = 1
var ModelRequestRateLimitCount = 0
var ModelRequestRateLimitSuccessCount = 1000
var ModelRequestRateLimitGroup = map[string][2]int{}

// ModelRequestRateLimitUser overrides the global and group limits for single
// users, keyed by user id, as [total, success] like ModelRequestRateLimitGroup.
// An overridden user's requests share one count across all groups, so an
// account that many people share can be given room without a group of its own.
var ModelRequestRateLimitUser = map[string][2]int{}
var ModelRequestRateLimitMutex sync.RWMutex

func ModelRequestRateLimitGroup2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitGroup)
	if err != nil {
		common.SysLog(common.LogText("error marshalling model ratio: %s", err.Error()))
	}
	return string(jsonBytes)
}

func UpdateModelRequestRateLimitGroupByJSONString(jsonStr string) error {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	ModelRequestRateLimitGroup = make(map[string][2]int)
	return common.Unmarshal([]byte(jsonStr), &ModelRequestRateLimitGroup)
}

func GetGroupRateLimit(group string) (totalCount, successCount int, found bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	if ModelRequestRateLimitGroup == nil {
		return 0, 0, false
	}

	limits, found := ModelRequestRateLimitGroup[group]
	if !found {
		return 0, 0, false
	}
	return limits[0], limits[1], true
}

func CheckModelRequestRateLimitGroup(jsonStr string) error {
	checkModelRequestRateLimitGroup := make(map[string][2]int)
	err := common.Unmarshal([]byte(jsonStr), &checkModelRequestRateLimitGroup)
	if err != nil {
		return err
	}
	for group, limits := range checkModelRequestRateLimitGroup {
		if limits[0] < 0 || limits[1] < 1 {
			return fmt.Errorf("group %s has negative rate limit values: [%d, %d]", group, limits[0], limits[1])
		}
		if int64(limits[0]) > maxModelRequestRateLimitCount || int64(limits[1]) > maxModelRequestRateLimitCount {
			return fmt.Errorf("group %s [%d, %d] exceeds max rate limit %d", group, limits[0], limits[1], maxModelRequestRateLimitCount)
		}
	}

	return nil
}

func ModelRequestRateLimitUser2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitUser)
	if err != nil {
		common.SysLog(common.LogText("error marshalling user rate limits: %s", err.Error()))
	}
	return string(jsonBytes)
}

func UpdateModelRequestRateLimitUserByJSONString(jsonStr string) error {
	limits := make(map[string][2]int)
	if err := common.Unmarshal([]byte(jsonStr), &limits); err != nil {
		return err
	}
	ModelRequestRateLimitMutex.Lock()
	defer ModelRequestRateLimitMutex.Unlock()
	ModelRequestRateLimitUser = limits
	return nil
}

// GetUserRateLimit returns a user's own [total, success] limits, if set.
func GetUserRateLimit(userID int) (totalCount, successCount int, found bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	limits, found := ModelRequestRateLimitUser[strconv.Itoa(userID)]
	return limits[0], limits[1], found
}

// CheckModelRequestRateLimitUser checks the JSON value of
// ModelRequestRateLimitUser with the bounds a group limit has.
func CheckModelRequestRateLimitUser(jsonStr string) error {
	limits := make(map[string][2]int)
	if err := common.Unmarshal([]byte(jsonStr), &limits); err != nil {
		return err
	}
	for user, pair := range limits {
		if id, err := strconv.Atoi(user); err != nil || id <= 0 || strconv.Itoa(id) != user {
			return fmt.Errorf("user rate limit key %q is not a user id", user)
		}
		if pair[0] < 0 || pair[1] < 1 {
			return fmt.Errorf("user %s has invalid rate limit values: [%d, %d]", user, pair[0], pair[1])
		}
		if int64(pair[0]) > maxModelRequestRateLimitCount || int64(pair[1]) > maxModelRequestRateLimitCount {
			return fmt.Errorf("user %s [%d, %d] exceeds max rate limit %d", user, pair[0], pair[1], maxModelRequestRateLimitCount)
		}
	}
	return nil
}

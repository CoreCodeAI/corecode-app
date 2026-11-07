package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// riskGateHoldSeconds is how long a conversation the hard rules blocked stays
// held. The hard rules match only the latest message, so without a hold a
// customer could get past one by sending any next message: the client keeps
// the blocked message in the history it resends.
const riskGateHoldSeconds = 7 * 24 * 3600

// riskGateHolds is, per user, the conversation keys the hard rules blocked,
// each with its expiry and the start of the blocked message. Redis keeps a
// copy, so the next new-api color of a blue/green release holds them too; a
// user's holds load from it on that user's first request after start.
var riskGateHolds = struct {
	sync.Mutex
	users  map[int]map[string]riskGateHold
	loaded map[int]bool
}{users: map[int]map[string]riskGateHold{}, loaded: map[int]bool{}}

type riskGateHold struct {
	expires int64
	preview string
}

func riskGateHoldRedisKey(userId int) string {
	return fmt.Sprintf("risk_gate:held:%d", userId)
}

func riskGateRedis() bool {
	return common.RedisEnabled && common.RDB != nil
}

// loadRiskGateHolds reads a user's holds from Redis once per process. A Redis
// fault counts as no holds rather than retrying on every request, which
// would slow each one by Redis's timeout while it is down.
func loadRiskGateHolds(userId int) {
	riskGateHolds.Lock()
	loaded := riskGateHolds.loaded[userId]
	riskGateHolds.Unlock()
	if loaded {
		return
	}
	stored := map[string]string{}
	if riskGateRedis() {
		var err error
		stored, err = common.RDB.HGetAll(context.Background(), riskGateHoldRedisKey(userId)).Result()
		if err != nil {
			common.SysError(common.LogText("risk gate: failed to load holds of user %d: %s", userId, err.Error()))
			stored = nil
		}
	}
	riskGateHolds.Lock()
	defer riskGateHolds.Unlock()
	if riskGateHolds.loaded[userId] {
		return
	}
	riskGateHolds.loaded[userId] = true
	for key, value := range stored {
		expiresText, preview, _ := strings.Cut(value, "|")
		expires, err := strconv.ParseInt(expiresText, 10, 64)
		if err != nil {
			continue
		}
		if riskGateHolds.users[userId] == nil {
			riskGateHolds.users[userId] = map[string]riskGateHold{}
		}
		if current, ok := riskGateHolds.users[userId][key]; !ok || current.expires < expires {
			riskGateHolds.users[userId][key] = riskGateHold{expires: expires, preview: preview}
		}
	}
}

// holdRiskGateConversation holds the conversation that key covers: a later
// request that resends it is rejected until the customer rewinds past the
// blocked message or starts a new conversation.
func holdRiskGateConversation(userId int, key, message string, now int64) {
	if key == "" {
		return
	}
	loadRiskGateHolds(userId)
	hold := riskGateHold{expires: now + riskGateHoldSeconds, preview: refusedMessagePreview(message)}
	riskGateHolds.Lock()
	if riskGateHolds.users[userId] == nil {
		riskGateHolds.users[userId] = map[string]riskGateHold{}
	}
	riskGateHolds.users[userId][key] = hold
	riskGateHolds.Unlock()
	if !riskGateRedis() {
		return
	}
	redisKey := riskGateHoldRedisKey(userId)
	value := strconv.FormatInt(hold.expires, 10) + "|" + hold.preview
	go func() {
		ctx := context.Background()
		if err := common.RDB.HSet(ctx, redisKey, key, value).Err(); err != nil {
			common.SysError(common.LogText("risk gate: failed to store a hold of user %d: %s", userId, err.Error()))
			return
		}
		common.RDB.Expire(ctx, redisKey, time.Duration(riskGateHoldSeconds)*time.Second)
	}()
}

// riskGateHeld reports whether a request resends a conversation the hard
// rules blocked, and the start of the blocked message. It hashes the
// request's human messages only for a user who has a hold.
func riskGateHeld(userId int, messages []string, now int64) (string, bool) {
	loadRiskGateHolds(userId)
	riskGateHolds.Lock()
	holds := riskGateHolds.users[userId]
	for key, hold := range holds {
		if hold.expires <= now {
			delete(holds, key)
		}
	}
	if len(holds) == 0 {
		delete(riskGateHolds.users, userId)
		riskGateHolds.Unlock()
		return "", false
	}
	riskGateHolds.Unlock()

	keys := violationConversationKeys(messages)
	riskGateHolds.Lock()
	defer riskGateHolds.Unlock()
	for _, key := range keys {
		if hold, ok := riskGateHolds.users[userId][key]; ok && hold.expires > now {
			return hold.preview, true
		}
	}
	return "", false
}

// releaseRiskGateHolds drops a user's holds, as an administrator's lift of
// the user's violations does.
func releaseRiskGateHolds(userId int) {
	riskGateHolds.Lock()
	delete(riskGateHolds.users, userId)
	riskGateHolds.loaded[userId] = true
	riskGateHolds.Unlock()
	if riskGateRedis() {
		if err := common.RDB.Del(context.Background(), riskGateHoldRedisKey(userId)).Err(); err != nil {
			common.SysError(common.LogText("risk gate: failed to release holds of user %d: %s", userId, err.Error()))
		}
	}
}

func resetRiskGateHolds() {
	riskGateHolds.Lock()
	clear(riskGateHolds.users)
	clear(riskGateHolds.loaded)
	riskGateHolds.Unlock()
}

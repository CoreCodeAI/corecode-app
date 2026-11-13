package service

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// BillingSession — 统一计费会话
// ---------------------------------------------------------------------------

// BillingSession 封装单次请求的预扣费/结算/退款生命周期。
// 实现 relaycommon.BillingSettler 接口。
type BillingSession struct {
	relayInfo        *relaycommon.RelayInfo
	funding          FundingSource
	preConsumedQuota int // 实际预扣额度（信任用户可能为 0）
	tokenConsumed    int // 令牌额度实际扣减量
	extraReserved    int // 发送前补充预扣的额度（订阅退款时需要单独回滚）
	// overflow 承担 funding 覆盖不了的部分：订阅优先时是钱包，钱包优先时是订阅。
	// overflowQuota 是 preConsumedQuota 中由 overflow 持有的部分，结算后为其最终承担额。
	overflow      FundingSource
	overflowQuota int
	// allowShortfall 允许余额为正但不足预估时只预扣现有余额；shortfall 是预估中
	// 没有预扣到、结算时再收的部分。异步任务和图片请求必须全额预扣。
	allowShortfall bool
	shortfall      int
	trusted        bool   // 是否命中信任额度旁路
	fundingSettled bool   // funding.Settle 已成功，资金来源已提交
	settled        bool   // Settle 全部完成（资金 + 令牌）
	refunded       bool   // Refund 已调用
	lang           string // 请求声明的语言，为空表示未声明
	mu             sync.Mutex
}

// Settle 根据实际消耗额度进行结算。
// 资金来源和令牌额度分两步提交：若资金来源已提交但令牌调整失败，
// 会标记 fundingSettled 防止 Refund 对已提交的资金来源执行退款。
func (s *BillingSession) Settle(actualQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settled {
		return nil
	}
	delta := actualQuota - s.preConsumedQuota
	if delta == 0 {
		s.settled = true
		s.releaseSubscriptionReservations()
		return nil
	}
	// 1) 调整资金来源（仅在尚未提交时执行，防止重复调用）
	var fundingErr error
	if !s.fundingSettled {
		var applied bool
		applied, fundingErr = s.settleFunding(delta)
		if fundingErr != nil && !applied {
			return fundingErr
		}
		s.fundingSettled = true
	}
	// 2) 调整令牌额度
	var tokenErr error
	if !s.relayInfo.IsPlayground {
		if delta > 0 {
			tokenErr = model.DecreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, delta)
		} else {
			tokenErr = model.IncreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, -delta)
		}
		if tokenErr != nil {
			// 资金来源已提交，令牌调整失败只能记录日志；标记 settled 防止 Refund 误退资金
			common.SysLog(common.LogText("error adjusting token quota after funding settled (userId=%d, tokenId=%d, delta=%d): %s",
				s.relayInfo.UserId, s.relayInfo.TokenId, delta, tokenErr.Error()))
		}
	}
	s.relayInfo.BillingOverflowQuota = s.overflowQuota
	s.settled = true
	s.releaseSubscriptionReservations()
	return errors.Join(fundingErr, tokenErr)
}

// releaseSubscriptionReservations marks the request's subscription reservations
// settled, so the console stops counting them as held by a running request.
func (s *BillingSession) releaseSubscriptionReservations() {
	for _, source := range []FundingSource{s.funding, s.overflow} {
		sub, ok := source.(*SubscriptionFunding)
		if !ok || sub.preConsumed <= 0 {
			continue
		}
		if err := model.MarkSubscriptionPreConsumeSettled(sub.requestId); err != nil {
			common.SysLog(common.LogText("error marking subscription reservation settled (requestId=%s): %s", sub.requestId, err.Error()))
		}
	}
}

// settleFunding 把差额分给资金来源。补扣先由主来源在其余额内承担，再由 overflow
// 承担；钱包吸收最后剩下的部分（可为欠费）。退还先退 overflow 持有的部分。
// applied 表示是否已有资金来源被调整，此时出错也不能再整体重试。
func (s *BillingSession) settleFunding(delta int) (applied bool, err error) {
	if delta < 0 {
		back := min(-delta, s.overflowQuota)
		if back > 0 {
			if err := s.overflow.Settle(-back); err != nil {
				return false, err
			}
			s.overflowQuota -= back
			applied = true
		}
		if rest := -delta - back; rest > 0 {
			if err := s.settlePrimary(-rest); err != nil {
				return applied, err
			}
			applied = true
		}
		return applied, nil
	}

	// 订阅写入失败或读不到钱包余额时，该部分改由钱包承担，出错也不会少扣。
	primaryShare := delta
	if s.overflow != nil {
		if wallet, ok := s.funding.(*WalletFunding); ok {
			balance, err := model.GetUserQuota(wallet.userId, false)
			if err != nil {
				s.logSettleFallback("reading the wallet balance", err)
			} else {
				primaryShare = min(delta, max(balance, 0))
			}
		}
	}
	charged := 0
	if primaryShare > 0 {
		if sub, ok := s.funding.(*SubscriptionFunding); ok {
			n, err := model.PostConsumeUserSubscriptionDeltaUpTo(sub.subscriptionId, int64(primaryShare))
			if err != nil {
				s.logSettleFallback("charging the subscription", err)
			} else {
				charged = int(n)
				s.relayInfo.SubscriptionPostDelta += n
			}
		} else {
			if err := s.funding.Settle(primaryShare); err != nil {
				return false, err
			}
			charged = primaryShare
		}
		applied = charged > 0
	}
	rest := delta - charged
	if rest > 0 && s.overflow != nil {
		switch overflow := s.overflow.(type) {
		case *SubscriptionFunding:
			n, err := model.PostConsumeUserSubscriptionDeltaUpTo(overflow.subscriptionId, int64(rest))
			if err != nil {
				s.logSettleFallback("charging the overflow subscription", err)
			} else {
				s.overflowQuota += int(n)
				rest -= int(n)
				applied = applied || n > 0
			}
		case *WalletFunding:
			if err := overflow.Settle(rest); err != nil {
				return applied, err
			}
			s.overflowQuota += rest
			rest = 0
			applied = true
		}
	}
	if rest > 0 {
		if wallet, ok := s.funding.(*WalletFunding); ok {
			if err := wallet.Settle(rest); err != nil {
				return applied, err
			}
			return true, nil
		}
		return applied, fmt.Errorf("subscription quota exhausted, %d quota of user %d left uncharged", rest, s.relayInfo.UserId)
	}
	return applied, nil
}

func (s *BillingSession) logSettleFallback(step string, err error) {
	common.SysError(common.LogText("settlement fell back to the wallet after %s failed (userId=%d): %s", step, s.relayInfo.UserId, err.Error()))
}

func (s *BillingSession) settlePrimary(delta int) error {
	if sub, ok := s.funding.(*SubscriptionFunding); ok {
		n, err := model.PostConsumeUserSubscriptionDeltaUpTo(sub.subscriptionId, int64(delta))
		if err == nil {
			s.relayInfo.SubscriptionPostDelta += n
		}
		return err
	}
	return s.funding.Settle(delta)
}

// Refund 退还所有预扣费，幂等安全，异步执行。
func (s *BillingSession) Refund(c *gin.Context) {
	s.mu.Lock()
	if s.settled || s.refunded || !s.needsRefundLocked() {
		s.mu.Unlock()
		return
	}
	s.refunded = true
	s.mu.Unlock()

	logger.LogInfo(c, common.LogText("user %d request failed, refunding the pre-consumed quota (token_quota=%s, funding=%s)",
		s.relayInfo.UserId,
		logger.FormatQuota(s.tokenConsumed),
		s.funding.Source(),
	))

	// 复制需要的值到闭包中
	tokenId := s.relayInfo.TokenId
	tokenKey := s.relayInfo.TokenKey
	isPlayground := s.relayInfo.IsPlayground
	tokenConsumed := s.tokenConsumed
	extraReserved := s.extraReserved
	subscriptionId := s.relayInfo.SubscriptionId
	funding := s.funding
	overflow := s.overflow

	gopool.Go(func() {
		// 1) 退还资金来源
		if err := funding.Refund(); err != nil {
			common.SysLog(common.LogText("error refunding billing source: %s", err.Error()))
		}
		if extraReserved > 0 && funding.Source() == BillingSourceSubscription && subscriptionId > 0 {
			if err := model.PostConsumeUserSubscriptionDelta(subscriptionId, -int64(extraReserved)); err != nil {
				common.SysLog(common.LogText("error refunding subscription extra reserved quota: %s", err.Error()))
			}
		}
		if overflow != nil {
			if err := overflow.Refund(); err != nil {
				common.SysLog(common.LogText("error refunding overflow billing source: %s", err.Error()))
			}
		}
		// 2) 退还令牌额度
		if tokenConsumed > 0 && !isPlayground {
			if err := model.IncreaseTokenQuota(tokenId, tokenKey, tokenConsumed); err != nil {
				common.SysLog(common.LogText("error refunding token quota: %s", err.Error()))
			}
		}
	})
}

// NeedsRefund 返回是否存在需要退还的预扣状态。
func (s *BillingSession) NeedsRefund() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.needsRefundLocked()
}

func (s *BillingSession) needsRefundLocked() bool {
	if s.settled || s.refunded || s.fundingSettled {
		// fundingSettled 时资金来源已提交结算，不能再退预扣费
		return false
	}
	if s.tokenConsumed > 0 || s.overflowQuota > 0 {
		return true
	}
	// 订阅可能在 tokenConsumed=0 时仍预扣了额度
	if sub, ok := s.funding.(*SubscriptionFunding); ok && sub.preConsumed > 0 {
		return true
	}
	return false
}

// GetPreConsumedQuota 返回实际预扣的额度。
func (s *BillingSession) GetPreConsumedQuota() int {
	return s.preConsumedQuota
}

func (s *BillingSession) Reserve(targetQuota int) error {
	return s.reserve(targetQuota, false)
}

// ReserveBeforeSubmit 在发起上游请求前补扣，钱包余额必须覆盖差额。
func (s *BillingSession) ReserveBeforeSubmit(targetQuota int) error {
	return s.reserve(targetQuota, true)
}

func (s *BillingSession) reserve(targetQuota int, requireAvailableQuota bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.relayInfo != nil {
		_, imageRequest := s.relayInfo.Request.(*dto.ImageRequest)
		requireAvailableQuota = requireAvailableQuota || imageRequest || s.relayInfo.ImageRequestCount > 0
	}
	// 预扣不足额的会话按预估判断是否需要补扣，未预扣的部分仍在结算时收取。
	covered := s.preConsumedQuota
	if !requireAvailableQuota {
		covered += s.shortfall
	}
	if s.settled || s.refunded || s.trusted && !requireAvailableQuota || targetQuota <= covered {
		return nil
	}

	delta := targetQuota - covered
	if delta <= 0 {
		return nil
	}

	toOverflow := false
	if err := s.reserveFunding(delta, requireAvailableQuota); err != nil {
		// 订阅补扣不足时，由钱包 overflow 按欠费语义承担。
		wallet, ok := s.overflow.(*WalletFunding)
		if !ok || requireAvailableQuota {
			return err
		}
		if err := model.DecreaseUserQuota(wallet.userId, delta, false); err != nil {
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		wallet.consumed += delta
		toOverflow = true
	}
	if err := s.reserveToken(delta); err != nil {
		if toOverflow {
			wallet := s.overflow.(*WalletFunding)
			if rollbackErr := model.IncreaseUserQuota(wallet.userId, delta, false); rollbackErr != nil {
				common.SysLog(common.LogText("error rolling back overflow wallet reserve: %s", rollbackErr.Error()))
			} else {
				wallet.consumed -= delta
			}
		} else {
			s.rollbackFundingReserve(delta)
		}
		return err
	}

	s.preConsumedQuota += delta
	s.tokenConsumed += delta
	if toOverflow {
		s.overflowQuota += delta
	} else {
		s.extraReserved += delta
	}
	if requireAvailableQuota {
		s.trusted = false
		s.shortfall = max(s.shortfall-delta, 0)
	}
	s.syncRelayInfo()
	return nil
}

// ---------------------------------------------------------------------------
// PreConsume — 统一预扣费入口（含信任额度旁路）
// ---------------------------------------------------------------------------

// preConsume 执行预扣费：信任检查 -> 资金来源预扣 -> 令牌预扣。
// 令牌按资金来源实际预扣到的额度预扣，两者结算时以同一基数调整。
// 任一步骤失败时回滚已完成的步骤。
func (s *BillingSession) preConsume(c *gin.Context, quota int) *types.NewAPIError {
	effectiveQuota := quota

	// ---- 信任额度旁路 ----
	if s.shouldTrust(c) {
		s.trusted = true
		effectiveQuota = 0
		logger.LogInfo(c, common.LogText("user %d has enough quota, trusted without pre-consume (funding=%s)", s.relayInfo.UserId, s.funding.Source()))
	} else if effectiveQuota > 0 {
		logger.LogInfo(c, common.LogText("user %d needs pre-consume %s (funding=%s)", s.relayInfo.UserId, logger.FormatQuota(effectiveQuota), s.funding.Source()))
	}

	// ---- 1) 预扣资金来源 ----
	held, apiErr := s.preConsumeFunding(c, effectiveQuota)
	if apiErr != nil {
		return apiErr
	}
	// A shortfall is charged only at settlement and can leave the wallet below
	// zero; past the cap the request is refused instead of admitted on credit.
	if s.allowShortfall && effectiveQuota-held > operation_setting.MaxShortfallQuota() {
		s.releaseFunding()
		logger.LogInfo(c, common.LogText("user %d refused: reserved %s of %s, shortfall above the cap (funding=%s)", s.relayInfo.UserId, logger.FormatQuota(held), logger.FormatQuota(effectiveQuota), s.funding.Source()))
		message := &quotaMessage{
			text:  i18n.T(c, i18n.MsgQuotaShortfallAboveCap, map[string]any{"Available": logger.FormatQuota(held), "Required": logger.FormatQuota(effectiveQuota)}),
			cause: errShortfallAboveCap,
		}
		return types.NewErrorWithStatusCode(message, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
			types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}

	// ---- 2) 预扣令牌额度 ----
	if held > 0 {
		if err := PreConsumeTokenQuota(s.relayInfo, held); err != nil {
			s.releaseFunding()
			return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		s.tokenConsumed = held
	}

	s.preConsumedQuota = held
	s.shortfall = max(effectiveQuota-held, 0)
	if s.shortfall > 0 {
		logger.LogInfo(c, common.LogText("user %d reserved %s of %s, the rest settles after the response (funding=%s)", s.relayInfo.UserId, logger.FormatQuota(held), logger.FormatQuota(effectiveQuota), s.funding.Source()))
	}

	// ---- 同步 RelayInfo 兼容字段 ----
	s.syncRelayInfo()

	return nil
}

// preConsumeFunding 从主来源预扣，允许不足额时只预扣其现有余额，剩余部分交给
// overflow。返回两者实际预扣的总额。
func (s *BillingSession) preConsumeFunding(c *gin.Context, quota int) (int, *types.NewAPIError) {
	held := quota
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if s.allowShortfall {
			held = min(quota, max(s.relayInfo.UserQuota, 0))
		}
		if err := funding.PreConsume(held); err != nil {
			return 0, s.fundingError(c, err)
		}
	case *SubscriptionFunding:
		if err := funding.PreConsume(quota); err != nil {
			return 0, s.fundingError(c, err)
		}
		held = int(funding.preConsumed)
	}
	if rest := quota - held; rest > 0 && s.overflow != nil {
		switch overflow := s.overflow.(type) {
		case *WalletFunding:
			balance, err := model.GetUserQuota(overflow.userId, false)
			if err == nil {
				if take := min(rest, max(balance, 0)); overflow.PreConsume(take) == nil {
					s.overflowQuota = take
				}
			}
		case *SubscriptionFunding:
			overflow.amount = int64(rest)
			if overflow.PreConsume(rest) == nil {
				s.overflowQuota = int(overflow.preConsumed)
			} else {
				// 没有剩余订阅额度，差额照常由钱包在结算时收取。
				s.overflow = nil
			}
		}
		held += s.overflowQuota
	}
	return held, nil
}

// quotaMessage is the message a client reads for a refused reservation. It
// keeps the model error it explains, so a fallback can still read the amounts.
type quotaMessage struct {
	text  string
	cause error
}

func (e *quotaMessage) Error() string { return e.text }
func (e *quotaMessage) Unwrap() error { return e.cause }

// errShortfallAboveCap marks a refusal whose reservation already drew on every
// source that could take part. Falling back to the other source alone holds
// less, and its balance may still read as the refused reservation left it,
// because a wallet refund reaches the cache asynchronously.
var errShortfallAboveCap = errors.New("shortfall above the cap")

func isShortfallAboveCap(apiErr *types.NewAPIError) bool {
	return apiErr != nil && errors.Is(apiErr, errShortfallAboveCap)
}

func (s *BillingSession) fundingError(c *gin.Context, err error) *types.NewAPIError {
	// TODO: model 层应定义哨兵错误（如 ErrNoActiveSubscription），用 errors.Is 替代字符串匹配
	if errors.Is(err, ErrInsufficientWalletQuota) {
		userQuota, quotaErr := model.GetUserQuota(s.relayInfo.UserId, false)
		if quotaErr != nil {
			userQuota = 0
		}
		return types.NewErrorWithStatusCode(
			errors.New(i18n.T(c, i18n.MsgQuotaUserInsufficient, map[string]any{"Remaining": logger.FormatQuota(userQuota)})),
			types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
			types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	errMsg := err.Error()
	if strings.Contains(errMsg, "no active subscription") || strings.Contains(errMsg, "subscription quota insufficient") {
		message := &quotaMessage{text: i18n.T(c, i18n.MsgQuotaSubscriptionInsufficient, map[string]any{"Error": errMsg}), cause: err}
		return types.NewErrorWithStatusCode(message, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
}

// releaseFunding 在令牌预扣失败时同步退还资金来源的预扣。
func (s *BillingSession) releaseFunding() {
	if err := s.funding.Refund(); err != nil {
		common.SysLog(common.LogText("error rolling back billing source (userId=%d): %s", s.relayInfo.UserId, err.Error()))
	}
	if s.overflow != nil {
		if err := s.overflow.Refund(); err != nil {
			common.SysLog(common.LogText("error rolling back overflow billing source (userId=%d): %s", s.relayInfo.UserId, err.Error()))
		}
	}
	s.overflowQuota = 0
}

func (s *BillingSession) reserveFunding(delta int, requireAvailableQuota bool) error {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if requireAvailableQuota {
			// Image quantities and task retry prices are known before
			// submission. Reserve atomically instead of admitting wallet debt.
			if err := funding.PreConsume(delta); err != nil {
				if errors.Is(err, ErrInsufficientWalletQuota) {
					return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
				}
				return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
			}
			return nil
		}
		// 与结算补扣（SettleBilling 正差额 → WalletFunding.Settle）语义一致：
		// 全额无条件扣减，余额不足的部分记为欠费（余额可为负），不中断请求，
		// 保证日志记录的预扣额度与用户余额的实际变动始终对账一致。
		// DecreaseUserQuota 仅在数据库错误时失败。
		if err := model.DecreaseUserQuota(funding.userId, delta, false); err != nil {
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		funding.consumed += delta
		return nil
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, int64(delta)); err != nil {
			return types.NewErrorWithStatusCode(
				errors.New(i18n.Translate(s.lang, i18n.MsgQuotaSubscriptionInsufficient, map[string]any{"Error": err.Error()})),
				types.ErrorCodeInsufficientUserQuota,
				http.StatusForbidden,
				types.ErrOptionWithSkipRetry(),
				types.ErrOptionWithNoRecordErrorLog(),
			)
		}
		return nil
	default:
		return types.NewError(fmt.Errorf("unsupported funding source: %s", s.funding.Source()), types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}
}

func (s *BillingSession) rollbackFundingReserve(delta int) {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if err := model.IncreaseUserQuota(funding.userId, delta, false); err != nil {
			common.SysLog(common.LogText("error rolling back wallet funding reserve: %s", err.Error()))
		} else {
			funding.consumed -= delta
		}
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, -int64(delta)); err != nil {
			common.SysLog(common.LogText("error rolling back subscription funding reserve: %s", err.Error()))
		}
	}
}

func (s *BillingSession) reserveToken(delta int) error {
	if delta <= 0 || s.relayInfo.IsPlayground {
		return nil
	}
	if err := PreConsumeTokenQuota(s.relayInfo, delta); err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	return nil
}

// shouldTrust 统一信任额度检查，适用于钱包和订阅。
func (s *BillingSession) shouldTrust(c *gin.Context) bool {
	// 异步任务（ForcePreConsume=true）必须预扣全额，不允许信任旁路
	if s.relayInfo.ForcePreConsume {
		return false
	}

	trustQuota := operation_setting.GetQuotaSetting().TrustQuotaUSD * common.QuotaPerUnit
	// A trusted request reserves nothing and settles its whole cost
	// afterwards, so every request the user may hold at once can draw on the
	// same balance. Require the threshold for each of them.
	if limit := common.GetContextKeyInt(c, constant.ContextKeyUserConcurrencyLimit); limit > 1 {
		trustQuota *= float64(limit)
	}
	if trustQuota <= 0 || math.IsNaN(trustQuota) || math.IsInf(trustQuota, 0) {
		return false
	}

	// 检查令牌是否充足
	tokenTrusted := s.relayInfo.TokenUnlimited
	if !tokenTrusted {
		tokenQuota := c.GetInt("token_quota")
		tokenTrusted = float64(tokenQuota) > trustQuota
	}
	if !tokenTrusted {
		return false
	}

	switch s.funding.Source() {
	case BillingSourceWallet:
		return float64(s.relayInfo.UserQuota) > trustQuota
	case BillingSourceSubscription:
		// 订阅不能启用信任旁路。原因：
		// 1. PreConsumeUserSubscription 要求 amount>0 来创建预扣记录并锁定订阅
		// 2. SubscriptionFunding.PreConsume 忽略参数，始终用 s.amount 预扣
		// 3. 若信任旁路将 effectiveQuota 设为 0，会导致 preConsumedQuota 与实际订阅预扣不一致
		return false
	default:
		return false
	}
}

// syncRelayInfo 将 BillingSession 的状态同步到 RelayInfo 的兼容字段上。
func (s *BillingSession) syncRelayInfo() {
	info := s.relayInfo
	info.FinalPreConsumedQuota = s.preConsumedQuota
	info.BillingSource = s.funding.Source()
	info.BillingOverflowSource = ""
	if s.overflow != nil {
		info.BillingOverflowSource = s.overflow.Source()
	}
	info.BillingOverflowQuota = s.overflowQuota

	if sub, ok := s.funding.(*SubscriptionFunding); ok {
		info.SubscriptionId = sub.subscriptionId
		info.SubscriptionPreConsumed = sub.preConsumed + int64(s.extraReserved)
		info.SubscriptionPostDelta = 0
		info.SubscriptionAmountTotal = sub.AmountTotal
		info.SubscriptionAmountUsedAfterPreConsume = sub.AmountUsedAfter + int64(s.extraReserved)
		info.SubscriptionPlanId = sub.PlanId
		info.SubscriptionPlanTitle = sub.PlanTitle
		info.SubscriptionGift = model.IsGiftSubscriptionSource(sub.PlanSource)
	} else {
		info.SubscriptionId = 0
		info.SubscriptionPreConsumed = 0
		info.SubscriptionGift = false
	}
}

// ---------------------------------------------------------------------------
// NewBillingSession 工厂 — 根据计费偏好创建会话并处理回退
// ---------------------------------------------------------------------------

// NewBillingSession 根据用户计费偏好创建 BillingSession，处理 subscription_first / wallet_first 的回退。
//
// 同步请求在主来源余额为正但不足预估时不拒绝：主来源预扣其现有余额，另一来源
// （订阅优先且允许钱包溢出时的钱包、钱包优先时的订阅）承担差额，结算时钱包吸收
// 两者都覆盖不了的部分。异步任务和图片请求仍要求单一来源全额预扣。
func NewBillingSession(c *gin.Context, relayInfo *relaycommon.RelayInfo, preConsumedQuota int) (*BillingSession, *types.NewAPIError) {
	if relayInfo == nil {
		return nil, types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	pref := common.NormalizeBillingPreference(relayInfo.UserSetting.BillingPreference)
	_, imageRequest := relayInfo.Request.(*dto.ImageRequest)
	allowShortfall := !relayInfo.ForcePreConsume && !imageRequest && relayInfo.ImageRequestCount == 0

	newSubscriptionFunding := func(amount int64, upTo bool) *SubscriptionFunding {
		return &SubscriptionFunding{
			requestId: relayInfo.RequestId,
			userId:    relayInfo.UserId,
			modelName: relayInfo.GetBillingModelName(),
			amount:    amount,
			upTo:      upTo,
		}
	}

	// 钱包路径需要先检查用户额度；subscriptionOverflow 时由订阅承担钱包不足的部分
	tryWallet := func(subscriptionOverflow bool) (*BillingSession, *types.NewAPIError) {
		userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if userQuota <= 0 {
			return nil, types.NewErrorWithStatusCode(
				errors.New(i18n.T(c, i18n.MsgQuotaUserInsufficient, map[string]any{"Remaining": logger.FormatQuota(userQuota)})),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		if userQuota-preConsumedQuota < 0 && !allowShortfall {
			return nil, types.NewErrorWithStatusCode(
				errors.New(i18n.T(c, i18n.MsgQuotaPreConsumeInsufficient, map[string]any{"Remaining": logger.FormatQuota(userQuota), "Required": logger.FormatQuota(preConsumedQuota)})),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		relayInfo.UserQuota = userQuota

		session := &BillingSession{
			relayInfo:      relayInfo,
			funding:        &WalletFunding{userId: relayInfo.UserId},
			lang:           i18n.StatedLang(c),
			allowShortfall: allowShortfall,
		}
		if subscriptionOverflow && allowShortfall && userQuota < preConsumedQuota {
			hasSub, subCheckErr := model.HasActiveUserSubscription(relayInfo.UserId)
			if subCheckErr != nil {
				return nil, types.NewError(subCheckErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
			}
			if hasSub {
				session.overflow = newSubscriptionFunding(0, true)
			}
		}
		if apiErr := session.preConsume(c, preConsumedQuota); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	// walletOverflow 时钱包承担结算超出订阅剩余的部分（余额可为负）；只有余额为正
	// 的钱包才在预扣时分担订阅不足的部分，订阅放不下预估的请求仍被拒绝。
	trySubscription := func(walletOverflow bool) (*BillingSession, *types.NewAPIError) {
		subConsume := int64(preConsumedQuota)
		if subConsume <= 0 {
			subConsume = 1
		}
		session := &BillingSession{
			relayInfo:      relayInfo,
			lang:           i18n.StatedLang(c),
			allowShortfall: allowShortfall,
		}
		walletPositive := false
		if walletOverflow && allowShortfall {
			userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
			if err != nil {
				return nil, types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
			}
			relayInfo.UserQuota = userQuota
			session.overflow = &WalletFunding{userId: relayInfo.UserId}
			walletPositive = userQuota > 0
		}
		session.funding = newSubscriptionFunding(subConsume, walletPositive)
		// 必须传 subConsume 而非 preConsumedQuota，保证 SubscriptionFunding.amount、
		// preConsume 参数和 FinalPreConsumedQuota 三者一致，避免订阅多扣费。
		if apiErr := session.preConsume(c, int(subConsume)); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	// When neither source can hold the reservation, the wallet's message alone
	// reads as if the subscription were empty; name what each one holds and
	// what the request needs. Nil when the subscription refusal carries no amounts.
	bothInsufficient := func(subErr, walletErr *types.NewAPIError) *types.NewAPIError {
		var short *model.SubscriptionQuotaInsufficientError
		if walletErr.GetErrorCode() != types.ErrorCodeInsufficientUserQuota || !errors.As(subErr, &short) {
			return nil
		}
		wallet, err := model.GetUserQuota(relayInfo.UserId, false)
		if err != nil {
			return nil
		}
		return types.NewErrorWithStatusCode(
			errors.New(i18n.T(c, i18n.MsgQuotaSubscriptionAndWalletInsufficient, map[string]any{
				"Required":     logger.FormatQuota(int(short.Need)),
				"Subscription": logger.FormatQuota(int(short.Remaining)),
				"Wallet":       logger.FormatQuota(wallet),
			})),
			types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
			types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}

	switch pref {
	case "subscription_only":
		return trySubscription(false)
	case "wallet_only":
		return tryWallet(false)
	case "wallet_first":
		session, walletErr := tryWallet(true)
		if walletErr == nil {
			return session, nil
		}
		if walletErr.GetErrorCode() != types.ErrorCodeInsufficientUserQuota || isShortfallAboveCap(walletErr) {
			return nil, walletErr
		}
		session, subErr := trySubscription(false)
		if subErr != nil {
			if both := bothInsufficient(subErr, walletErr); both != nil {
				return nil, both
			}
			return nil, subErr
		}
		return session, nil
	case "subscription_first":
		fallthrough
	default:
		hasSub, subCheckErr := model.HasActiveUserSubscription(relayInfo.UserId)
		if subCheckErr != nil {
			return nil, types.NewError(subCheckErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if !hasSub {
			return tryWallet(false)
		}
		// 仅当用户的活跃订阅允许钱包回退时才动用钱包，否则返回订阅额度不足错误
		allowOverflow, overflowErr := model.UserActiveSubscriptionsAllowWalletOverflow(relayInfo.UserId)
		if overflowErr != nil {
			return nil, types.NewError(overflowErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		session, subErr := trySubscription(allowOverflow)
		if subErr == nil {
			return session, nil
		}
		if subErr.GetErrorCode() != types.ErrorCodeInsufficientUserQuota || !allowOverflow || isShortfallAboveCap(subErr) {
			return nil, subErr
		}
		session, walletErr := tryWallet(false)
		if walletErr != nil {
			if both := bothInsufficient(subErr, walletErr); both != nil {
				return nil, both
			}
			return nil, walletErr
		}
		return session, nil
	}
}

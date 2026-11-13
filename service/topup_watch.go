package service

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/client"
)

// CoreCode addition: the top-up watch. Every ten minutes it reads the last
// day of card top-ups and, with a read-only Stripe key, the charges behind
// them, early fraud warnings and disputes. It reports accounts that look like
// stolen or farmed cards to a Feishu group and, in enforce mode, disables the
// account that used several cards for a large sum. The system task runner
// gives one run at a time across both release colors; the alerts already sent
// travel from one run to the next in the task result.

const (
	topupWatchWindow       = int64(24 * 3600)
	topupWatchBurstWindow  = int64(2 * 3600)
	topupWatchFailedWindow = int64(3600)
	// Early fraud warnings and disputes arrive days after the charge; read
	// three days of them and remember the ones reported for a week.
	topupWatchSignalLookback = int64(3 * 24 * 3600)
	topupWatchSignalMemory   = int64(7 * 24 * 3600)
)

// sendTopupWatchFeishu posts an alert. Tests replace it.
var sendTopupWatchFeishu = SendFeishuBotText

// topupWatchCharge is the part of a Stripe charge the watch reads.
type topupWatchCharge struct {
	ID            string
	Customer      string
	Created       int64
	Amount        int64
	Currency      string
	Failed        bool
	Blocked       bool
	OutcomeReason string
	Fingerprint   string
	Last4         string
	Issuer        string
	Country       string
}

// topupWatchSignal is an early fraud warning or a dispute.
type topupWatchSignal struct {
	Key      string // efw:<id> or dispute:<id>
	Title    string
	Customer string
	ChargeID string
	Amount   int64
	Currency string
	Detail   string
}

// topupWatchData is what one run reads.
type topupWatchData struct {
	Now     int64
	TopUps  []*model.TopUp
	Users   []*model.User
	Charges []topupWatchCharge
	// StripeRead is false when no key is set or Stripe could not be read;
	// the card rules then stay silent and nobody is disabled.
	StripeRead bool
}

// topupWatchFinding is one account that broke at least one rule.
type topupWatchFinding struct {
	UserId         int
	Username       string
	StripeCustomer string
	CreatedAt      int64
	Rules          []string // stable keys, for deduplication
	Reasons        []string // the same rules for people
	Count          int      // card top-ups within the day
	Amount         float64  // CNY of those top-ups
	Cards          []topupWatchCharge
	Freeze         bool
}

// TopupWatchResult is a run's task result. Alerted maps every alert key to
// the time it was sent; the next run reads it to avoid repeating itself.
type TopupWatchResult struct {
	Alerted  map[string]int64 `json:"alerted"`
	Findings int              `json:"findings"`
	Alerts   int              `json:"alerts"`
	Frozen   []int            `json:"frozen,omitempty"`
	Errors   []string         `json:"errors,omitempty"`
}

// maxInWindow is the largest number of times within any span of width seconds.
func maxInWindow(times []int64, width int64) int {
	sorted := slices.Clone(times)
	slices.Sort(sorted)
	best, start := 0, 0
	for end := range sorted {
		for sorted[end]-sorted[start] >= width {
			start++
		}
		best = max(best, end-start+1)
	}
	return best
}

// evaluateTopupWatch applies the rules to one run's data. It is pure so the
// rules can be replayed against recorded shapes.
func evaluateTopupWatch(setting operation_setting.TopupWatchSetting, data topupWatchData) []topupWatchFinding {
	usersById := make(map[int]*model.User, len(data.Users))
	usersByCustomer := make(map[string]*model.User, len(data.Users))
	for _, user := range data.Users {
		usersById[user.Id] = user
		if user.StripeCustomer != "" {
			usersByCustomer[user.StripeCustomer] = user
		}
	}
	since := data.Now - topupWatchWindow
	topUpsByUser := map[int][]*model.TopUp{}
	for _, topUp := range data.TopUps {
		if topUp.CreateTime >= since {
			topUpsByUser[topUp.UserId] = append(topUpsByUser[topUp.UserId], topUp)
		}
	}
	chargesByUser := map[int][]topupWatchCharge{}
	for _, charge := range data.Charges {
		user := usersByCustomer[charge.Customer]
		if user == nil || charge.Created < since {
			continue
		}
		chargesByUser[user.Id] = append(chargesByUser[user.Id], charge)
	}

	userIds := make([]int, 0, len(topUpsByUser)+len(chargesByUser))
	for id := range topUpsByUser {
		userIds = append(userIds, id)
	}
	for id := range chargesByUser {
		if _, ok := topUpsByUser[id]; !ok {
			userIds = append(userIds, id)
		}
	}
	slices.Sort(userIds)

	var findings []topupWatchFinding
	for _, id := range userIds {
		user := usersById[id]
		if user == nil {
			continue
		}
		finding := topupWatchFinding{UserId: id, Username: user.Username, StripeCustomer: user.StripeCustomer, CreatedAt: user.CreatedAt}
		var times []int64
		latest := int64(0)
		for _, topUp := range topUpsByUser[id] {
			times = append(times, topUp.CreateTime)
			finding.Amount += topUp.Money
			latest = max(latest, topUp.CreateTime)
		}
		finding.Count = len(times)
		add := func(rule string, reason string) {
			finding.Rules = append(finding.Rules, rule)
			finding.Reasons = append(finding.Reasons, reason)
		}
		if burst := maxInWindow(times, topupWatchBurstWindow); burst >= setting.BurstCount {
			add("burst", fmt.Sprintf("2 小时内成功充值 %d 笔（阈值 %d）", burst, setting.BurstCount))
		}
		if finding.Amount >= setting.DailyAmount {
			add("daily", fmt.Sprintf("24 小时内银行卡充值 ¥%.2f（阈值 ¥%.0f）", finding.Amount, setting.DailyAmount))
		}
		if latest > 0 && latest-user.CreatedAt < int64(setting.NewAccountHours)*3600 && finding.Amount >= setting.NewAccountAmount {
			add("new_account", fmt.Sprintf("注册 %d 小时内充值 ¥%.2f（阈值 ¥%.0f）", setting.NewAccountHours, finding.Amount, setting.NewAccountAmount))
		}

		cardRuleHit := false
		if data.StripeRead {
			var failedTimes []int64
			blocked := 0
			seen := map[string]bool{}
			for _, charge := range chargesByUser[id] {
				if charge.Failed || charge.Blocked {
					failedTimes = append(failedTimes, charge.Created)
				}
				if charge.Blocked {
					blocked++
				}
				if charge.Fingerprint != "" && !seen[charge.Fingerprint] {
					seen[charge.Fingerprint] = true
					finding.Cards = append(finding.Cards, charge)
				}
			}
			if failed := maxInWindow(failedTimes, topupWatchFailedWindow); failed >= setting.FailedCharges {
				add("failed", fmt.Sprintf("1 小时内被拒或被拦 %d 笔（阈值 %d）", failed, setting.FailedCharges))
			}
			if blocked > 0 {
				add("blocked", fmt.Sprintf("Stripe 拦截 %d 笔（如疑似试卡）", blocked))
			}
			if len(finding.Cards) >= setting.DistinctCards {
				cardRuleHit = true
				add("cards", fmt.Sprintf("24 小时内用了 %d 张不同的卡（阈值 %d）", len(finding.Cards), setting.DistinctCards))
			}
		}
		if len(finding.Rules) == 0 {
			continue
		}
		finding.Freeze = cardRuleHit && finding.Amount >= setting.FreezeAmount &&
			setting.Mode == operation_setting.TopupWatchModeEnforce &&
			user.Role < common.RoleAdminUser && user.Status == common.UserStatusEnabled &&
			!setting.Allowlisted(id)
		findings = append(findings, finding)
	}
	return findings
}

// readTopupWatchStripe reads the day's charges and recent early fraud
// warnings and disputes with the watch's own key.
func readTopupWatchStripe(key string, now int64) ([]topupWatchCharge, []topupWatchSignal, error) {
	api := client.New(key, nil)
	chargeParams := &stripe.ChargeListParams{CreatedRange: &stripe.RangeQueryParams{GreaterThanOrEqual: now - topupWatchWindow}}
	chargeParams.Limit = stripe.Int64(100)
	var charges []topupWatchCharge
	chargeIter := api.Charges.List(chargeParams)
	for chargeIter.Next() {
		charges = append(charges, topupWatchChargeFrom(chargeIter.Charge()))
	}
	if err := chargeIter.Err(); err != nil {
		return nil, nil, fmt.Errorf("list charges: %w", err)
	}

	var signals []topupWatchSignal
	warningParams := &stripe.RadarEarlyFraudWarningListParams{CreatedRange: &stripe.RangeQueryParams{GreaterThanOrEqual: now - topupWatchSignalLookback}}
	warningParams.AddExpand("data.charge")
	warningIter := api.RadarEarlyFraudWarnings.List(warningParams)
	for warningIter.Next() {
		warning := warningIter.RadarEarlyFraudWarning()
		signal := topupWatchSignal{Key: "efw:" + warning.ID, Title: "🚨 Stripe 提前欺诈预警（Early Fraud Warning）", Detail: "类型：" + string(warning.FraudType)}
		fillTopupWatchSignalCharge(&signal, warning.Charge)
		signals = append(signals, signal)
	}
	if err := warningIter.Err(); err != nil {
		return charges, nil, fmt.Errorf("list early fraud warnings: %w", err)
	}

	disputeParams := &stripe.DisputeListParams{CreatedRange: &stripe.RangeQueryParams{GreaterThanOrEqual: now - topupWatchSignalLookback}}
	disputeParams.AddExpand("data.charge")
	disputeIter := api.Disputes.List(disputeParams)
	for disputeIter.Next() {
		dispute := disputeIter.Dispute()
		signal := topupWatchSignal{Key: "dispute:" + dispute.ID, Title: "🚨 Stripe 拒付（Dispute）", Detail: fmt.Sprintf("原因：%s，状态：%s", dispute.Reason, dispute.Status)}
		fillTopupWatchSignalCharge(&signal, dispute.Charge)
		signals = append(signals, signal)
	}
	if err := disputeIter.Err(); err != nil {
		return charges, signals, fmt.Errorf("list disputes: %w", err)
	}
	return charges, signals, nil
}

func topupWatchChargeFrom(charge *stripe.Charge) topupWatchCharge {
	result := topupWatchCharge{
		ID: charge.ID, Created: charge.Created, Amount: charge.Amount, Currency: string(charge.Currency),
		Failed: charge.Status == stripe.ChargeStatusFailed,
	}
	if charge.Customer != nil {
		result.Customer = charge.Customer.ID
	}
	if charge.Outcome != nil {
		result.Blocked = charge.Outcome.Type == "blocked"
		result.OutcomeReason = charge.Outcome.Reason
	}
	if charge.PaymentMethodDetails != nil && charge.PaymentMethodDetails.Card != nil {
		card := charge.PaymentMethodDetails.Card
		result.Fingerprint, result.Last4, result.Issuer, result.Country = card.Fingerprint, card.Last4, card.Issuer, card.Country
	}
	return result
}

func fillTopupWatchSignalCharge(signal *topupWatchSignal, charge *stripe.Charge) {
	if charge == nil {
		return
	}
	signal.ChargeID, signal.Amount, signal.Currency = charge.ID, charge.Amount, string(charge.Currency)
	if charge.Customer != nil {
		signal.Customer = charge.Customer.ID
	}
}

// RunTopupWatch runs the watch once. previous is the Alerted map of the last
// successful run. Only a database failure is an error: a Stripe failure is
// recorded in the result and the top-up rules still run, so the alerts sent
// are always remembered.
func RunTopupWatch(ctx context.Context, now int64, previous map[string]int64) (TopupWatchResult, error) {
	setting := *operation_setting.GetTopupWatchSetting()
	result := TopupWatchResult{Alerted: map[string]int64{}}
	for key, at := range previous {
		memory := topupWatchWindow
		if strings.HasPrefix(key, "efw:") || strings.HasPrefix(key, "dispute:") {
			memory = topupWatchSignalMemory
		}
		if now-at < memory {
			result.Alerted[key] = at
		}
	}

	topUps, err := model.ListCardTopUpsSince(now - topupWatchWindow)
	if err != nil {
		return result, err
	}
	data := topupWatchData{Now: now, TopUps: topUps}
	var signals []topupWatchSignal
	if key := strings.TrimSpace(setting.StripeApiKey); key != "" {
		data.Charges, signals, err = readTopupWatchStripe(key, now)
		if err != nil {
			result.Errors = append(result.Errors, err.Error())
			logger.LogWarn(ctx, common.LogText("top-up watch: Stripe read failed: %v", err))
		} else {
			data.StripeRead = true
		}
	}

	ids := make([]int, 0, len(topUps))
	for _, topUp := range topUps {
		ids = append(ids, topUp.UserId)
	}
	var customers []string
	for _, charge := range data.Charges {
		if charge.Customer != "" {
			customers = append(customers, charge.Customer)
		}
	}
	for _, signal := range signals {
		if signal.Customer != "" {
			customers = append(customers, signal.Customer)
		}
	}
	slices.Sort(ids)
	slices.Sort(customers)
	data.Users, err = model.ListUsersForTopupWatch(slices.Compact(ids), slices.Compact(customers))
	if err != nil {
		return result, err
	}

	findings := evaluateTopupWatch(setting, data)
	result.Findings = len(findings)
	for _, finding := range findings {
		fresh := false
		for _, rule := range finding.Rules {
			if _, sent := result.Alerted[fmt.Sprintf("user:%d:%s", finding.UserId, rule)]; !sent {
				fresh = true
			}
		}
		frozen := false
		if finding.Freeze {
			frozen, err = freezeTopupWatchUser(finding)
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("disable user %d: %v", finding.UserId, err))
				logger.LogError(ctx, common.LogText("top-up watch: failed to disable user %d: %v", finding.UserId, err))
			}
			if frozen {
				result.Frozen = append(result.Frozen, finding.UserId)
				fresh = true
			}
		}
		if !fresh {
			continue
		}
		if err := sendTopupWatchAlert(setting, topupWatchFindingText(finding, frozen, setting)); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("alert user %d: %v", finding.UserId, err))
			continue
		}
		result.Alerts++
		for _, rule := range finding.Rules {
			result.Alerted[fmt.Sprintf("user:%d:%s", finding.UserId, rule)] = now
		}
	}

	usersByCustomer := map[string]*model.User{}
	for _, user := range data.Users {
		if user.StripeCustomer != "" {
			usersByCustomer[user.StripeCustomer] = user
		}
	}
	for _, signal := range signals {
		if _, sent := result.Alerted[signal.Key]; sent {
			continue
		}
		if err := sendTopupWatchAlert(setting, topupWatchSignalText(signal, usersByCustomer[signal.Customer])); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("alert %s: %v", signal.Key, err))
			continue
		}
		result.Alerts++
		result.Alerted[signal.Key] = now
	}
	return result, nil
}

// freezeTopupWatchUser disables the account the way the violation guard bans
// one, and records it in the audit log. It reports whether the account was
// enabled before.
func freezeTopupWatchUser(finding topupWatchFinding) (bool, error) {
	user, err := model.GetUserById(finding.UserId, false)
	if err != nil {
		return false, err
	}
	if user.Status != common.UserStatusEnabled || user.Role >= common.RoleAdminUser {
		return false, nil
	}
	disabled := model.User{Id: finding.UserId, Status: common.UserStatusDisabled}
	if err := disabled.Update(false); err != nil {
		return false, err
	}
	if err := model.InvalidateUserTokensCache(finding.UserId); err != nil {
		common.SysError(common.LogText("top-up watch: failed to invalidate tokens cache for user %d: %s", finding.UserId, err.Error()))
	}
	params := map[string]any{
		"action":         "disable",
		"username":       user.Username,
		"id":             user.Id,
		"target_user_id": user.Id,
		"reason":         "topup_watch",
		"rules":          strings.Join(finding.Rules, ","),
		"cards":          len(finding.Cards),
		"amount_cny":     fmt.Sprintf("%.2f", finding.Amount),
	}
	model.RecordOperationAuditLog(0, common.RoleRootUser,
		fmt.Sprintf("Performed disable on user %s (ID: %d)", user.Username, user.Id), "", "user.manage", params,
		&model.AuditAdminInfo{AdminUsername: "topup_watch", AuthMethod: "system"}, nil)
	return true, nil
}

func sendTopupWatchAlert(setting operation_setting.TopupWatchSetting, text string) error {
	if strings.TrimSpace(setting.FeishuWebhook) == "" {
		return nil
	}
	return sendTopupWatchFeishu(setting.FeishuWebhook, setting.FeishuSecret, text)
}

func topupWatchTime(timestamp int64) string {
	return time.Unix(timestamp, 0).In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01-02 15:04")
}

func topupWatchFindingText(finding topupWatchFinding, frozen bool, setting operation_setting.TopupWatchSetting) string {
	var text strings.Builder
	switch {
	case frozen:
		text.WriteString("⛔ 充值异常：账户已自动冻结\n")
	case finding.Freeze || (slices.Contains(finding.Rules, "cards") && finding.Amount >= setting.FreezeAmount):
		text.WriteString("⚠️ 充值异常：达到冻结条件，但未自动冻结（观察模式、白名单、管理员或已停用）\n")
	default:
		text.WriteString("⚠️ 充值异常，请人工核查\n")
	}
	fmt.Fprintf(&text, "用户：#%d %s（注册于 %s，北京时间）\n", finding.UserId, finding.Username, topupWatchTime(finding.CreatedAt))
	fmt.Fprintf(&text, "24 小时内银行卡充值：%d 笔，¥%.2f\n", finding.Count, finding.Amount)
	text.WriteString("命中：\n")
	for _, reason := range finding.Reasons {
		text.WriteString("- " + reason + "\n")
	}
	if len(finding.Cards) > 0 {
		issuers := map[string]int{}
		for _, card := range finding.Cards {
			label := card.Issuer
			if label == "" {
				label = "发卡国 " + card.Country
			}
			issuers[label]++
		}
		labels := make([]string, 0, len(issuers))
		for label, count := range issuers {
			labels = append(labels, fmt.Sprintf("%s ×%d", label, count))
		}
		sort.Strings(labels)
		fmt.Fprintf(&text, "卡：%d 张（%s）\n", len(finding.Cards), strings.Join(labels, "，"))
	}
	if finding.StripeCustomer != "" {
		text.WriteString("Stripe：https://dashboard.stripe.com/customers/" + finding.StripeCustomer + "\n")
	}
	if frozen {
		text.WriteString("解除：控制台 → 管理员 → 用户，找到该用户后选「启用」。")
	} else {
		text.WriteString("处理：如确认异常，在控制台 → 管理员 → 用户里禁用该用户。")
	}
	return text.String()
}

func topupWatchSignalText(signal topupWatchSignal, user *model.User) string {
	var text strings.Builder
	text.WriteString(signal.Title + "\n")
	if user != nil {
		fmt.Fprintf(&text, "用户：#%d %s\n", user.Id, user.Username)
	}
	if signal.ChargeID != "" {
		fmt.Fprintf(&text, "扣款：%s，%.2f %s\n", signal.ChargeID, float64(signal.Amount)/100, strings.ToUpper(signal.Currency))
		text.WriteString("Stripe：https://dashboard.stripe.com/payments/" + signal.ChargeID + "\n")
	}
	text.WriteString(signal.Detail + "\n")
	text.WriteString("处理：在拒付发生前主动退款可以避免拒付和争议处理费；同一用户的其他扣款也要一并核查。")
	return text.String()
}

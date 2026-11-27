package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// CoreCode addition: tells the operators' Feishu group when the violation
// guard suspends or disables a customer, and when a customer reaches the ban
// count by a lenient category and the ban is left to the operators.

// sendViolationGuardFeishu posts an alert. Tests replace it.
var sendViolationGuardFeishu = SendFeishuBotText

// violationAlertExcerptRunes is how much of the refused message an alert
// quotes, enough to judge a false positive.
const violationAlertExcerptRunes = 200

// notifyViolationGuard sends one alert about a suspension, a ban, or a
// customer awaiting an operator's ban decision (banReview). Without a
// webhook it sends nothing. A failed send is logged and does not undo the
// restriction.
func notifyViolationGuard(setting operation_setting.ViolationGuardSetting, user *model.UserBase, record model.ViolationRecord, banReview bool) {
	if strings.TrimSpace(setting.FeishuWebhook) == "" {
		return
	}
	var title string
	switch {
	case banReview:
		title = fmt.Sprintf("宽松类别已到封禁次数（%d 次），只暂停，请人工确认是否封禁", setting.BanStrikes)
	case record.Action == model.ViolationActionBan:
		title = "已封禁账号"
	default:
		title = fmt.Sprintf("已暂停 %d 小时", setting.SuspendHours)
	}
	excerpt := []rune(strings.Join(strings.Fields(record.Excerpt), " "))
	if len(excerpt) > violationAlertExcerptRunes {
		excerpt = excerpt[:violationAlertExcerptRunes]
	}
	text := fmt.Sprintf("⚠️ 违规守卫：%s\n用户：%s（ID %d）\n类别：%s　模型：%s\n请求：%s\n内容：%s",
		title, user.Username, record.UserId, record.Category, record.ModelName, record.RequestId, string(excerpt))
	if err := sendViolationGuardFeishu(setting.FeishuWebhook, setting.FeishuSecret, text); err != nil {
		common.SysError(common.LogText("violation guard: Feishu alert for user %d not sent error=%q", record.UserId, err.Error()))
	}
}

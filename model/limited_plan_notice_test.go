package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func noticeTestLog(t *testing.T, userId int, logType int, at int64, other string) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(&Log{UserId: userId, CreatedAt: at, Type: logType, Other: other}).Error)
}

// The notice counts the last day's requests the gate kept off a newcomer plan,
// for a customer who still holds one, and reads nothing the gate wrote for
// administrators.
func TestLimitedPlanNoticeDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			now := common.GetTimestamp()
			previous := *operation_setting.GetLimitedPlanUseSetting()
			*operation_setting.GetLimitedPlanUseSetting() = operation_setting.LimitedPlanUseSetting{Enabled: true, Threshold: 3, ExcludeFreePlans: true}
			t.Cleanup(func() { *operation_setting.GetLimitedPlanUseSetting() = previous })
			newcomer := &SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			monthly := &SubscriptionPlan{Title: "monthly", PriceAmount: 99, DurationUnit: SubscriptionDurationDay, DurationValue: 30, Enabled: true}
			for _, plan := range []*SubscriptionPlan{newcomer, monthly} {
				require.NoError(t, DB.Create(plan).Error)
				InvalidateSubscriptionPlanCache(plan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
			}
			hold := func(user *User, plan *SubscriptionPlan, end int64) *UserSubscription {
				t.Helper()
				sub := &UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", Source: "order",
					AmountTotal: 1000, StartTime: now - 3600, EndTime: end, CreatedAt: now - 3600, UpdatedAt: now - 3600}
				require.NoError(t, DB.Create(sub).Error)
				return sub
			}
			gated := func(kind string) string {
				return fmt.Sprintf(`{"billing_source":"wallet","limited_plan_gate":%q,"admin_info":{"limited_plan_ip_gate":%q}}`, kind, kind)
			}

			user := registerAffiliateTestUser(t, "gated", "")
			sub := hold(user, newcomer, now+86400)
			stranger := registerAffiliateTestUser(t, "stranger", "")
			hold(stranger, newcomer, now+86400)

			noticeTestLog(t, user.Id, LogTypeConsume, now-7200, gated("wallet"))
			noticeTestLog(t, user.Id, LogTypeConsume, now-600, gated("wallet"))
			noticeTestLog(t, user.Id, LogTypeConsume, now-1200, gated("other_plan"))
			noticeTestLog(t, user.Id, LogTypeError, now-60, `{"error_code":"insufficient_user_quota","limited_plan_gate":"refused"}`)
			// Not counted: a request outside the window, one the gate did not touch,
			// the administrator-only marker alone, and another customer's request.
			noticeTestLog(t, user.Id, LogTypeConsume, now-LimitedPlanNoticeWindow-60, gated("wallet"))
			noticeTestLog(t, user.Id, LogTypeConsume, now-30, `{"billing_source":"wallet"}`)
			noticeTestLog(t, user.Id, LogTypeConsume, now-30, `{"admin_info":{"limited_plan_ip_gate":"wallet"}}`)
			noticeTestLog(t, stranger.Id, LogTypeConsume, now-30, gated("wallet"))

			notice, err := GetLimitedPlanNotice(user.Id, now)
			require.NoError(t, err)
			require.NotNil(t, notice)
			assert.Equal(t, 2, notice.Wallet)
			assert.Equal(t, 1, notice.OtherPlan)
			assert.Equal(t, 1, notice.Refused)
			assert.Equal(t, now-60, notice.LastAt)
			assert.Equal(t, []int{sub.Id}, notice.SubscriptionIds)
			assert.Equal(t, LimitedPlanNoticeWindow, notice.WindowSeconds)

			clean := registerAffiliateTestUser(t, "clean", "")
			hold(clean, newcomer, now+86400)
			notice, err = GetLimitedPlanNotice(clean.Id, now)
			require.NoError(t, err)
			require.NotNil(t, notice, "a holder is told, with nothing counted")
			assert.Zero(t, notice.Wallet+notice.OtherPlan+notice.Refused)
			assert.Zero(t, notice.LastAt)

			// No plan the gate guards, no notice, whatever the logs say.
			monthlyUser := registerAffiliateTestUser(t, "monthly", "")
			hold(monthlyUser, monthly, now+86400)
			noticeTestLog(t, monthlyUser.Id, LogTypeConsume, now-30, gated("wallet"))
			notice, err = GetLimitedPlanNotice(monthlyUser.Id, now)
			require.NoError(t, err)
			assert.Nil(t, notice)

			expired := registerAffiliateTestUser(t, "expired", "")
			hold(expired, newcomer, now-10)
			noticeTestLog(t, expired.Id, LogTypeConsume, now-30, gated("wallet"))
			notice, err = GetLimitedPlanNotice(expired.Id, now)
			require.NoError(t, err)
			assert.Nil(t, notice, "a plan that ended has nothing to show")

			// The window is read from the first row of the day on: a log table with
			// nothing newer than the window answers zero.
			require.NoError(t, LOG_DB.Where("created_at >= ?", now-LimitedPlanNoticeWindow).Delete(&Log{}).Error)
			notice, err = GetLimitedPlanNotice(user.Id, now)
			require.NoError(t, err)
			require.NotNil(t, notice)
			assert.Zero(t, notice.Wallet+notice.OtherPlan+notice.Refused)
		})
	}
}

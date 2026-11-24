package model

import (
	"fmt"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAffiliateRewardMigrationDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)

			// Rows from before rewards: a channel, an administrator's grant,
			// a default-rate user who invited someone, and two who did not.
			channel := registerAffiliateTestUser(t, "aff_channel", "")
			granted := registerAffiliateTestUser(t, "aff_granted", "")
			inviter := registerAffiliateTestUser(t, "aff_inviter", "")
			idle := registerAffiliateTestUser(t, "aff_idle", "")
			revoked := registerAffiliateTestUser(t, "aff_revoked", "")
			for _, row := range []Affiliate{
				{UserId: channel.Id, Rate: 30, Channel: true, Tier: AffiliateTierRetail},
				{UserId: granted.Id, Rate: 15, GrantedBy: 1},
				{UserId: inviter.Id, Rate: 5},
				{UserId: idle.Id, Rate: 5},
				{UserId: revoked.Id, Rate: 0},
			} {
				require.NoError(t, DB.Create(&row).Error)
			}
			invitee := registerAffiliateTestUser(t, "aff_invitee", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("inviter_id", inviter.Id).Error)

			require.NoError(t, MigrateAffiliateRewards())
			reward := func(user *User) string {
				t.Helper()
				affiliate, err := GetAffiliate(user.Id)
				require.NoError(t, err)
				return affiliate.Reward
			}
			assert.Equal(t, AffiliateRewardCommission, reward(channel))
			assert.Equal(t, AffiliateRewardCommission, reward(granted))
			assert.Equal(t, AffiliateRewardCommission, reward(inviter), "a user who had invited someone keeps the commission")
			assert.Equal(t, AffiliateRewardBonus, reward(idle))
			assert.Equal(t, AffiliateRewardBonus, reward(revoked))

			// The reward is fixed once set: inviting later does not move the
			// user, and migrating again changes nothing.
			later := registerAffiliateTestUser(t, "aff_later", idle.AffCode)
			assert.Equal(t, idle.Id, later.InviterId)
			require.NoError(t, MigrateAffiliateRewards())
			assert.Equal(t, AffiliateRewardBonus, reward(idle))

			// An administrator's grant puts a user on the commission.
			_, err := SetAffiliate(idle.Id, 10, "", 1)
			require.NoError(t, err)
			assert.Equal(t, AffiliateRewardCommission, reward(idle))
		})
	}
}

func TestAffiliateInviteBonusDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			setting := operation_setting.GetAffiliateSetting()
			setting.InviteBonus, setting.GiftIpLimit = 5, 2
			bonus := 5 * affiliateDollar
			wallet := func(user *User) int {
				t.Helper()
				var row User
				require.NoError(t, DB.Select("quota").First(&row, user.Id).Error)
				return row.Quota
			}
			bonusStatus := func(user *User) string {
				t.Helper()
				var row AffiliateInviteBonus
				if err := DB.Where("user_id = ?", user.Id).First(&row).Error; err != nil {
					return ""
				}
				return row.Status
			}
			due := func() []int {
				t.Helper()
				ids, err := AffiliateInviteBonusesDue(0, 100)
				require.NoError(t, err)
				return ids
			}

			// O invites on the bonus; L kept the commission; R is a retail
			// channel with a gift plan.
			o := registerAffiliateTestUser(t, "aff_o", "")
			require.NoError(t, EnsureDefaultAffiliate(o.Id))
			l := registerAffiliateTestUser(t, "aff_l", "")
			keepAffiliateTestCommission(t, l)
			r := registerAffiliateTestUser(t, "aff_r", "")
			_, err := SetAffiliate(r.Id, 30, AffiliateTierRetail, 1)
			require.NoError(t, err)
			retailTrial := &SubscriptionPlan{Title: "retail trial", DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true}
			require.NoError(t, DB.Create(retailTrial).Error)
			InvalidateSubscriptionPlanCache(retailTrial.Id)
			t.Cleanup(func() { InvalidateSubscriptionPlanCache(retailTrial.Id) })
			setting.RetailGiftPlanId = retailTrial.Id

			// O's invitee receives the bonus in the wallet at sign-up.
			a := registerAffiliateTestUser(t, "aff_a", o.AffCode)
			plan, _, err := GiveAffiliateSignupGift(a.Id, o.Id, "198.51.100.1", true)
			require.NoError(t, err)
			assert.Nil(t, plan)
			assert.Equal(t, bonus, wallet(a))
			var gift AffiliateSignupGift
			require.NoError(t, DB.Where("user_id = ?", a.Id).First(&gift).Error)
			assert.Equal(t, AffiliateSignupGiftGiven, gift.Status)
			assert.EqualValues(t, bonus, gift.Quota)
			assert.Zero(t, gift.PlanId)
			_, _, err = GiveAffiliateSignupGift(a.Id, o.Id, "198.51.100.9", true)
			require.NoError(t, err)
			assert.Equal(t, bonus, wallet(a), "a user is handled once")

			// An email sign-up receives nothing, nor does L's invitee.
			byEmail := registerAffiliateTestUser(t, "aff_mail", o.AffCode)
			_, _, err = GiveAffiliateSignupGift(byEmail.Id, o.Id, "198.51.100.2", false)
			require.NoError(t, err)
			assert.Zero(t, wallet(byEmail))
			b := registerAffiliateTestUser(t, "aff_b", l.AffCode)
			_, _, err = GiveAffiliateSignupGift(b.Id, l.Id, "198.51.100.3", true)
			require.NoError(t, err)
			assert.Zero(t, wallet(b), "an inviter on the commission gives no bonus")

			// The address limit counts the channel's plan and the bonus
			// together: after a plan and a bonus, the address's third sign-up
			// receives nothing.
			shared := "198.51.100.50"
			c1 := registerAffiliateTestUser(t, "aff_c1", r.AffCode)
			plan, _, err = GiveAffiliateSignupGift(c1.Id, r.Id, shared, true)
			require.NoError(t, err)
			require.NotNil(t, plan)
			c2 := registerAffiliateTestUser(t, "aff_c2", o.AffCode)
			_, _, err = GiveAffiliateSignupGift(c2.Id, o.Id, shared, true)
			require.NoError(t, err)
			assert.Equal(t, bonus, wallet(c2))
			c3 := registerAffiliateTestUser(t, "aff_c3", o.AffCode)
			_, _, err = GiveAffiliateSignupGift(c3.Id, o.Id, shared, true)
			require.NoError(t, err)
			assert.Zero(t, wallet(c3))
			var withheld AffiliateSignupGift
			require.NoError(t, DB.Where("user_id = ?", c3.Id).First(&withheld).Error)
			assert.Equal(t, AffiliateSignupGiftIpUsed, withheld.Status)

			// O earns no commission on A, and no bonus until A has paid at
			// least the bonus: ¥3 is not enough, ¥3 more is.
			payAffiliateTestTopUp(t, a.Id, 3, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, a.Id, 3)
			settleAffiliateTestUser(t, a.Id)
			assert.Empty(t, affiliateTestCredits(t, a.Id), "an inviter on the bonus earns no commission")
			assert.Equal(t, []int{a.Id}, due())
			given, err := PayAffiliateInviteBonus(a.Id)
			require.NoError(t, err)
			assert.False(t, given)
			assert.Zero(t, wallet(o))
			payAffiliateTestTopUp(t, a.Id, 9, PaymentProviderOffline)
			given, err = PayAffiliateInviteBonus(a.Id)
			require.NoError(t, err)
			assert.False(t, given, "an offline payment does not count")
			payAffiliateTestTopUp(t, a.Id, 3, PaymentProviderEpay)

			// Concurrent runs pay once.
			var wg sync.WaitGroup
			var paid sync.Map
			for i := range 6 {
				wg.Go(func() {
					given, err := PayAffiliateInviteBonus(a.Id)
					assert.NoError(t, err)
					paid.Store(i, given)
				})
			}
			wg.Wait()
			count := 0
			paid.Range(func(_, value any) bool {
				if value.(bool) {
					count++
				}
				return true
			})
			assert.Equal(t, 1, count)
			assert.Equal(t, bonus, wallet(o))
			assert.Equal(t, AffiliateInviteBonusGiven, bonusStatus(a))
			assert.Empty(t, due(), "A is paid and B's inviter is on the commission")

			// An inviter who shares an address with the invitee gets nothing,
			// for good; an exempt inviter is paid.
			for i, user := range []*User{o, c2} {
				require.NoError(t, DB.Create(&UserSession{
					SID: fmt.Sprintf("aff-session-%d", i), UserID: user.Id, Status: "active", RefreshHash: common.GetRandomString(64),
					LoginMethod: "password", IP: "192.0.2.77",
				}).Error)
			}
			payAffiliateTestTopUp(t, c2.Id, 10, PaymentProviderEpay)
			given, err = PayAffiliateInviteBonus(c2.Id)
			require.NoError(t, err)
			assert.False(t, given)
			assert.Equal(t, AffiliateInviteBonusSelfInvited, bonusStatus(c2))
			assert.Equal(t, bonus, wallet(o))
			require.NoError(t, SetAffiliateAddressExemption(o.Id, true, 1))
			given, err = PayAffiliateInviteBonus(c2.Id)
			require.NoError(t, err)
			assert.False(t, given, "a withheld bonus is never paid later")
			payAffiliateTestTopUp(t, byEmail.Id, 5, PaymentProviderEpay)
			given, err = PayAffiliateInviteBonus(byEmail.Id)
			require.NoError(t, err)
			assert.True(t, given, "the inviter's bonus does not depend on the invitee's")
			assert.Equal(t, 2*bonus, wallet(o))
			earned, err := SumAffiliateInviteBonuses(o.Id)
			require.NoError(t, err)
			assert.EqualValues(t, 2*bonus, earned, "the withheld bonus is not counted")

			// With the program off, or the bonus at 0, nothing is given.
			c4 := registerAffiliateTestUser(t, "aff_c4", o.AffCode)
			payAffiliateTestTopUp(t, c4.Id, 10, PaymentProviderEpay)
			setting.Enabled = false
			given, err = PayAffiliateInviteBonus(c4.Id)
			require.NoError(t, err)
			assert.False(t, given)
			setting.Enabled = true
			setting.InviteBonus = 0
			given, err = PayAffiliateInviteBonus(c4.Id)
			require.NoError(t, err)
			assert.False(t, given)
			c5 := registerAffiliateTestUser(t, "aff_c5", o.AffCode)
			_, _, err = GiveAffiliateSignupGift(c5.Id, o.Id, "198.51.100.60", true)
			require.NoError(t, err)
			assert.Zero(t, wallet(c5))
			assert.Empty(t, bonusStatus(c4))
		})
	}
}

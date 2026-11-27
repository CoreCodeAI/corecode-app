package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParsePersonaRemark(t *testing.T) {
	cases := []struct {
		name   string
		remark string
		ok     bool
		want   PersonaProfile
	}{
		{
			name:   "industry with tags",
			remark: "〔科研·生物信息｜大模型评测·画像11-03〕",
			ok:     true,
			want:   PersonaProfile{Sector: "科研", Detail: "生物信息", Tags: []string{"大模型评测"}, Date: "11-03"},
		},
		{
			name:   "no industry: every segment is a tag",
			remark: "〔大模型｜批量调用·画像11-03〕",
			ok:     true,
			want:   PersonaProfile{Sector: personaUnidentified, Tags: []string{"大模型", "批量调用"}, Date: "11-03"},
		},
		{
			name:   "human remark before the block is kept",
			remark: "  已签年付  〔软件·SaaS后端｜Agent·画像12-01〕",
			ok:     true,
			want:   PersonaProfile{Remark: "已签年付", Sector: "软件", Detail: "SaaS后端", Tags: []string{"Agent"}, Date: "12-01"},
		},
		{
			name:   "no block",
			remark: "只是备注",
			ok:     false,
		},
		{
			name:   "detail keeps later dots",
			remark: "〔游戏·手游·海外｜买量·画像11-20〕",
			ok:     true,
			want:   PersonaProfile{Sector: "游戏", Detail: "手游·海外", Tags: []string{"买量"}, Date: "11-20"},
		},
		{
			name:   "enterprise is not a sector",
			remark: "〔企业·某某科技｜Opus·画像11-03〕",
			ok:     true,
			want:   PersonaProfile{Sector: personaUnidentified, Tags: []string{"企业·某某科技", "Opus"}, Date: "11-03"},
		},
		{
			name:   "CC is not a sector",
			remark: "〔CC·Opus｜批量·画像11-03〕",
			ok:     true,
			want:   PersonaProfile{Sector: personaUnidentified, Tags: []string{"CC·Opus", "批量"}, Date: "11-03"},
		},
		{
			name:   "single segment block with a sector",
			remark: "〔硬件·汽车电子·画像11-03〕",
			ok:     true,
			want:   PersonaProfile{Sector: "硬件", Detail: "汽车电子", Tags: []string{}, Date: "11-03"},
		},
		{
			name:   "the last block counts",
			remark: "旧〔内容·旧·画像10-01〕 新〔科研·X｜Y·画像11-03〕",
			ok:     true,
			want:   PersonaProfile{Remark: "旧〔内容·旧·画像10-01〕 新", Sector: "科研", Detail: "X", Tags: []string{"Y"}, Date: "11-03"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParsePersonaRemark(tc.remark)
			require.Equal(t, tc.ok, ok)
			if tc.ok {
				assert.Equal(t, tc.want, got)
			}
		})
	}
}

// personaQuota is a spend in quota dollars, which customers pay ¥1 each for.
func personaQuota(dollars float64) int64 { return int64(dollars * common.QuotaPerUnit) }

func TestBuildPersonaInsights(t *testing.T) {
	users := []personaUser{
		{UserRef: UserRef{UserID: 1, Username: "a"}, Remark: "〔科研·X｜Y·画像11-03〕"},
		{UserRef: UserRef{UserID: 2, Username: "b"}, Remark: "〔软件·SaaS｜Agent·画像11-02〕"},
		{UserRef: UserRef{UserID: 3, Username: "c"}, Remark: "〔大模型｜批量·画像11-01〕"},
		{UserRef: UserRef{UserID: 4, Username: "d"}, Remark: "无画像备注"},
		{UserRef: UserRef{UserID: 5, Username: "e"}, Remark: "无画像备注"},
		{UserRef: UserRef{UserID: 6, Username: "f"}, Remark: "〔软件·开发工具·画像11-04〕"},
		{UserRef: UserRef{UserID: 7, Username: "g"}, Remark: ""},
	}
	spend := map[int]personaSpend{
		1: {Quota: personaQuota(600), LastActive: 100},
		2: {Quota: personaQuota(100), LastActive: 200},
		3: {Quota: personaQuota(300), LastActive: 300},
		4: {Quota: personaQuota(800), LastActive: 400},
		5: {Quota: personaQuota(499), LastActive: 500},
		7: {Quota: personaQuota(500), LastActive: 700},
	}

	got := buildPersonaInsights(users, spend, 500)

	assert.Equal(t, 4, len(got.Customers), "persona customers: users with a block, staff already out")
	assert.Equal(t, []int{1, 3, 2, 6}, []int{got.Customers[0].UserID, got.Customers[1].UserID, got.Customers[2].UserID, got.Customers[3].UserID})
	assert.InDelta(t, 1000.0, got.TotalSpendUSD, 1e-9)
	assert.Equal(t, []PersonaSector{
		{Sector: "科研", Customers: 1, SpendUSD: 600, Share: 0.6},
		{Sector: personaUnidentified, Customers: 1, SpendUSD: 300, Share: 0.3},
		{Sector: "软件", Customers: 2, SpendUSD: 100, Share: 0.1},
	}, got.Sectors)
	assert.Equal(t, []PersonaWhale{
		{UserRef: UserRef{UserID: 4, Username: "d"}, SpendUSD: 800, LastActive: 400},
		{UserRef: UserRef{UserID: 7, Username: "g"}, SpendUSD: 500, LastActive: 700},
	}, got.Whales, "whales without a block: at or above the floor, sorted by spend")
}

func TestBuildPersonaInsightsEmpty(t *testing.T) {
	got := buildPersonaInsights(nil, nil, 500)
	assert.Equal(t, []PersonaSector{}, got.Sectors)
	assert.Equal(t, []PersonaCustomer{}, got.Customers)
	assert.Equal(t, []PersonaWhale{}, got.Whales)
	assert.Equal(t, 0.0, got.TotalSpendUSD)
}

func TestPersonaInsightsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const end = int64(1761408000)

			persona := registerAffiliateTestUser(t, "persona-user", "")
			whale := registerAffiliateTestUser(t, "whale-user", "")
			old := registerAffiliateTestUser(t, "old-user", "")
			staff := &User{Username: "staff", DisplayName: "staff", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
			require.NoError(t, staff.Insert(0))
			require.NoError(t, DB.Model(&User{}).Where("id = ?", persona.Id).Update("remark", "〔科研·生物信息｜大模型·画像11-03〕").Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", staff.Id).Update("remark", "〔科研·内部·画像11-03〕").Error)

			require.NoError(t, DB.Create(&[]InsightUserHour{
				{HourStart: end - 3600, UserId: persona.Id, Quota: personaQuota(40)},
				{HourStart: end - 7200, UserId: whale.Id, Quota: personaQuota(700)},
				{HourStart: end - 3600, UserId: staff.Id, Quota: personaQuota(900)},
				// Outside the 30-day window: not counted.
				{HourStart: end - 31*86400, UserId: old.Id, Quota: personaQuota(999)},
			}).Error)

			got, err := GetPersonaInsights(InsightsRange{Start: end - 7*86400, End: end})
			require.NoError(t, err)
			require.Len(t, got.Customers, 1)
			assert.Equal(t, persona.Id, got.Customers[0].UserID)
			assert.InDelta(t, 40.0, got.Customers[0].SpendUSD, 1e-9)
			require.Len(t, got.Whales, 1, "the whale with no block; staff and the out-of-window spender are left out")
			assert.Equal(t, whale.Id, got.Whales[0].UserID)
		})
	}
}

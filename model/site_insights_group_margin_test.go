package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// allocationRowOf returns the row for key, or fails the test.
func allocationRowOf(t *testing.T, rows []GroupAllocation, key allocationKey) GroupAllocation {
	t.Helper()
	for _, row := range rows {
		if row.Kind == key.kind && row.Group == key.group {
			return row
		}
	}
	require.Failf(t, "no row", "no %s row for %q", key.kind, key.group)
	return GroupAllocation{}
}

// TestGroupAllocationsReconcileWithVendorTotals checks the rows against the
// vendor totals of vendorUpstreamCosts. Bills and fees over all rows equal the
// vendors' totals plus the upstream's unattributed amounts, and every vendor's
// pool share sums to 1. The expected figures are worked out in the comments.
func TestGroupAllocationsReconcileWithVendorTotals(t *testing.T) {
	upstream := &UpstreamInsights{
		Channels: []UpstreamChannel{
			// Billed 30; its claude bill is 10, so the other 20 is shared by revenue (claude 6, codex 4).
			{ID: 2, CostSource: UpstreamCostSourceUpstream, CostUSD: 30},
			// A fee of 9 on a channel that earned 6 from gpt-5, all from group D.
			{ID: 5, CostSource: UpstreamCostSourceFee, CostUSD: 9},
			// A fee of 5 on a channel that earned nothing: unattributed.
			{ID: 3, CostSource: UpstreamCostSourceFee, CostUSD: 5},
			// Uncosted: a pool channel, costed by its accounts.
			{ID: 4, CostSource: UpstreamCostSourceNone},
		},
		Models: []UpstreamModel{
			{Model: "claude-opus", ChannelID: 2, RevenueUSD: 6, CostUSD: 10},
			{Model: "gpt-5", ChannelID: 2, RevenueUSD: 4},
			{Model: "gpt-5", ChannelID: 3, RevenueUSD: 0},
			{Model: "gpt-5", ChannelID: 5, RevenueUSD: 6},
			{Model: "claude-opus", ChannelID: 4, RevenueUSD: 2},
		},
	}
	a := allocationKey{AllocationGroup, "A"}
	b := allocationKey{AllocationGroup, "B"}
	c := allocationKey{AllocationGroup, "C"}
	d := allocationKey{AllocationGroup, "D"}
	unattributed := allocationKey{kind: AllocationUnattributed}
	// Weights are list-price use: B's charge of 40 at ratio 2 is a weight of 20.
	usage := []allocationUsage{
		{key: a, userID: 1, channel: 2, model: "claude-opus", charged: 60, weight: 60},
		{key: b, userID: 2, channel: 2, model: "claude-opus", charged: 40, weight: 20},
		{key: staffKey, userID: 3, channel: 2, model: "claude-opus", charged: 10, weight: 10},
		{key: b, userID: 2, channel: 3, model: "gpt-5", charged: 8, weight: 4},
		{key: a, userID: 2, channel: 4, model: "claude-opus", charged: 20, weight: 20},
		{key: c, userID: 4, channel: 4, model: "claude-opus", charged: 5, weight: 5},
		{key: d, userID: 5, channel: 4, model: "gpt-5", charged: 10, weight: 10},
		{key: d, userID: 5, channel: 5, model: "gpt-5", charged: 6, weight: 6},
	}
	// User 2 is in A and B: their 20 splits by charge, A 20 of 68 and B 48 of 68.
	// User 6 has revenue and no use at all.
	revenue := map[int]float64{1: 30, 2: 20, 5: 10, 6: 3}

	// Channel 4 is the pool's own; the others are upstream sites.
	rows := allocateGroupMargins(upstream, usage, revenue, map[int]bool{4: true})
	vendors, unattributedBill, unattributedFee := vendorUpstreamCosts(upstream)
	var vendorBill, vendorFee float64
	for _, vendor := range vendors {
		vendorBill += vendor.BillUSD
		vendorFee += vendor.FeeUSD
	}
	var rowBill, rowFee, rowRevenue float64
	for _, row := range rows {
		rowBill += row.BillUSD
		rowFee += row.FeeUSD
		rowRevenue += row.RecognizedRevenue
	}
	assert.InDelta(t, 30, rowBill, 0.001, "bills: the channel's billed 30")
	assert.InDelta(t, vendorBill+unattributedBill, rowBill, 0.001, "rows add up to the vendor bills plus the upstream's unattributed bill")
	assert.InDelta(t, 14, rowFee, 0.001, "fees: 9 on the channel that earned, 5 on the one that did not")
	assert.InDelta(t, vendorFee+unattributedFee, rowFee, 0.001, "rows add up to the vendor fees plus the upstream's unattributed fee")
	assert.InDelta(t, 63, rowRevenue, 0.02, "all recognized revenue, the unused user's 3 included")

	for _, vendor := range allocationVendors {
		var share float64
		for _, row := range rows {
			share += row.PoolShare[vendor]
		}
		assert.InDelta(t, 1, share, 1e-9, "pool shares of %s sum to 1", vendor)
	}

	// Two groups on one channel split the 22 of claude bills and remainder by
	// use: A's 60 of 90 and B's 20 of 90. B's charge of 40 would give 40 of 100.
	assert.InDelta(t, 14.6667, allocationRowOf(t, rows, a).BillUSD, 0.001)
	assert.InDelta(t, 4.8889, allocationRowOf(t, rows, b).BillUSD, 0.001, "B's gpt-5 on channel 3 is a fee's channel, so it carries no bill")
	assert.InDelta(t, 2.4444, allocationRowOf(t, rows, staffKey).BillUSD, 0.001, "staff has its own row")
	assert.InDelta(t, 8, allocationRowOf(t, rows, unattributed).BillUSD, 0.001, "codex revenue on channel 2 has no codex use there")

	assert.InDelta(t, 35.88, allocationRowOf(t, rows, a).RecognizedRevenue, 0.011, "A: user 1's 30 and user 2's 20 in A's share")
	assert.InDelta(t, 14.12, allocationRowOf(t, rows, b).RecognizedRevenue, 0.011)
	assert.Zero(t, allocationRowOf(t, rows, c).RecognizedRevenue, "C pays nothing: cost with no revenue")
	assert.Zero(t, allocationRowOf(t, rows, staffKey).RecognizedRevenue)
	assert.Equal(t, 10.0, allocationRowOf(t, rows, d).RecognizedRevenue)
	assert.Zero(t, allocationRowOf(t, rows, d).BillUSD, "D earns revenue and carries no bill")
	assert.InDelta(t, 9, allocationRowOf(t, rows, d).FeeUSD, 0.001, "a fee stays in real US dollars, unconverted")
	assert.InDelta(t, 3, allocationRowOf(t, rows, unattributed).RecognizedRevenue, 0.001)
	assert.InDelta(t, 5, allocationRowOf(t, rows, unattributed).FeeUSD, 0.001)

	// A pool's cost follows use on the pool's own channel only. Claude's there
	// is A 20 and C 5; codex's is D 10. A's 60, B's 20 and staff's 10 of claude
	// went through channel 2, an upstream site, and carry its bill instead.
	assert.InDelta(t, 20.0/25, allocationRowOf(t, rows, a).PoolShare[VendorClaude], 1e-9)
	assert.InDelta(t, 5.0/25, allocationRowOf(t, rows, c).PoolShare[VendorClaude], 1e-9)
	assert.Zero(t, allocationRowOf(t, rows, b).PoolShare[VendorClaude], "B never reached the pool")
	assert.Zero(t, allocationRowOf(t, rows, staffKey).PoolShare[VendorClaude])
	assert.InDelta(t, 1, allocationRowOf(t, rows, d).PoolShare[VendorCodex], 1e-9)
	assert.Zero(t, allocationRowOf(t, rows, b).PoolShare[VendorCodex], "B's gpt-5 ran on an upstream site")
	assert.InDelta(t, 1, allocationRowOf(t, rows, unattributed).PoolShare[VendorGrok], 1e-9, "a pool that served nothing is unattributed")

	// Rows come groups first by revenue, then staff, then unattributed.
	require.Len(t, rows, 6)
	assert.Equal(t, AllocationGroup, rows[0].Kind)
	assert.Equal(t, AllocationStaff, rows[len(rows)-2].Kind)
	assert.Equal(t, AllocationUnattributed, rows[len(rows)-1].Kind)
}

// TestGroupAllocationsSplitAUserAcrossGroupsByDatabase reads the rows through
// the database: one user spends in two groups, so the user's wallet revenue
// splits by charge, and staff's use is its own row. Group A's ratio is 1 and B's
// 2, so B's claude use weighs half its charge.
func TestGroupAllocationsSplitAUserAcrossGroupsByDatabase(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 86400}
			previousRatios := ratio_setting.GroupRatio2JSONString()
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"A":1,"B":2}`))
			t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios)) })

			// Channel 4 is the pool's: its host is not public.
			engine := "http://gpt-load:3001"
			require.NoError(t, DB.Create(&Channel{Id: 4, Name: "pool", Type: 1, Key: "k4", Status: common.ChannelStatusEnabled, BaseURL: &engine}).Error)
			alice := registerAffiliateTestUser(t, "alice", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))
			// Alice paid 10 for 10 of wallet credit and spent 4 of it: revenue 4 recognized.
			require.NoError(t, DB.Create(&TopUp{UserId: alice.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess,
				TradeNo: "G1", CreateTime: day1 + 100, CompleteTime: day1 + 200}).Error)
			require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: day1 + 1000,
				ModelName: "claude-opus", Quota: int(4 * dollar), Other: `{"billing_source":"wallet"}`}).Error)
			require.NoError(t, DB.Create(&[]QuotaData{
				{UserID: alice.Id, Username: "alice", ModelName: "claude-opus", UseGroup: "A", ChannelID: 4, CreatedAt: day1, Count: 3, Quota: int(3 * dollar)},
				{UserID: alice.Id, Username: "alice", ModelName: "claude-opus", UseGroup: "B", ChannelID: 4, CreatedAt: day1, Count: 1, Quota: int(dollar)},
				{UserID: root.Id, Username: "root", ModelName: "claude-opus", UseGroup: "A", ChannelID: 4, CreatedAt: day1, Count: 2, Quota: int(2 * dollar)},
			}).Error)

			finance, err := financeInsightsAt(r, r.End)
			require.NoError(t, err)
			require.InDelta(t, 4, finance.RecognizedRevenue, 0.001)
			rows := finance.GroupAllocations
			var revenue float64
			for _, row := range rows {
				revenue += row.RecognizedRevenue
			}
			assert.InDelta(t, finance.RecognizedRevenue, revenue, 0.02, "rows add up to the range's recognized revenue")
			assert.InDelta(t, 3, allocationRowOf(t, rows, allocationKey{AllocationGroup, "A"}).RecognizedRevenue, 0.001, "alice's 4 split 3 to A and 1 to B by charge")
			assert.InDelta(t, 1, allocationRowOf(t, rows, allocationKey{AllocationGroup, "B"}).RecognizedRevenue, 0.001)
			assert.Zero(t, allocationRowOf(t, rows, staffKey).RecognizedRevenue)

			// Claude's pool use: A 3 (alice) and 2 (root) at ratio 1; B 1 at ratio 2, so 0.5.
			total := 3 + 2 + 0.5
			assert.InDelta(t, 3/total, allocationRowOf(t, rows, allocationKey{AllocationGroup, "A"}).PoolShare[VendorClaude], 1e-9)
			assert.InDelta(t, 0.5/total, allocationRowOf(t, rows, allocationKey{AllocationGroup, "B"}).PoolShare[VendorClaude], 1e-9)
			assert.InDelta(t, 2/total, allocationRowOf(t, rows, staffKey).PoolShare[VendorClaude], 1e-9, "staff's use is its own row")
		})
	}
}

// A pool no request reached is an idle cost, and a bill the upstream names its
// own way belongs to the vendor that earned on the channel.
func TestGroupAllocationsKeepAnIdlePoolAndAnUnnamedBillOffTheWrongRows(t *testing.T) {
	upstream := &UpstreamInsights{
		Channels: []UpstreamChannel{
			// GPT on an upstream site, billed 12 by request.
			{ID: 13, CostSource: UpstreamCostSourceUpstream, CostUSD: 12},
			// Video on a site that bills by day under its own model names.
			{ID: 9, CostSource: UpstreamCostSourceUpstream, CostUSD: 33},
		},
		Models: []UpstreamModel{
			{Model: "gpt-6.1-sol", ChannelID: 13, RevenueUSD: 110, CostUSD: 12},
			{Model: "seedance-2.5-720p", ChannelID: 9, RevenueUSD: 34, CostUSD: 19},
			{Model: "sd-pro-video-v2", ChannelID: 9, RevenueUSD: 0, CostUSD: 14},
		},
	}
	require.Equal(t, VendorOther, ModelVendor("sd-pro-video-v2"), "the upstream's name maps to no vendor of ours")
	media := ModelVendor("seedance-2.5-720p")
	welfare := allocationKey{AllocationGroup, "welfare"}
	video := allocationKey{AllocationGroup, "video"}
	usage := []allocationUsage{
		{key: welfare, userID: 1, channel: 13, model: "gpt-6.1-sol", charged: 110, weight: 220},
		{key: video, userID: 2, channel: 9, model: "seedance-2.5-720p", charged: 34, weight: 34},
	}
	// The codex pool's channel is 2, and nothing used it.
	rows := allocateGroupMargins(upstream, usage, map[int]float64{1: 13, 2: 9}, map[int]bool{2: true})

	assert.InDelta(t, 12, allocationRowOf(t, rows, welfare).BillUSD, 1e-9, "the group carries its channel's bill")
	assert.Empty(t, allocationRowOf(t, rows, welfare).PoolShare, "and no part of a pool it never reached")
	assert.InDelta(t, 1, allocationRowOf(t, rows, allocationKey{kind: AllocationUnattributed}).PoolShare[VendorCodex], 1e-9, "the idle pool is unattributed")
	assert.InDelta(t, 33, allocationRowOf(t, rows, video).BillUSD, 1e-9, "the video group carries the whole bill, its own-named part included")

	vendors, unattributedBill, _ := vendorUpstreamCosts(upstream)
	assert.Zero(t, unattributedBill)
	for _, vendor := range vendors {
		switch vendor.Vendor {
		case media:
			assert.InDelta(t, 33, vendor.BillUSD, 1e-9, "the bill is the media vendor's whole")
		case VendorOther:
			assert.Zero(t, vendor.BillUSD, "no bill under a vendor that earned nothing")
		}
	}
}

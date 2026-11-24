package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func modelAllocationOf(t *testing.T, rows []ModelAllocation, kind, name string) ModelAllocation {
	t.Helper()
	for _, row := range rows {
		if row.Kind == kind && row.Model == name {
			return row
		}
	}
	require.Failf(t, "no row", "no %s row for %q", kind, name)
	return ModelAllocation{}
}

// TestModelAllocationsCarryEachChannelsCostForTheModelsOwnUse checks a model on
// two channels, a billed upstream and the pool, against the group view's
// rules. Quota is in quota units, so a charge of 5*QuotaPerUnit is $5.
func TestModelAllocationsCarryEachChannelsCostForTheModelsOwnUse(t *testing.T) {
	unit := common.QuotaPerUnit
	upstream := &UpstreamInsights{
		Channels: []UpstreamChannel{
			// Billed 12: gpt-6 matched 8, the other 4 shared by revenue (gpt-6 8, gpt-image 2).
			{ID: 7, CostSource: UpstreamCostSourceUpstream, CostUSD: 12},
			// A fee of 6 on a channel whose only model earned.
			{ID: 9, CostSource: UpstreamCostSourceFee, CostUSD: 6},
			// The pool's own channel, uncosted as a channel.
			{ID: 1, CostSource: UpstreamCostSourceNone},
		},
		Models: []UpstreamModel{
			{Model: "gpt-6", ChannelID: 7, RevenueUSD: 8, CostUSD: 8},
			{Model: "gpt-image-2", ChannelID: 7, RevenueUSD: 2},
			{Model: "gpt-fee", ChannelID: 9, RevenueUSD: 3},
			{Model: "claude-opus", ChannelID: 1, RevenueUSD: 100},
		},
	}
	usage := []allocationUsage{
		{key: allocationKey{AllocationGroup, "G"}, userID: 1, channel: 7, model: "gpt-6", charged: 6 * unit, weight: 6 * unit, requests: 60},
		{key: staffKey, userID: 2, channel: 7, model: "gpt-6", charged: 2 * unit, weight: 2 * unit, requests: 5},
		{key: allocationKey{AllocationGroup, "G"}, userID: 1, channel: 7, model: "gpt-image-2", charged: 2 * unit, weight: 2 * unit, requests: 4},
		{key: allocationKey{AllocationGroup, "H"}, userID: 3, channel: 9, model: "gpt-fee", charged: 3 * unit, weight: 3 * unit, requests: 9},
		{key: allocationKey{AllocationGroup, "G"}, userID: 1, channel: 1, model: "claude-opus", charged: 60 * unit, weight: 60 * unit, requests: 600},
		{key: allocationKey{AllocationGroup, "H"}, userID: 3, channel: 1, model: "claude-opus", charged: 20 * unit, weight: 40 * unit, requests: 200},
		{key: staffKey, userID: 2, channel: 1, model: "claude-opus", charged: 20 * unit, weight: 20 * unit, requests: 50},
		{key: allocationKey{AllocationGroup, "G"}, userID: 1, channel: 1, model: "claude-haiku", charged: 10 * unit, weight: 10 * unit, requests: 100},
	}
	rows := allocateModelMargins(upstream, usage, map[int]bool{1: true})

	gpt := modelAllocationOf(t, rows, AllocationModel, "gpt-6")
	assert.Equal(t, VendorCodex, gpt.Vendor)
	assert.InDelta(t, 6, gpt.RevenueUSD, 1e-9, "customers only: staff's 2 is its own row's use")
	assert.Equal(t, int64(60), gpt.Requests)
	assert.InDelta(t, 6, gpt.CostedRevenueUSD, 1e-9, "a billed channel's revenue is costed")
	// gpt-6's matched bill 8 splits 6:2 with staff; the remainder 4 goes by revenue
	// across the channel's vendors: codex 8+0 of 10 is 3.2, shared 6:2 as well.
	assert.InDelta(t, 8*0.75+3.2*0.75, gpt.BillUSD, 1e-6)
	assert.Zero(t, gpt.FeeUSD)

	fee := modelAllocationOf(t, rows, AllocationModel, "gpt-fee")
	assert.InDelta(t, 6, fee.FeeUSD, 1e-9, "the channel's fee, in real dollars, unconverted")
	assert.InDelta(t, 3, fee.CostedRevenueUSD, 1e-9)

	opus := modelAllocationOf(t, rows, AllocationModel, "claude-opus")
	assert.InDelta(t, 80, opus.RevenueUSD, 1e-9)
	assert.InDelta(t, 80, opus.CostedRevenueUSD, 1e-9, "the pool's own channel is costed by its accounts")
	haiku := modelAllocationOf(t, rows, AllocationModel, "claude-haiku")
	// Claude's pool use by weight: opus 60+40 customers' and 20 staff's, haiku 10, total 130.
	assert.InDelta(t, 100.0/130, opus.PoolShare[VendorClaude], 1e-9)
	assert.InDelta(t, 10.0/130, haiku.PoolShare[VendorClaude], 1e-9)
	staff := modelAllocationOf(t, rows, AllocationStaff, "")
	assert.InDelta(t, 20.0/130, staff.PoolShare[VendorClaude], 1e-9, "staff's use takes its own share of the pool")
	assert.Zero(t, staff.RevenueUSD)

	var share float64
	for _, row := range rows {
		share += row.PoolShare[VendorClaude]
	}
	assert.InDelta(t, 1, share, 1e-9, "the pool's shares over all rows sum to 1")
}

// TestModelAllocationsLeaveRevenueOnAnUnpricedChannelOutOfTheCostedPart pins the
// coverage figure: a channel with no bill and no fee, and a channel no longer
// listed, serve revenue with no cost basis.
func TestModelAllocationsLeaveRevenueOnAnUnpricedChannelOutOfTheCostedPart(t *testing.T) {
	unit := common.QuotaPerUnit
	upstream := &UpstreamInsights{
		Channels: []UpstreamChannel{
			{ID: 7, CostSource: UpstreamCostSourceUpstream, CostUSD: 1},
			{ID: 3, CostSource: UpstreamCostSourceNone},
		},
		Models: []UpstreamModel{
			{Model: "gpt-6", ChannelID: 7, RevenueUSD: 4, CostUSD: 1},
			{Model: "gpt-6", ChannelID: 3, RevenueUSD: 5},
			{Model: "gpt-6", ChannelID: 2, RevenueUSD: 1},
		},
	}
	group := allocationKey{AllocationGroup, "G"}
	usage := []allocationUsage{
		{key: group, userID: 1, channel: 7, model: "gpt-6", charged: 4 * unit, weight: 4 * unit, requests: 4},
		{key: group, userID: 1, channel: 3, model: "gpt-6", charged: 5 * unit, weight: 5 * unit, requests: 5},
		{key: group, userID: 1, channel: 2, model: "gpt-6", charged: 1 * unit, weight: 1 * unit, requests: 1},
	}
	rows := allocateModelMargins(upstream, usage, map[int]bool{})
	gpt := modelAllocationOf(t, rows, AllocationModel, "gpt-6")
	assert.InDelta(t, 10, gpt.RevenueUSD, 1e-9)
	assert.InDelta(t, 4, gpt.CostedRevenueUSD, 1e-9, "only the billed channel's 4 has a cost")
	assert.Equal(t, int64(10), gpt.Requests)
	assert.InDelta(t, 1, gpt.BillUSD, 1e-9)
}

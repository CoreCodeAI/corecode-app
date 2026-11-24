package model

import (
	"cmp"
	"slices"

	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// Kinds of GroupAllocation row. A customer's group is its billing group; staff
// are one row whatever group they billed in; unattributed holds what no row
// can take.
const (
	AllocationGroup        = "group"
	AllocationStaff        = "staff"
	AllocationUnattributed = "unattributed"
)

var allocationKinds = []string{AllocationGroup, AllocationStaff, AllocationUnattributed}

// allocationVendors are the vendors a pool's account cost is shared out for:
// every vendor ModelVendor names.
var allocationVendors = []string{VendorClaude, VendorCodex, VendorGrok, VendorGemini, VendorMedia, VendorOther}

// GroupAllocation is one row of the group margin view. It is an allocation,
// not a measurement. RecognizedRevenue is the range's recognized revenue
// (payment currency) of the users whose charge fell in the row, each user's
// revenue split by their charge across groups. BillUSD is the upstream bills it
// carries, in quota dollars one for one; FeeUSD the monthly fees, in real US
// dollars. PoolShare maps a vendor to the fraction of that vendor's pool account
// cost the row carries, so a caller multiplies it by the account cost it prices.
// Over all rows, each vendor's PoolShare sums to 1, and so do the bills and fees
// plus the unattributed row's amounts.
type GroupAllocation struct {
	Group             string             `json:"group"`
	Kind              string             `json:"kind"`
	RecognizedRevenue float64            `json:"recognized_revenue"`
	BillUSD           float64            `json:"bill_usd"`
	FeeUSD            float64            `json:"fee_usd"`
	PoolShare         map[string]float64 `json:"pool_share"`
}

// allocationKey names one GroupAllocation row.
type allocationKey struct {
	kind  string
	group string
}

var (
	staffKey        = allocationKey{kind: AllocationStaff}
	unattributedKey = allocationKey{kind: AllocationUnattributed}
)

// allocationUsage is one quota_data sum: what a user was charged in one group
// on one channel and model. weight is that charge with the group's ratio
// divided out, the list-price use a shared cost is split by.
type allocationUsage struct {
	key     allocationKey
	userID  int
	channel int
	model   string
	charged float64
	weight  float64
	// requests is the logged request count of the sum (quota_data.count).
	requests int64
}

// readAllocationUsage sums quota_data by group, channel, model and user. Staff's
// use keeps its own row. A group with no ratio now divides by 1, as
// shareEngineCost does.
func readAllocationUsage(r InsightsRange, staff []int) ([]allocationUsage, error) {
	var rows []struct {
		UseGroup  string
		ChannelId int
		ModelName string
		UserId    int
		Quota     int64
		Count     int64
	}
	if err := DB.Model(&QuotaData{}).
		Select("use_group, channel_id, model_name, user_id, SUM(quota) AS quota, SUM(count) AS count").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).
		Group("use_group, channel_id, model_name, user_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	isStaff := make(map[int]bool, len(staff))
	for _, id := range staff {
		isStaff[id] = true
	}
	ratios := ratio_setting.GetGroupRatioCopy()
	usage := make([]allocationUsage, 0, len(rows))
	for _, row := range rows {
		if row.Quota <= 0 {
			continue
		}
		key := allocationKey{kind: AllocationGroup, group: row.UseGroup}
		if isStaff[row.UserId] {
			key = staffKey
		}
		divisor := ratios[row.UseGroup]
		if divisor <= 0 {
			divisor = 1
		}
		charged := float64(row.Quota)
		usage = append(usage, allocationUsage{
			key: key, userID: row.UserId, channel: row.ChannelId, model: row.ModelName,
			charged: charged, weight: charged / divisor, requests: row.Count,
		})
	}
	return usage, nil
}

// unnamedBill reports a bill under a vendor no model of ours maps to, on a
// channel where that vendor earned nothing: the upstream's own name for a
// model sold here under another vendor.
func unnamedBill(vendor string, channelRevenue map[string]float64) bool {
	return vendor == VendorOther && channelRevenue[VendorOther] <= 0
}

type costUnit struct {
	channel int
	model   string
}

type channelVendor struct {
	channel int
	vendor  string
}

// addUse adds value to the use of key under at.
func addUse[K comparable](uses map[K]map[allocationKey]float64, at K, key allocationKey, value float64) {
	if uses[at] == nil {
		uses[at] = map[allocationKey]float64{}
	}
	uses[at][key] += value
}

// allocationShares is each row's fraction of a cost split by use. A cost with
// no use at all is wholly unattributed.
func allocationShares(uses map[allocationKey]float64) map[allocationKey]float64 {
	var total float64
	for _, weight := range uses {
		total += weight
	}
	if total <= 0 {
		return map[allocationKey]float64{unattributedKey: 1}
	}
	shares := make(map[allocationKey]float64, len(uses))
	for key, weight := range uses {
		shares[key] = weight / total
	}
	return shares
}

// spreadCost puts amount under vendor on each row by its share of uses.
func spreadCost(into map[allocationKey]map[string]float64, uses map[allocationKey]float64, vendor string, amount float64) {
	for key, share := range allocationShares(uses) {
		if into[key] == nil {
			into[key] = map[string]float64{}
		}
		into[key][vendor] += amount * share
	}
}

// allocateGroupMargins shares the range's recognized revenue and its upstream
// costs out to the rows, by the same figures vendorUpstreamCosts uses for the
// vendor totals:
//   - a bill of a channel and model goes by the rows' use of that channel and
//     model, for a vendor whose bill on the channel is positive;
//   - a fee, and a bill's remainder, goes by the vendor's share of the channel's
//     revenue, then by the rows' use of the channel and vendor;
//   - a pool's account cost goes by each vendor's use on the pool's own
//     channels (engines): a group served by an upstream channel carries that
//     channel's bill, not an account it never reached, and a pool that served
//     nothing is unattributed, an idle cost.
//
// A bill for a model whose vendor is not known and that earned nothing on the
// channel is the upstream naming a model its own way (unnamedBill): it is
// shared as the channel's remainder is, by the vendors that did earn there.
//
// A cost with no use to split by, or no revenue to split by, goes to the
// unattributed row under its vendor, or under "" for the upstream's unattributed
// amounts. Revenue goes to each user's rows by the user's charge across groups.
func allocateGroupMargins(upstream *UpstreamInsights, usage []allocationUsage, userRevenue map[int]float64, engines map[int]bool) []GroupAllocation {
	modelUse := map[costUnit]map[allocationKey]float64{}
	channelUse := map[channelVendor]map[allocationKey]float64{}
	poolUse := map[string]map[allocationKey]float64{}
	mix := map[int]map[allocationKey]float64{}
	mixTotal := map[int]float64{}
	for _, row := range usage {
		vendor := ModelVendor(row.model)
		addUse(modelUse, costUnit{row.channel, row.model}, row.key, row.weight)
		addUse(channelUse, channelVendor{row.channel, vendor}, row.key, row.weight)
		if engines[row.channel] {
			addUse(poolUse, vendor, row.key, row.weight)
		}
		addUse(mix, row.userID, row.key, row.charged)
		mixTotal[row.userID] += row.charged
	}

	revenue := map[int]map[string]float64{}
	billed := map[channelVendor]float64{}
	for _, model := range upstream.Models {
		vendor := ModelVendor(model.Model)
		if revenue[model.ChannelID] == nil {
			revenue[model.ChannelID] = map[string]float64{}
		}
		revenue[model.ChannelID][vendor] += model.RevenueUSD
		billed[channelVendor{model.ChannelID, vendor}] += model.CostUSD
	}
	sourceOf := make(map[int]string, len(upstream.Channels))
	for _, channel := range upstream.Channels {
		sourceOf[channel.ID] = channel.CostSource
	}

	bills := map[allocationKey]map[string]float64{}
	fees := map[allocationKey]map[string]float64{}
	for _, model := range upstream.Models {
		vendor := ModelVendor(model.Model)
		if sourceOf[model.ChannelID] != UpstreamCostSourceUpstream || billed[channelVendor{model.ChannelID, vendor}] <= 0 ||
			unnamedBill(vendor, revenue[model.ChannelID]) {
			continue
		}
		spreadCost(bills, modelUse[costUnit{model.ChannelID, model.Model}], vendor, model.CostUSD)
	}
	for _, channel := range upstream.Channels {
		if channel.CostSource == UpstreamCostSourceNone {
			continue
		}
		into := fees
		shared := channel.CostUSD
		if channel.CostSource == UpstreamCostSourceUpstream {
			into = bills
			for vendor := range revenue[channel.ID] {
				if usd := billed[channelVendor{channel.ID, vendor}]; usd > 0 && !unnamedBill(vendor, revenue[channel.ID]) {
					shared -= usd
				}
			}
		}
		shared = max(shared, 0)
		if shared <= 0 {
			continue
		}
		var total float64
		for _, usd := range revenue[channel.ID] {
			total += usd
		}
		if total <= 0 {
			spreadCost(into, nil, "", shared)
			continue
		}
		for vendor, usd := range revenue[channel.ID] {
			spreadCost(into, channelUse[channelVendor{channel.ID, vendor}], vendor, shared*usd/total)
		}
	}

	pool := map[allocationKey]map[string]float64{}
	for _, vendor := range allocationVendors {
		for key, share := range allocationShares(poolUse[vendor]) {
			if pool[key] == nil {
				pool[key] = map[string]float64{}
			}
			pool[key][vendor] = share
		}
	}

	recognized := map[allocationKey]float64{}
	for user, amount := range userRevenue {
		if mixTotal[user] <= 0 {
			recognized[unattributedKey] += amount
			continue
		}
		for key, charged := range mix[user] {
			recognized[key] += amount * charged / mixTotal[user]
		}
	}

	keys := map[allocationKey]bool{staffKey: true, unattributedKey: true}
	for key := range recognized {
		keys[key] = true
	}
	for key := range pool {
		keys[key] = true
	}
	for key := range bills {
		keys[key] = true
	}
	for key := range fees {
		keys[key] = true
	}
	rows := make([]GroupAllocation, 0, len(keys))
	for key := range keys {
		row := GroupAllocation{
			Group:             key.group,
			Kind:              key.kind,
			RecognizedRevenue: roundTo(recognized[key], 2),
			PoolShare:         map[string]float64{},
		}
		for _, usd := range bills[key] {
			row.BillUSD += usd
		}
		for _, usd := range fees[key] {
			row.FeeUSD += usd
		}
		row.BillUSD, row.FeeUSD = roundTo(row.BillUSD, 4), roundTo(row.FeeUSD, 4)
		for vendor, share := range pool[key] {
			row.PoolShare[vendor] = share
		}
		// Staff always has a row; the unattributed row only when it holds something.
		if key == unattributedKey && row.RecognizedRevenue == 0 && row.BillUSD == 0 && row.FeeUSD == 0 && len(row.PoolShare) == 0 {
			continue
		}
		rows = append(rows, row)
	}
	slices.SortFunc(rows, func(a, b GroupAllocation) int {
		return cmp.Or(
			cmp.Compare(slices.Index(allocationKinds, a.Kind), slices.Index(allocationKinds, b.Kind)),
			cmp.Compare(b.RecognizedRevenue, a.RecognizedRevenue),
			cmp.Compare(a.Group, b.Group),
		)
	})
	return rows
}

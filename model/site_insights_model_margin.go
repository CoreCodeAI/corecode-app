package model

import (
	"cmp"
	"slices"

	"github.com/QuantumNous/new-api/common"
)

// AllocationModel is the kind of a ModelAllocation row that is one model's
// customer use. A model view also has the staff and unattributed kinds of the
// group view: staff's use carries its own share of every cost, and what no
// model can take is unattributed.
const AllocationModel = "model"

var modelKinds = []string{AllocationModel, AllocationStaff, AllocationUnattributed}

// ModelAllocation is one row of the model margin view. Like GroupAllocation it
// is an allocation, not a measurement. RevenueUSD is what customers (not staff)
// were charged for the model at the groups' prices, in quota dollars, from
// quota_data; it is not the cash received, which averages less over the
// range. Requests is the model's logged request count. CostedRevenueUSD is the
// part of RevenueUSD served on a channel whose cost is known: a billed upstream,
// a monthly fee, or the pool's own accounts. The rest has no cost basis (a
// channel with no bill and no fee, or one no longer listed), and the console
// leaves it out of the margin rate.
//
// BillUSD is the model's share of the upstream bills, in quota dollars one for
// one, FeeUSD of the monthly fees, in real US dollars. PoolShare maps a vendor
// to the fraction of that vendor's pool account cost the row carries; a model
// row has at most its own vendor. The shares and amounts follow
// allocateGroupMargins, with the model in place of the group, so over all rows
// they add up to the same bills, fees and pool shares of 1.
type ModelAllocation struct {
	Model            string             `json:"model"`
	Kind             string             `json:"kind"`
	Vendor           string             `json:"vendor"`
	Requests         int64              `json:"requests"`
	RevenueUSD       float64            `json:"revenue_usd"`
	CostedRevenueUSD float64            `json:"costed_revenue_usd"`
	BillUSD          float64            `json:"bill_usd"`
	FeeUSD           float64            `json:"fee_usd"`
	PoolShare        map[string]float64 `json:"pool_share"`
}

// allocateModelMargins shares the range's upstream costs out to models by the
// same rules as the group view: usage is re-keyed from the billing group to the
// model, staff's use keeping its own row. A cost is carried by the use of the
// channel and model it came from, so a model on two channels carries each
// channel's cost for its own use only.
func allocateModelMargins(upstream *UpstreamInsights, usage []allocationUsage, engines map[int]bool) []ModelAllocation {
	costed := make(map[int]bool, len(upstream.Channels))
	for _, channel := range upstream.Channels {
		costed[channel.ID] = channel.CostSource != UpstreamCostSourceNone
	}
	rekeyed := make([]allocationUsage, 0, len(usage))
	revenue := map[allocationKey]float64{}
	costedRevenue := map[allocationKey]float64{}
	requests := map[allocationKey]int64{}
	for _, row := range usage {
		if row.key.kind == AllocationGroup {
			row.key = allocationKey{kind: AllocationGroup, group: row.model}
		}
		rekeyed = append(rekeyed, row)
		if row.key.kind != AllocationGroup {
			continue
		}
		usd := row.charged / common.QuotaPerUnit
		revenue[row.key] += usd
		requests[row.key] += row.requests
		if costed[row.channel] || engines[row.channel] {
			costedRevenue[row.key] += usd
		}
	}
	allocations := allocateGroupMargins(upstream, rekeyed, nil, engines)
	rows := make([]ModelAllocation, 0, len(allocations))
	for _, allocation := range allocations {
		key := allocationKey{kind: allocation.Kind, group: allocation.Group}
		row := ModelAllocation{
			Model:            allocation.Group,
			Kind:             allocation.Kind,
			Requests:         requests[key],
			RevenueUSD:       roundTo(revenue[key], 4),
			CostedRevenueUSD: roundTo(costedRevenue[key], 4),
			BillUSD:          allocation.BillUSD,
			FeeUSD:           allocation.FeeUSD,
			PoolShare:        allocation.PoolShare,
		}
		if allocation.Kind == AllocationGroup {
			row.Kind, row.Vendor = AllocationModel, ModelVendor(allocation.Group)
		}
		rows = append(rows, row)
	}
	slices.SortFunc(rows, func(a, b ModelAllocation) int {
		return cmp.Or(
			cmp.Compare(slices.Index(modelKinds, a.Kind), slices.Index(modelKinds, b.Kind)),
			cmp.Compare(b.RevenueUSD, a.RevenueUSD),
			cmp.Compare(a.Model, b.Model),
		)
	})
	return rows
}

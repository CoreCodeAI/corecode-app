package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
)

func TestShareEngineCost(t *testing.T) {
	rows := []model.UserModelSpend{
		// Opus: alice pays at 2x, bob at 1x; both used the same official
		// value, so they share opus's cost evenly.
		{UserId: 1, ModelName: "claude-opus", LogGroup: "vip", Quota: 200},
		{UserId: 2, ModelName: "claude-opus", LogGroup: "plain", Quota: 100},
		// Sonnet and haiku are not named by the engine; they share the rest.
		{UserId: 1, ModelName: "claude-sonnet", LogGroup: "plain", Quota: 300},
		{UserId: 3, ModelName: "claude-haiku", LogGroup: "unknown", Quota: 100},
		// Grok: the engine names only a model new-api never charged for, so
		// its whole cost is shared over grok's models.
		{UserId: 2, ModelName: "grok-4", LogGroup: "plain", Quota: 50},
		// Nothing is shared by an empty charge.
		{UserId: 4, ModelName: "claude-opus", LogGroup: "plain", Quota: 0},
	}
	costs := map[string]*providerCost{
		model.VendorClaude: {models: map[string]float64{"claude-opus": 10}, total: 18},
		model.VendorGrok:   {models: map[string]float64{"grok-x": 3}, total: 3},
		// No one was charged for codex in the window.
		model.VendorCodex: {models: map[string]float64{}, total: 4},
	}
	shares, unattributed := shareEngineCost(rows, costs, map[string]float64{"vip": 2, "plain": 1})

	assert.InDelta(t, 5+6, shares[1], 1e-9)
	assert.InDelta(t, 5+3, shares[2], 1e-9)
	assert.InDelta(t, 2, shares[3], 1e-9)
	assert.NotContains(t, shares, 4)
	assert.InDelta(t, 4, unattributed, 1e-9)
}

func TestShareEngineCostWhenEveryModelIsNamed(t *testing.T) {
	rows := []model.UserModelSpend{
		{UserId: 1, ModelName: "claude-opus", Quota: 100},
		{UserId: 2, ModelName: "claude-sonnet", Quota: 300},
	}
	// The engine names both models; the rest of its cost (a model it did not
	// name and new-api did not sell) goes over all of them.
	costs := map[string]*providerCost{
		model.VendorClaude: {models: map[string]float64{"claude-opus": 1, "claude-sonnet": 1}, total: 6},
	}
	shares, unattributed := shareEngineCost(rows, costs, nil)
	assert.InDelta(t, 1+1, shares[1], 1e-9)
	assert.InDelta(t, 1+3, shares[2], 1e-9)
	assert.Zero(t, unattributed)
}

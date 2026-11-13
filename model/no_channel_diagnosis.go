package model

import (
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// NoChannelCause says why no channel of a request's groups took its model.
// Only NoChannelDown is an outage; the others are the caller's mistake, and
// retrying them can never succeed.
type NoChannelCause int

const (
	// NoChannelDown: the request's groups serve the model, but none of their
	// channels can take it now, or every channel listing it is disabled.
	NoChannelDown NoChannelCause = iota
	// NoChannelUnlisted: no channel lists the model, enabled or disabled.
	NoChannelUnlisted
	// NoChannelOtherGroups: enabled channels serve the model, but only in
	// groups the request did not use.
	NoChannelOtherGroups
	// NoChannelWrongEndpoint: enabled channels of the request's groups serve
	// the model, but none on the request's path, such as a video model sent
	// to /v1/messages.
	NoChannelWrongEndpoint
)

// NoChannelDiagnosis is the cause of a refusal and what the caller needs to
// explain it.
type NoChannelDiagnosis struct {
	Cause NoChannelCause
	// Groups are, for NoChannelOtherGroups, the groups whose enabled channels
	// serve the model, sorted. Callers show only those the user may use.
	Groups []string
	// TaskModel is set for NoChannelWrongEndpoint when a serving channel's
	// plugin runs asynchronous tasks: the model is submitted as a task.
	TaskModel bool
}

// DiagnoseNoChannel explains a request that found no channel among groups,
// the groups it was allowed to use (an auto token's resolved list), with the
// filters it was selected under. It reads the abilities table, so it runs
// only on the refusal path.
func DiagnoseNoChannel(groups []string, modelName string, filters []dto.ChannelFilter) NoChannelDiagnosis {
	names := []string{modelName}
	if normalized := ratio_setting.RoutingMatchModelName(modelName); normalized != modelName {
		names = append(names, normalized)
	}
	var abilities []Ability
	DB.Select(commonGroupCol+", channel_id").Where("model IN ? AND enabled = ?", names, true).Find(&abilities)

	var inGroups []int
	var otherGroups []string
	for _, ability := range abilities {
		if slices.Contains(groups, ability.Group) {
			inGroups = append(inGroups, ability.ChannelId)
		} else if !slices.Contains(otherGroups, ability.Group) {
			otherGroups = append(otherGroups, ability.Group)
		}
	}

	if len(inGroups) > 0 {
		diagnosis := NoChannelDiagnosis{Cause: NoChannelDown}
		for _, id := range inGroups {
			channel, err := CacheGetChannel(id)
			if err != nil || channel.Status != common.ChannelStatusEnabled {
				continue
			}
			satisfied, kind := ChannelSatisfiesFilters(channel, modelName, filters)
			if satisfied {
				// A channel could take it, so the selection lost a race with
				// a cache update: treat it as transient.
				return NoChannelDiagnosis{Cause: NoChannelDown}
			}
			switch kind {
			case dto.FilterRequestPath, dto.FilterTaskPluginEndpoint, dto.FilterTaskPluginIdentity:
				diagnosis.Cause = NoChannelWrongEndpoint
				diagnosis.TaskModel = diagnosis.TaskModel || servesAsTask(channel)
			}
		}
		return diagnosis
	}
	if len(otherGroups) > 0 {
		slices.Sort(otherGroups)
		return NoChannelDiagnosis{Cause: NoChannelOtherGroups, Groups: otherGroups}
	}
	if IsModelListed(modelName) {
		return NoChannelDiagnosis{Cause: NoChannelDown}
	}
	return NoChannelDiagnosis{Cause: NoChannelUnlisted}
}

// servesAsTask reports whether a channel's plugin runs asynchronous tasks,
// as a video plugin does, rather than only relaying requests.
func servesAsTask(channel *Channel) bool {
	if channel.Type != constant.ChannelTypeTaskPlugin {
		return false
	}
	plugin, ok := jsplugin.DefaultRegistry.Get(channel.GetSetting().TaskPluginKey)
	return ok && plugin.Meta.HasTaskPart()
}

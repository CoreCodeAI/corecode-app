package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	kitdto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A video model served by a task plugin and sent to /v1/messages, the case
// that produced over a thousand 503s a day from one client, is a wrong
// endpoint on an asynchronous task model, not an outage. A relay plugin on
// the wrong path is a wrong endpoint too, but not a task model.
func TestDiagnoseNoChannelNamesATaskModelOnTheWrongEndpoint(t *testing.T) {
	setupChannelStatusTest(t)
	for _, source := range []string{
		`export const meta = {apiVersion: 1, key: "diagnose-video", name: "Video", version: "1.0.0", author: {name: "Test"}, models: ["video-model"], fetchMode: "per_task"};
export function buildSubmitRequest(ctx) { return {url: ctx.baseUrl + "/submit"}; }
export function parseSubmitResponse(ctx, resp) { return {taskId: "id"}; }
export function buildQueryRequest(ctx) { return {url: ctx.baseUrl + "/query"}; }
export function parseTaskResult() { return {status: "SUCCESS"}; }`,
		`export const meta = {apiVersion: 1, key: "diagnose-relay", name: "Relay", version: "1.0.0", author: {name: "Test"}, relay: [{incoming_path: "/v1/chat/completions", upstream_path: "/chat"}]};`,
	} {
		plugin, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
		require.NoError(t, err)
		key := plugin.Meta.Key
		t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(key) })
	}
	for _, channel := range []struct{ group, model, plugin string }{
		{"video", "video-model", "diagnose-video"},
		{"relay", "relay-model", "diagnose-relay"},
	} {
		ch := &Channel{Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Name: channel.plugin, Key: channel.plugin + "-key", Group: channel.group, Models: channel.model}
		ch.SetSetting(kitdto.ChannelSettings{TaskPluginKey: channel.plugin})
		require.NoError(t, ch.Insert())
	}
	InitChannelCache()

	// The distributor's identity filter for a request no plugin endpoint
	// claimed: a plugin channel qualifies only through its relay routes.
	filters := []dto.ChannelFilter{
		{Kind: dto.FilterRequestPath, RequestPath: "/v1/messages"},
		{Kind: dto.FilterTaskPluginIdentity, RequestPath: "/v1/messages"},
	}
	assert.Equal(t, NoChannelDiagnosis{Cause: NoChannelWrongEndpoint, TaskModel: true},
		DiagnoseNoChannel([]string{"claude", "video"}, "video-model", filters))
	assert.Equal(t, NoChannelDiagnosis{Cause: NoChannelWrongEndpoint},
		DiagnoseNoChannel([]string{"relay"}, "relay-model", filters))
	assert.Equal(t, NoChannelDiagnosis{Cause: NoChannelOtherGroups, Groups: []string{"video"}},
		DiagnoseNoChannel([]string{"claude"}, "video-model", filters))
	assert.Equal(t, NoChannelDiagnosis{Cause: NoChannelUnlisted},
		DiagnoseNoChannel([]string{"video"}, "wan-3.0-480p", filters))
}

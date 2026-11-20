package controller

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamHasNoChannel(t *testing.T) {
	noChannel := types.WithOpenAIError(types.OpenAIError{Message: "No available channel for model m under group g (distributor)", Type: "new_api_error", Code: "model_not_found"}, http.StatusServiceUnavailable)
	assert.True(t, service.UpstreamHasNoChannel(noChannel))
	for name, err := range map[string]*types.NewAPIError{
		"another 503":          types.NewOpenAIError(errors.New("overloaded"), types.ErrorCodeBadResponseStatusCode, http.StatusServiceUnavailable),
		"an unknown model 404": types.WithOpenAIError(types.OpenAIError{Message: "The model does not exist", Code: "model_not_found"}, http.StatusNotFound),
		"no error":             nil,
	} {
		assert.False(t, service.UpstreamHasNoChannel(err), name)
	}
}

func TestExcludedChannelIsLeftOutOfRetries(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	previousGroups := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups)) })
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	const modelName = "excluded-channel-test"
	for _, spec := range []struct {
		id       int
		priority int64
	}{{41, 10}, {42, 5}} {
		channel := model.Channel{
			Id: spec.id, Name: fmt.Sprintf("channel-%d", spec.id), Type: constant.ChannelTypeOpenAI,
			Key: "test-only", Status: common.ChannelStatusEnabled, Models: modelName, Group: "default",
			Priority: common.GetPointer(spec.priority), Weight: common.GetPointer(uint(1)),
		}
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, channel.AddAbilities(db))
	}
	for _, cached := range []bool{false, true} {
		common.MemoryCacheEnabled = cached
		model.InitChannelCache()
		t.Run(fmt.Sprintf("cache=%t", cached), func(t *testing.T) {
			ctx := newPinRetryContext()
			exclude := func(id int) {
				service.GetChannelConstraints(ctx).AddFilter(dto.ChannelFilter{Kind: dto.FilterExcludedChannel, ExcludedChannelID: id})
			}
			retry := &service.RetryParam{Ctx: ctx, TokenGroup: "default", ModelName: modelName, Retry: common.GetPointer(0)}

			exclude(41)
			channel, _, err := service.CacheGetRandomSatisfiedChannel(retry)
			require.NoError(t, err)
			require.NotNil(t, channel)
			assert.Equal(t, 42, channel.Id, "the retry goes to the channel that was not excluded")

			exclude(42)
			channel, _, err = service.CacheGetRandomSatisfiedChannel(retry)
			require.NoError(t, err)
			assert.Nil(t, channel, "no channel is left once both are excluded")
		})
	}
}

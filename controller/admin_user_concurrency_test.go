package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdminSetsUserConcurrencyLimitThroughUserEdit(t *testing.T) {
	_, identity, target := setupAdminUserTest(t)
	settings := operation_setting.GetTokenSetting()
	previous, previousOptions := settings.UserConcurrencyLimits, common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { settings.UserConcurrencyLimits, common.OptionMap = previous, previousOptions })
	// Another server wrote user 7's override; this one has not synced it yet,
	// so an edit built from memory would drop it.
	settings.UserConcurrencyLimits = map[string]int{}
	require.NoError(t, model.DB.Create(&model.Option{Key: model.UserConcurrencyLimitsOptionKey, Value: `{"7":3}`}).Error)

	update := func(extra string) *securityEnrollmentResponse {
		body := fmt.Sprintf(`{"id":%d,"username":"managed-user","group":"default"%s}`, target.Id, extra)
		response := adminUserRequest(http.MethodPut, "/api/user/", body, "", identity, common.RoleAdminUser, nil, UpdateUser)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result), response.Body.String())
		return &result
	}
	stored := func() map[string]int {
		var option model.Option
		require.NoError(t, model.DB.Where(&model.Option{Key: model.UserConcurrencyLimitsOptionKey}).First(&option).Error)
		limits := map[string]int{}
		require.NoError(t, common.UnmarshalJsonStr(option.Value, &limits))
		return limits
	}
	read := func() map[string]any {
		params := gin.Params{{Key: "id", Value: strconv.Itoa(target.Id)}}
		response := adminUserRequest(http.MethodGet, "/api/user/"+strconv.Itoa(target.Id), "", "", identity, common.RoleAdminUser, params, GetUser)
		var result struct {
			Success bool           `json:"success"`
			Data    map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		return result.Data
	}
	id := strconv.Itoa(target.Id)

	require.True(t, update(`,"concurrency_limit":20`).Success)
	assert.Equal(t, map[string]int{"7": 3, id: 20}, stored())
	limit, ok := operation_setting.UserConcurrencyOverride(target.Id)
	assert.True(t, ok)
	assert.Equal(t, 20, limit)
	data := read()
	assert.Equal(t, "managed-user", data["username"])
	assert.EqualValues(t, 20, data["concurrency_limit"])
	concurrency := data["concurrency"].(map[string]any)
	assert.EqualValues(t, 20, concurrency["limit"])
	assert.Equal(t, operation_setting.ConcurrencySourceUser, concurrency["source"])

	// A console that does not send the field leaves the override alone.
	require.True(t, update(``).Success)
	assert.Equal(t, map[string]int{"7": 3, id: 20}, stored())

	// A negative limit is refused before anything is written.
	assert.False(t, update(`,"concurrency_limit":-1`).Success)
	assert.False(t, update(`,"concurrency_limit":"20"`).Success)
	assert.Equal(t, map[string]int{"7": 3, id: 20}, stored())

	// 0 lifts the limit; null hands the user back to the group and tiers.
	require.True(t, update(`,"concurrency_limit":0`).Success)
	assert.Equal(t, map[string]int{"7": 3, id: 0}, stored())
	require.True(t, update(`,"concurrency_limit":null`).Success)
	assert.Equal(t, map[string]int{"7": 3}, stored())
	_, ok = operation_setting.UserConcurrencyOverride(target.Id)
	assert.False(t, ok)
	data = read()
	assert.Nil(t, data["concurrency_limit"])
	assert.NotEqual(t, operation_setting.ConcurrencySourceUser, data["concurrency"].(map[string]any)["source"])
}

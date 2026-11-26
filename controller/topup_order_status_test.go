package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetUserPaymentOrderReadsOnlyTheCallersOwnOrders(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDB := model.DB
	common.QuotaPerUnit = 500000

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.SubscriptionOrder{}))
	model.DB = db
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		model.DB = oldDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			require.NoError(t, sqlDB.Close())
		}
	})

	require.NoError(t, db.Create(&[]model.TopUp{
		{UserId: 1, Amount: 10, Money: 10, TradeNo: "ref_mine_pending", PaymentMethod: "stripe", Status: common.TopUpStatusPending, BonusQuota: 0},
		{UserId: 1, Amount: 10, Money: 10, TradeNo: "ref_mine_paid", PaymentMethod: "stripe", Status: common.TopUpStatusSuccess, BonusQuota: 1000},
		{UserId: 2, Amount: 99, Money: 99, TradeNo: "ref_theirs", PaymentMethod: "stripe", Status: common.TopUpStatusSuccess},
	}).Error)
	require.NoError(t, db.Create(&model.SubscriptionOrder{UserId: 1, PlanId: 3, TradeNo: "sub_mine", PaymentMethod: "stripe", Status: common.TopUpStatusPending}).Error)

	get := func(userId int, query string) *httptest.ResponseRecorder {
		gin.SetMode(gin.TestMode)
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Set("id", userId)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/order?"+query, nil)
		GetUserPaymentOrder(ctx)
		return recorder
	}

	t.Run("a pending top-up reports pending and nothing credited", func(t *testing.T) {
		recorder := get(1, "trade_no=ref_mine_pending")
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.JSONEq(t, `{"success":true,"message":"","data":{"trade_no":"ref_mine_pending","kind":"topup","status":"pending","credited_quota":0}}`, recorder.Body.String())
	})

	t.Run("a paid top-up reports the quota it credits, bonus included", func(t *testing.T) {
		recorder := get(1, "trade_no=ref_mine_paid")
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.JSONEq(t, `{"success":true,"message":"","data":{"trade_no":"ref_mine_paid","kind":"topup","status":"success","credited_quota":5001000}}`, recorder.Body.String())
	})

	t.Run("a subscription order is found by its own trade number", func(t *testing.T) {
		recorder := get(1, "trade_no=sub_mine")
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.JSONEq(t, `{"success":true,"message":"","data":{"trade_no":"sub_mine","kind":"subscription","status":"pending","credited_quota":0}}`, recorder.Body.String())
	})

	t.Run("another user's order reads as not found", func(t *testing.T) {
		recorder := get(1, "trade_no=ref_theirs")
		assert.Equal(t, http.StatusNotFound, recorder.Code)
		assert.NotContains(t, recorder.Body.String(), "99")
	})

	t.Run("an unknown or missing trade number is rejected", func(t *testing.T) {
		assert.Equal(t, http.StatusNotFound, get(1, "trade_no=ref_missing").Code)
		assert.Equal(t, http.StatusOK, get(1, "").Code)
	})
}

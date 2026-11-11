package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// invoiceOrders are the ids the fixture gives user 11's orders.
var invoiceOrders = struct {
	epay, stripe, crypto, pending, old, other, plan, balancePlan int
}{101, 102, 103, 104, 105, 106, 201, 202}

// useInvoiceTestDB points the model at fresh tables on dialect with invoicing
// on at 4%, ¥1 per display unit, and two customers: 11, holding $10 of
// balance and the orders in invoiceOrders, and 12, holding one top-up. MySQL
// and PostgreSQL run when TEST_MYSQL_DSN or TEST_POSTGRES_DSN names an empty
// database.
func useInvoiceTestDB(t *testing.T, dialect string) {
	t.Helper()
	// Issuing and rejecting send mail in the account's language.
	require.NoError(t, i18n.Init())
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
	case "mysql":
		dsn := os.Getenv("TEST_MYSQL_DSN")
		if dsn == "" {
			t.Skip("TEST_MYSQL_DSN is not configured")
		}
		driver = mysql.Open(dsn)
	case "postgres":
		dsn := os.Getenv("TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("TEST_POSTGRES_DSN is not configured")
		}
		driver = postgres.Open(dsn)
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	previousSetting := *operation_setting.GetInvoiceSetting()
	previousPrice, previousQuotaPerUnit := operation_setting.Price, common.QuotaPerUnit
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
	common.RedisEnabled = false
	invoiceSetting := operation_setting.GetInvoiceSetting()
	invoiceSetting.Enabled = true
	invoiceSetting.TaxRate = 4
	invoiceSetting.Categories = "软件开发服务"
	invoiceSetting.OrderDays = 365
	invoiceSetting.MaxOrders = 50
	operation_setting.Price = 1
	common.QuotaPerUnit = 500000

	invoiceTables := []any{&model.Invoice{}, &model.InvoiceItem{}, &model.InvoiceFile{}, &model.InvoiceTaxPayment{}, &model.InvoiceOrderAmount{}}
	tables := append([]any{&model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}, &model.User{}, &model.Log{}}, invoiceTables...)
	require.False(t, db.Migrator().HasTable(&model.Invoice{}), "use an empty test database")
	require.NoError(t, db.AutoMigrate(tables...))
	// A second migration must find nothing to change.
	require.NoError(t, db.AutoMigrate(invoiceTables...))

	require.NoError(t, db.Create(&model.User{Id: 11, Username: "user11", AffCode: "aff11", Quota: 5000000}).Error)
	require.NoError(t, db.Create(&model.User{Id: 12, Username: "user12", AffCode: "aff12", Quota: 1000}).Error)
	now := common.GetTimestamp()
	topUp := func(id, userId int, provider string, money float64, status string, created int64) *model.TopUp {
		return &model.TopUp{Id: id, UserId: userId, Money: money, TradeNo: "T" + strconv.Itoa(id), PaymentMethod: provider,
			PaymentProvider: provider, Status: status, CreateTime: created, CompleteTime: created + 60}
	}
	for _, order := range []*model.TopUp{
		topUp(invoiceOrders.epay, 11, model.PaymentProviderEpay, 100, common.TopUpStatusSuccess, now-3600),
		topUp(invoiceOrders.stripe, 11, model.PaymentProviderStripe, 50.5, common.TopUpStatusSuccess, now-7200),
		topUp(invoiceOrders.crypto, 11, model.PaymentProviderNowPayments, 200, common.TopUpStatusSuccess, now-10800),
		topUp(invoiceOrders.pending, 11, model.PaymentProviderEpay, 30, common.TopUpStatusPending, now-600),
		topUp(invoiceOrders.old, 11, model.PaymentProviderEpay, 80, common.TopUpStatusSuccess, now-400*24*3600),
		topUp(invoiceOrders.other, 12, model.PaymentProviderEpay, 30, common.TopUpStatusSuccess, now-3600),
	} {
		require.NoError(t, db.Create(order).Error)
	}
	for _, order := range []*model.SubscriptionOrder{
		{Id: invoiceOrders.plan, UserId: 11, PlanId: 1, Money: 9.9, TradeNo: "S201", PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess, CreateTime: now - 1800},
		{Id: invoiceOrders.balancePlan, UserId: 11, PlanId: 1, Money: 9.9, TradeNo: "S202", PaymentProvider: model.PaymentProviderBalance, Status: common.TopUpStatusSuccess, CreateTime: now - 1800},
	} {
		require.NoError(t, db.Create(order).Error)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(tables...))
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled = previousRedis
		*operation_setting.GetInvoiceSetting() = previousSetting
		operation_setting.Price, common.QuotaPerUnit = previousPrice, previousQuotaPerUnit
		require.NoError(t, sqlDB.Close())
	})
}

func callInvoice(t *testing.T, handler gin.HandlerFunc, method, target string, body string, userId int) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if method == http.MethodPost && strings.HasSuffix(target, "/notify") {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	return serveInvoice(t, handler, request, userId)
}

func serveInvoice(t *testing.T, handler gin.HandlerFunc, request *http.Request, userId int) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request
	c.Set("id", userId)
	// Routes put the id after /self/ or /admin/.
	for _, marker := range []string{"/self/", "/admin/"} {
		if _, rest, ok := strings.Cut(request.URL.Path, marker); ok {
			id, _, _ := strings.Cut(rest, "/")
			c.Params = gin.Params{{Key: "id", Value: id}}
		}
	}
	handler(c)
	return recorder
}

func invoiceJSON(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var response map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response), recorder.Body.String())
	return response
}

func submitInvoice(t *testing.T, userId int, body string) map[string]any {
	t.Helper()
	return invoiceJSON(t, callInvoice(t, SubmitInvoice, http.MethodPost, "/api/invoice", body, userId))
}

func invoiceableKeys(t *testing.T, userId int) []string {
	t.Helper()
	orders, err := model.ListInvoiceableOrders(userId)
	require.NoError(t, err)
	keys := make([]string, 0, len(orders))
	for _, order := range orders {
		keys = append(keys, order.OrderType+":"+strconv.Itoa(order.OrderId))
	}
	return keys
}

func storedInvoice(t *testing.T, id int) model.Invoice {
	t.Helper()
	var invoice model.Invoice
	require.NoError(t, model.DB.Unscoped().First(&invoice, id).Error)
	return invoice
}

func submittedId(t *testing.T, response map[string]any) int {
	t.Helper()
	require.Equal(t, true, response["success"], response)
	return int(response["data"].(map[string]any)["invoice"].(map[string]any)["id"].(float64))
}

func company(orders string, method string) string {
	return `{"title_type":"company","title":" 示例科技有限公司 ","tax_no":"91110000ma01abcd3x","category":"软件开发服务","email":"finance@example.com","orders":[` + orders + `],"payment_method":"` + method + `"}`
}

func orderRef(orderType string, id int) string {
	return `{"order_type":"` + orderType + `","order_id":` + strconv.Itoa(id) + `}`
}

func TestInvoiceSubmitWithBalanceTax(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInvoiceTestDB(t, dialect)
			epayOrder := orderRef(model.InvoiceOrderTopUp, invoiceOrders.epay)
			planOrder := orderRef(model.InvoiceOrderSubscription, invoiceOrders.plan)
			cryptoOrder := orderRef(model.InvoiceOrderTopUp, invoiceOrders.crypto)

			// Paid epay, Stripe and NOWPayments orders in the window can be
			// invoiced; pending, old, balance-paid and other accounts' cannot.
			assert.ElementsMatch(t, []string{"topup:101", "topup:102", "topup:103", "subscription:201"}, invoiceableKeys(t, 11))

			refused := []struct {
				name, body, key string
			}{
				{"company without a tax number", strings.Replace(company(epayOrder, "balance"), "91110000ma01abcd3x", "", 1), "Enter a valid taxpayer identification number"},
				{"unknown category", strings.Replace(company(epayOrder, "balance"), "软件开发服务", "咨询服务", 1), "Select a product category"},
				{"bad email", strings.Replace(company(epayOrder, "balance"), "finance@example.com", "finance", 1), "Invalid email address"},
				{"another account's order", company(orderRef(model.InvoiceOrderTopUp, invoiceOrders.other), "balance"), "Some selected orders cannot be invoiced. Refresh the order list and try again."},
				{"pending order", company(orderRef(model.InvoiceOrderTopUp, invoiceOrders.pending), "balance"), "Some selected orders cannot be invoiced. Refresh the order list and try again."},
				{"order outside the window", company(orderRef(model.InvoiceOrderTopUp, invoiceOrders.old), "balance"), "Some selected orders cannot be invoiced. Refresh the order list and try again."},
				{"plan bought with balance", company(orderRef(model.InvoiceOrderSubscription, invoiceOrders.balancePlan), "balance"), "Some selected orders cannot be invoiced. Refresh the order list and try again."},
				{"the same order twice", company(epayOrder+","+epayOrder, "balance"), "Some selected orders cannot be invoiced. Refresh the order list and try again."},
				{"epay while epay is off", company(epayOrder, "alipay"), "Payment method does not exist"},
			}
			for _, tc := range refused {
				response := submitInvoice(t, 11, tc.body)
				assert.Equal(t, false, response["success"], tc.name)
				assert.Equal(t, tc.key, response["message_key"], tc.name)
			}

			// ¥109.90 of orders carry ¥4.40 of tax (439.6 fen rounded), which
			// is $4.40 of balance at ¥1 per dollar.
			id := submittedId(t, submitInvoice(t, 11, company(epayOrder+","+planOrder, "balance")))
			invoice := storedInvoice(t, id)
			assert.Equal(t, model.InvoiceStatusPendingReview, invoice.Status)
			assert.Equal(t, "示例科技有限公司", invoice.Title)
			assert.Equal(t, "91110000MA01ABCD3X", invoice.TaxNo)
			assert.EqualValues(t, 10990, invoice.OrderCents)
			assert.EqualValues(t, 440, invoice.TaxCents)
			assert.EqualValues(t, 2200000, invoice.TaxQuota)
			assert.Equal(t, model.InvoiceTaxBalance, invoice.TaxMethod)
			assert.Equal(t, 2800000, userQuota(t, 11))
			assert.ElementsMatch(t, []string{"topup:102", "topup:103"}, invoiceableKeys(t, 11))

			// A held order cannot go into a second application, and the
			// database refuses a second hold whichever server asks.
			response := submitInvoice(t, 11, company(epayOrder, "balance"))
			held := "topup:" + strconv.Itoa(invoiceOrders.epay)
			assert.Error(t, model.DB.Create(&model.InvoiceItem{InvoiceId: id, UserId: 11, OrderType: model.InvoiceOrderTopUp, OrderId: invoiceOrders.epay, AmountCents: 1, ClaimKey: &held}).Error)
			assert.Equal(t, "Some selected orders cannot be invoiced. Refresh the order list and try again.", response["message_key"])

			// ¥8.00 of tax on ¥200 needs $8 of balance; the refusal leaves the
			// order free and the balance untouched.
			response = submitInvoice(t, 11, company(cryptoOrder, "balance"))
			assert.Equal(t, "Insufficient balance", response["message_key"])
			assert.Equal(t, 2800000, userQuota(t, 11))
			assert.Contains(t, invoiceableKeys(t, 11), "topup:103")

			response = invoiceJSON(t, callInvoice(t, GetInvoiceSummary, http.MethodGet, "/api/invoice/summary", "", 11))
			summary := response["data"].(map[string]any)
			assert.Equal(t, map[string]any{"cents": float64(25050), "count": float64(2)}, summary["available"])
			assert.Equal(t, map[string]any{"cents": float64(10990), "count": float64(1)}, summary["processing"])
			assert.Equal(t, map[string]any{"cents": float64(0), "count": float64(0)}, summary["issued"])

			// Customers see only their own applications.
			response = invoiceJSON(t, callInvoice(t, GetSelfInvoices, http.MethodGet, "/api/invoice/self", "", 12))
			assert.EqualValues(t, 0, response["data"].(map[string]any)["total"])
			response = invoiceJSON(t, callInvoice(t, GetSelfInvoice, http.MethodGet, "/api/invoice/self/"+strconv.Itoa(id), "", 12))
			assert.Equal(t, false, response["success"])
			response = invoiceJSON(t, callInvoice(t, GetSelfInvoice, http.MethodGet, "/api/invoice/self/"+strconv.Itoa(id), "", 11))
			assert.Len(t, response["data"].(map[string]any)["items"], 2)
		})
	}
}

// notifyInvoiceTax posts epay's signed notification of a tax payment.
func notifyInvoiceTax(t *testing.T, tradeNo string, method string, money string, key string) string {
	t.Helper()
	params := epay.GenerateParams(map[string]string{
		"pid": "1000", "trade_no": "EP" + tradeNo, "out_trade_no": tradeNo, "type": method,
		"name": "INVTAX", "money": money, "trade_status": epay.StatusTradeSuccess,
	}, key)
	form := url.Values{}
	for name, value := range params {
		form.Set(name, value)
	}
	return callInvoice(t, InvoiceEpayNotify, http.MethodPost, "/api/invoice/epay/notify", form.Encode(), 0).Body.String()
}

func startedTradeNo(t *testing.T, response map[string]any) string {
	t.Helper()
	require.Equal(t, true, response["success"], response)
	data := response["data"].(map[string]any)
	tradeNo := data["params"].(map[string]any)["out_trade_no"].(string)
	assert.Equal(t, data["invoice"].(map[string]any)["tax_trade_no"], tradeNo)
	assert.NotEmpty(t, data["url"])
	return tradeNo
}

func TestInvoiceEpayTax(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInvoiceTestDB(t, dialect)
			confirmPaymentComplianceForTest(t)
			previousAddress, previousID, previousKey := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
			t.Cleanup(func() {
				operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = previousAddress, previousID, previousKey
			})
			operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = "https://pay.example.com", "1000", "key"

			response := invoiceJSON(t, callInvoice(t, GetInvoiceConfig, http.MethodGet, "/api/invoice/config", "", 11))
			config := response["data"].(map[string]any)
			assert.Equal(t, []any{"alipay", "wxpay"}, config["pay_methods"])
			assert.EqualValues(t, 500000, config["quota_per_yuan"])

			// ¥50.50 by Stripe carries ¥2.02 of tax, asked for through epay.
			stripeOrder := orderRef(model.InvoiceOrderTopUp, invoiceOrders.stripe)
			response = submitInvoice(t, 11, `{"title_type":"personal","title":"张三","tax_no":"ignored","category":"软件开发服务","email":"me@example.com","orders":[`+stripeOrder+`],"payment_method":"wxpay"}`)
			first := startedTradeNo(t, response)
			id, ok := model.InvoiceIdFromTradeNo(first)
			require.True(t, ok)
			assert.Equal(t, "2.02", response["data"].(map[string]any)["params"].(map[string]any)["money"])
			invoice := storedInvoice(t, id)
			assert.Equal(t, model.InvoiceStatusPendingPayment, invoice.Status)
			assert.Empty(t, invoice.TaxNo)

			// A second attempt gets its own trade number; the first stays
			// payable.
			target := "/api/invoice/self/" + strconv.Itoa(id) + "/pay"
			second := startedTradeNo(t, invoiceJSON(t, callInvoice(t, PayInvoiceTax, http.MethodPost, target, `{"payment_method":"alipay"}`, 11)))
			assert.NotEqual(t, first, second)

			assert.Equal(t, "fail", notifyInvoiceTax(t, first, "wxpay", "2.02", "wrong-key"))
			assert.Equal(t, model.InvoiceStatusPendingPayment, storedInvoice(t, id).Status)

			assert.Equal(t, "success", notifyInvoiceTax(t, first, "wxpay", "2.02", "key"))
			invoice = storedInvoice(t, id)
			assert.Equal(t, model.InvoiceStatusPendingReview, invoice.Status)
			assert.Equal(t, first, invoice.TaxTradeNo)
			assert.Equal(t, "wxpay", invoice.TaxMethod)
			assert.NotZero(t, invoice.TaxPaidTime)
			assert.Equal(t, 5000000, userQuota(t, 11))

			// A repeated notification changes nothing; paying the second
			// attempt too returns ¥2.02 as $2.02 of balance.
			assert.Equal(t, "success", notifyInvoiceTax(t, first, "wxpay", "2.02", "key"))
			assert.Equal(t, 5000000, userQuota(t, 11))
			assert.Equal(t, "success", notifyInvoiceTax(t, second, "alipay", "2.02", "key"))
			assert.Equal(t, 5000000+1010000, userQuota(t, 11))
			assert.Equal(t, "success", notifyInvoiceTax(t, second, "alipay", "2.02", "key"))
			assert.Equal(t, 5000000+1010000, userQuota(t, 11))
			var payments []model.InvoiceTaxPayment
			require.NoError(t, model.DB.Order("id").Find(&payments).Error)
			require.Len(t, payments, 2)
			assert.True(t, payments[0].Applied)
			assert.False(t, payments[1].Applied)
			assert.EqualValues(t, 1010000, payments[1].CreditedQuota)

			// Cancelling an unpaid application frees its order.
			cryptoOrder := orderRef(model.InvoiceOrderTopUp, invoiceOrders.crypto)
			cancelled, _ := model.InvoiceIdFromTradeNo(startedTradeNo(t, submitInvoice(t, 11, company(cryptoOrder, "alipay"))))
			assert.NotContains(t, invoiceableKeys(t, 11), "topup:103")
			response = invoiceJSON(t, callInvoice(t, CancelSelfInvoice, http.MethodPost, "/api/invoice/self/"+strconv.Itoa(cancelled)+"/cancel", "", 11))
			require.Equal(t, true, response["success"], response)
			assert.Equal(t, model.InvoiceStatusCancelled, storedInvoice(t, cancelled).Status)
			assert.Contains(t, invoiceableKeys(t, 11), "topup:103")

			// An application unpaid past the timeout is cancelled; its tax
			// paid afterwards goes to the balance.
			expiring := startedTradeNo(t, submitInvoice(t, 11, company(cryptoOrder, "alipay")))
			expiringId, _ := model.InvoiceIdFromTradeNo(expiring)
			require.NoError(t, model.DB.Model(&model.Invoice{}).Where("id = ?", expiringId).
				Updates(map[string]any{"created_time": time.Now().Add(-31 * time.Minute).Unix(), "updated_time": time.Now().Add(-31 * time.Minute).Unix()}).Error)
			// A payment started just now restarts the clock, so a customer
			// paying near the deadline is not cancelled mid-payment.
			restarted := invoiceJSON(t, callInvoice(t, PayInvoiceTax, http.MethodPost, "/api/invoice/self/"+strconv.Itoa(expiringId)+"/pay", `{"payment_method":"alipay"}`, 11))
			require.Equal(t, true, restarted["success"], restarted)
			count, err := model.ExpireUnpaidInvoices(30, 200)
			require.NoError(t, err)
			assert.Equal(t, 0, count)
			require.NoError(t, model.DB.Model(&model.Invoice{}).Where("id = ?", expiringId).
				Update("updated_time", time.Now().Add(-31*time.Minute).Unix()).Error)
			count, err = model.ExpireUnpaidInvoices(30, 200)
			require.NoError(t, err)
			assert.Equal(t, 1, count)
			count, err = model.ExpireUnpaidInvoices(30, 200)
			require.NoError(t, err)
			assert.Equal(t, 0, count)
			assert.Equal(t, model.InvoiceStatusCancelled, storedInvoice(t, expiringId).Status)
			assert.Contains(t, invoiceableKeys(t, 11), "topup:103")
			assert.Equal(t, "success", notifyInvoiceTax(t, expiring, "alipay", "8.00", "key"))
			assert.Equal(t, 5000000+1010000+4000000, userQuota(t, 11))
		})
	}
}

func uploadInvoiceFile(t *testing.T, id int, name string, content []byte) map[string]any {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	request := httptest.NewRequest(http.MethodPost, "/api/invoice/admin/"+strconv.Itoa(id)+"/file", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return invoiceJSON(t, serveInvoice(t, UploadInvoiceFile, request, 1))
}

func TestInvoiceReview(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInvoiceTestDB(t, dialect)
			admin := func(action string, id int, body string) map[string]any {
				handler := map[string]gin.HandlerFunc{"issue": IssueInvoiceAdmin, "reject": RejectInvoiceAdmin, "delete": DeleteInvoiceAdmin}[action]
				return invoiceJSON(t, callInvoice(t, handler, http.MethodPost, "/api/invoice/admin/"+strconv.Itoa(id)+"/"+action, body, 1))
			}

			// ¥100 with ¥4.00 of tax paid from the balance.
			id := submittedId(t, submitInvoice(t, 11, company(orderRef(model.InvoiceOrderTopUp, invoiceOrders.epay), "balance")))
			assert.Equal(t, 3000000, userQuota(t, 11))

			assert.Equal(t, "Upload the invoice file before confirming it is issued", admin("issue", id, "")["message_key"])
			assert.Equal(t, "Upload a PDF, OFD, PNG or JPG file", uploadInvoiceFile(t, id, "invoice.pdf", []byte("plain text"))["message_key"])
			pdf := []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n")
			require.Equal(t, true, uploadInvoiceFile(t, id, "发票.pdf", pdf)["success"])
			fileTarget := "/api/invoice/self/" + strconv.Itoa(id) + "/file"
			assert.Equal(t, false, invoiceJSON(t, callInvoice(t, DownloadSelfInvoiceFile, http.MethodGet, fileTarget, "", 11))["success"], "not issued yet")

			response := admin("issue", id, "")
			require.Equal(t, true, response["success"], response)
			invoice := storedInvoice(t, id)
			assert.Equal(t, model.InvoiceStatusIssued, invoice.Status)
			assert.Equal(t, "发票.pdf", invoice.FileName)
			assert.Equal(t, 1, invoice.ReviewedBy)

			download := callInvoice(t, DownloadSelfInvoiceFile, http.MethodGet, fileTarget, "", 11)
			assert.Equal(t, pdf, download.Body.Bytes())
			assert.Equal(t, "application/pdf", download.Header().Get("Content-Type"))
			assert.Contains(t, download.Header().Get("Content-Disposition"), `filename="invoice-`+strconv.Itoa(id)+`.pdf"`)
			assert.Equal(t, false, invoiceJSON(t, callInvoice(t, DownloadSelfInvoiceFile, http.MethodGet, fileTarget, "", 12))["success"])

			// Rejecting returns the deducted balance exactly and frees the order.
			rejected := submittedId(t, submitInvoice(t, 11, company(orderRef(model.InvoiceOrderSubscription, invoiceOrders.plan), "balance")))
			assert.Equal(t, 3000000-200000, userQuota(t, 11))
			assert.Equal(t, "Enter a reason of at most {{max}} characters", admin("reject", rejected, `{"reason":"  "}`)["message_key"])
			response = admin("reject", rejected, `{"reason":"抬头与税号不符"}`)
			require.Equal(t, true, response["success"], response)
			assert.Equal(t, "抬头与税号不符", storedInvoice(t, rejected).RejectReason)
			assert.Equal(t, 3000000, userQuota(t, 11))
			assert.Contains(t, invoiceableKeys(t, 11), "subscription:201")
			assert.Equal(t, "The application status has changed. Refresh and try again.", admin("reject", rejected, `{"reason":"again"}`)["message_key"])

			// Administrators search by title and account.
			response = invoiceJSON(t, callInvoice(t, GetAllInvoices, http.MethodGet, "/api/invoice/admin?keyword=示例科技", "", 1))
			assert.EqualValues(t, 2, response["data"].(map[string]any)["total"])
			response = invoiceJSON(t, callInvoice(t, GetAllInvoices, http.MethodGet, "/api/invoice/admin?keyword=12", "", 1))
			assert.EqualValues(t, 0, response["data"].(map[string]any)["total"])
			response = invoiceJSON(t, callInvoice(t, GetAllInvoices, http.MethodGet, "/api/invoice/admin?status=issued", "", 1))
			assert.EqualValues(t, 1, response["data"].(map[string]any)["total"])

			// Deleting an issued application hides it, drops its file and
			// frees its order.
			response = admin("delete", id, `{"reason":"红冲后重开"}`)
			require.Equal(t, true, response["success"], response)
			response = invoiceJSON(t, callInvoice(t, GetSelfInvoices, http.MethodGet, "/api/invoice/self", "", 11))
			assert.EqualValues(t, 1, response["data"].(map[string]any)["total"])
			assert.Equal(t, "红冲后重开", storedInvoice(t, id).DeleteReason)
			var files int64
			require.NoError(t, model.DB.Model(&model.InvoiceFile{}).Count(&files).Error)
			assert.Zero(t, files)
			assert.Contains(t, invoiceableKeys(t, 11), "topup:101")
		})
	}
}

func TestInvoiceGatewayAmounts(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInvoiceTestDB(t, dialect)
			now := common.GetTimestamp()
			amounts := func() map[string]int64 {
				orders, err := model.ListInvoiceableOrders(11)
				require.NoError(t, err)
				byKey := map[string]int64{}
				for _, order := range orders {
					byKey[order.OrderType+":"+strconv.Itoa(order.OrderId)] = order.AmountCents
				}
				return byKey
			}

			// An amount ending in half a fen is invoiced as the gateway
			// request formats it: 10.125 is charged as "10.12".
			require.NoError(t, model.DB.Create(&model.TopUp{Id: 107, UserId: 11, Money: 10.125, TradeNo: "T107",
				PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess, CreateTime: now - 60}).Error)
			assert.Equal(t, int64(1012), amounts()["topup:107"])

			// A promotion code took 20% off the Stripe top-up of ¥50.50.
			require.NoError(t, model.RecordStripeInvoiceAmount("T102", "payment", 27500, 22000))
			require.NoError(t, model.RecordStripeInvoiceAmount("T102", "payment", 27500, 11000), "a repeated event")
			assert.Equal(t, int64(4040), amounts()["topup:102"])
			// A full-price payment needs no record.
			require.NoError(t, model.RecordStripeInvoiceAmount("T999", "payment", 27500, 27500))
			var overrides int64
			require.NoError(t, model.DB.Model(&model.InvoiceOrderAmount{}).Count(&overrides).Error)
			assert.Equal(t, int64(1), overrides)

			// A plan charged at its Stripe Price is not invoiceable: by the
			// plan's price id, and by the session's mode.
			require.NoError(t, model.DB.Create(&model.SubscriptionPlan{Id: 2, Title: "Pro", PriceAmount: 99, StripePriceId: "price_123"}).Error)
			require.NoError(t, model.DB.Create(&model.SubscriptionPlan{Id: 3, Title: "Max", PriceAmount: 199}).Error)
			for _, order := range []*model.SubscriptionOrder{
				{Id: 203, UserId: 11, PlanId: 2, Money: 99, TradeNo: "S203", PaymentProvider: model.PaymentProviderStripe, Status: common.TopUpStatusSuccess, CreateTime: now - 60},
				{Id: 204, UserId: 11, PlanId: 3, Money: 199, TradeNo: "S204", PaymentProvider: model.PaymentProviderStripe, Status: common.TopUpStatusSuccess, CreateTime: now - 60},
				{Id: 205, UserId: 11, PlanId: 2, Money: 99, TradeNo: "S205", PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess, CreateTime: now - 60},
			} {
				require.NoError(t, model.DB.Create(order).Error)
			}
			listed := amounts()
			assert.NotContains(t, listed, "subscription:203")
			assert.Equal(t, int64(19900), listed["subscription:204"])
			assert.Equal(t, int64(9900), listed["subscription:205"], "the same plan paid through epay")
			require.NoError(t, model.RecordStripeInvoiceAmount("S204", "subscription", 0, 2000))
			assert.NotContains(t, amounts(), "subscription:204")

			// The submission uses the gateway amount too.
			response := submitInvoice(t, 11, company(orderRef(model.InvoiceOrderTopUp, invoiceOrders.stripe), "balance"))
			id := submittedId(t, response)
			assert.Equal(t, int64(4040), storedInvoice(t, id).OrderCents)
			assert.Equal(t, int64(162), storedInvoice(t, id).TaxCents)
			rejected := submitInvoice(t, 11, company(orderRef(model.InvoiceOrderSubscription, 203), "balance"))
			assert.Equal(t, false, rejected["success"], rejected)
		})
	}
}

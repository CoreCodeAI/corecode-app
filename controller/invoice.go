package controller

import (
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/shopspring/decimal"
)

const (
	invoiceTitleLimit  = 100
	invoiceEmailLimit  = 100
	invoiceReasonLimit = 200
)

// invoiceTaxNoPattern is a unified social credit code (18 characters) or an
// older taxpayer number (15 or 20).
var invoiceTaxNoPattern = regexp.MustCompile(`^[0-9A-Z]{15,20}$`)

// invoiceEpayMethods are the epay types that take a tax payment.
var invoiceEpayMethods = []string{model.InvoiceTaxAlipay, model.InvoiceTaxWxpay}

// invoiceFileTypes are the invoice files an administrator may upload, by the
// type their content sniffs as. An OFD file is a zip archive.
var invoiceFileTypes = map[string]string{
	"application/pdf": ".pdf",
	"image/png":       ".png",
	"image/jpeg":      ".jpg",
	"application/ofd": ".ofd",
}

// invoiceEpayAvailable reports whether a tax can be paid through epay. A
// tax payment does not depend on the wallet's method list, which may route
// WeChat Pay through Stripe; small amounts are cheaper on epay.
func invoiceEpayAvailable() bool {
	return isPaymentComplianceConfirmed() && isEpayWebhookConfigured()
}

type invoiceConfigResponse struct {
	Enabled               bool     `json:"enabled"`
	TaxRate               float64  `json:"tax_rate"`
	Categories            []string `json:"categories"`
	OrderDays             int      `json:"order_days"`
	MaxOrders             int      `json:"max_orders"`
	PaymentTimeoutMinutes int      `json:"payment_timeout_minutes"`
	// PayMethods are the epay methods offered beside the balance.
	PayMethods []string `json:"pay_methods"`
	// QuotaPerYuan converts a tax to the balance it deducts.
	QuotaPerYuan float64 `json:"quota_per_yuan"`
}

// GetInvoiceConfig tells the invoice center what it may offer.
func GetInvoiceConfig(c *gin.Context) {
	setting := operation_setting.GetInvoiceSetting()
	response := invoiceConfigResponse{
		Enabled:               setting.Enabled,
		TaxRate:               setting.TaxRate,
		Categories:            setting.CategoryList(),
		OrderDays:             setting.OrderDays,
		MaxOrders:             setting.MaxOrders,
		PaymentTimeoutMinutes: setting.PaymentTimeoutMinutes,
		PayMethods:            []string{},
	}
	if invoiceEpayAvailable() {
		response.PayMethods = invoiceEpayMethods
	}
	if operation_setting.Price > 0 {
		response.QuotaPerYuan = common.QuotaPerUnit / operation_setting.Price
	}
	common.ApiSuccess(c, response)
}

// GetInvoiceOrders lists the signed-in customer's orders that can be
// invoiced.
func GetInvoiceOrders(c *gin.Context) {
	orders, err := model.ListInvoiceableOrders(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, orders)
}

// GetInvoiceSummary totals what the signed-in customer can invoice, has in
// progress, and has had issued.
func GetInvoiceSummary(c *gin.Context) {
	summary, err := model.GetInvoiceSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

// GetSelfInvoices pages the signed-in customer's applications.
func GetSelfInvoices(c *gin.Context) {
	listInvoices(c, model.InvoiceFilter{UserId: c.GetInt("id"), Status: c.Query("status")})
}

func listInvoices(c *gin.Context, filter model.InvoiceFilter) {
	pageInfo := common.GetPageQuery(c)
	invoices, total, err := model.ListInvoices(filter, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(invoices)
	common.ApiSuccess(c, pageInfo)
}

// GetSelfInvoice returns one of the signed-in customer's applications with
// its orders.
func GetSelfInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	invoice, items, err := model.GetInvoiceWithItems(c.GetInt("id"), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"invoice": invoice, "items": items})
}

func invoiceIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return 0, false
	}
	return id, true
}

type invoiceRequest struct {
	TitleType     string                  `json:"title_type"`
	Title         string                  `json:"title"`
	TaxNo         string                  `json:"tax_no"`
	Category      string                  `json:"category"`
	Email         string                  `json:"email"`
	Orders        []model.InvoiceOrderRef `json:"orders"`
	PaymentMethod string                  `json:"payment_method"`
}

// invoiceApplicationFrom checks and normalizes a submission, or returns the
// message to show.
func invoiceApplicationFrom(request invoiceRequest, setting *operation_setting.InvoiceSetting) (model.InvoiceApplication, *common.Message) {
	application := model.InvoiceApplication{
		TitleType: request.TitleType,
		Title:     strings.TrimSpace(request.Title),
		Category:  strings.TrimSpace(request.Category),
		Email:     strings.TrimSpace(request.Email),
		Orders:    request.Orders,
		TaxMethod: request.PaymentMethod,
	}
	invalid := common.NewMessage("Invalid parameters")
	switch application.TitleType {
	case model.InvoiceTitleCompany:
		application.TaxNo = strings.ToUpper(strings.TrimSpace(request.TaxNo))
		if !invoiceTaxNoPattern.MatchString(application.TaxNo) {
			return application, common.NewMessage("Enter a valid taxpayer identification number")
		}
	case model.InvoiceTitlePersonal:
	default:
		return application, invalid
	}
	if application.Title == "" || utf8.RuneCountInString(application.Title) > invoiceTitleLimit {
		return application, common.NewMessage("Enter an invoice title of at most {{max}} characters", map[string]any{"max": invoiceTitleLimit})
	}
	if !slices.Contains(setting.CategoryList(), application.Category) {
		return application, common.NewMessage("Select a product category")
	}
	if len(application.Email) > invoiceEmailLimit || common.Validate.Var(application.Email, "required,email") != nil {
		return application, common.NewMessage("Invalid email address")
	}
	if len(application.Orders) == 0 || len(application.Orders) > setting.MaxOrders {
		return application, common.NewMessage("Select between 1 and {{max}} orders", map[string]any{"max": setting.MaxOrders})
	}
	for _, order := range application.Orders {
		if (order.OrderType != model.InvoiceOrderTopUp && order.OrderType != model.InvoiceOrderSubscription) || order.OrderId <= 0 {
			return application, invalid
		}
	}
	if setting.TaxRate == 0 {
		application.TaxMethod = ""
		return application, nil
	}
	if !invoiceTaxMethodAvailable(application.TaxMethod) {
		return application, common.NewMessage("Payment method does not exist")
	}
	return application, nil
}

func invoiceTaxMethodAvailable(method string) bool {
	if method == model.InvoiceTaxBalance {
		return true
	}
	return slices.Contains(invoiceEpayMethods, method) && invoiceEpayAvailable()
}

// SubmitInvoice files the signed-in customer's application. A tax paid from
// the balance is deducted at once; an epay method answers with the payment
// form to post, as a top-up does.
func SubmitInvoice(c *gin.Context) {
	setting := operation_setting.GetInvoiceSetting()
	if !setting.Enabled {
		common.ApiError(c, model.ErrInvoiceDisabled)
		return
	}
	var request invoiceRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	application, message := invoiceApplicationFrom(request, setting)
	if message != nil {
		common.ApiError(c, message)
		return
	}
	userId := c.GetInt("id")
	result, err := model.CreateInvoice(userId, application)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	invoice := result.Invoice
	logger.LogInfo(c.Request.Context(), common.LogText("Invoice application created user_id=%d invoice_id=%d order_cents=%d tax_cents=%d tax_method=%s status=%s", userId, invoice.Id, invoice.OrderCents, invoice.TaxCents, invoice.TaxMethod, invoice.Status))
	if invoice.Status != model.InvoiceStatusPendingPayment {
		common.ApiSuccess(c, gin.H{"invoice": invoice})
		return
	}
	respondInvoiceEpay(c, userId, invoice.Id, application.TaxMethod)
}

type invoicePayRequest struct {
	PaymentMethod string `json:"payment_method"`
}

// PayInvoiceTax pays an unpaid application's tax from the balance, or
// starts an epay payment for it.
func PayInvoiceTax(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	var request invoicePayRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || !invoiceTaxMethodAvailable(request.PaymentMethod) {
		common.ApiErrorT(c, "Payment method does not exist")
		return
	}
	userId := c.GetInt("id")
	if request.PaymentMethod != model.InvoiceTaxBalance {
		respondInvoiceEpay(c, userId, id, request.PaymentMethod)
		return
	}
	result, err := model.PayInvoiceTaxFromBalance(userId, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"invoice": result.Invoice})
}

// respondInvoiceEpay starts an epay payment of an application's tax and
// answers with the form the console posts.
func respondInvoiceEpay(c *gin.Context, userId int, id int, method string) {
	client := GetEpayClient()
	if client == nil {
		common.ApiErrorT(c, "Payment information has not been configured by administrator")
		return
	}
	invoice, err := model.StartInvoiceTaxEpay(userId, id, method)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	notifyUrl, _ := url.Parse(service.GetCallbackAddress() + "/api/invoice/epay/notify")
	returnUrl, _ := url.Parse(paymentReturnPath("/invoice?pay=return"))
	uri, params, err := client.Purchase(&epay.PurchaseArgs{
		Type:           method,
		ServiceTradeNo: invoice.TaxTradeNo,
		Name:           fmt.Sprintf("INVTAX%d", invoice.Id),
		Money:          model.FormatInvoiceCents(invoice.TaxCents),
		Device:         epay.PC,
		NotifyUrl:      notifyUrl,
		ReturnUrl:      returnUrl,
	})
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Epay failed to start invoice tax payment user_id=%d invoice_id=%d trade_no=%s error=%q", userId, invoice.Id, invoice.TaxTradeNo, err.Error()))
		common.ApiErrorT(c, "Failed to start payment")
		return
	}
	logger.LogInfo(c.Request.Context(), common.LogText("Invoice tax payment started user_id=%d invoice_id=%d trade_no=%s method=%s tax_cents=%d", userId, invoice.Id, invoice.TaxTradeNo, method, invoice.TaxCents))
	common.ApiSuccess(c, gin.H{"invoice": invoice, "url": uri, "params": params})
}

// CancelSelfInvoice withdraws the signed-in customer's unpaid application.
func CancelSelfInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	if err := model.CancelInvoice(c.GetInt("id"), id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Application cancelled", nil)
}

// DownloadSelfInvoiceFile sends the signed-in customer an issued invoice.
func DownloadSelfInvoiceFile(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	invoice, data, err := model.GetInvoiceFile(c.GetInt("id"), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	writeInvoiceFile(c, invoice, data)
}

func writeInvoiceFile(c *gin.Context, invoice *model.Invoice, data []byte) {
	extension := invoiceFileTypes[invoice.FileMime]
	name := invoice.FileName
	if name == "" {
		name = fmt.Sprintf("invoice-%d%s", invoice.Id, extension)
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="invoice-%d%s"; filename*=UTF-8''%s`, invoice.Id, extension, url.PathEscape(name)))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, invoice.FileMime, data)
}

// InvoiceEpayNotify takes epay's notification of a tax payment.
func InvoiceEpayNotify(c *gin.Context) {
	fail := func() { _, _ = c.Writer.Write([]byte("fail")) }
	if !isEpayWebhookConfigured() {
		logger.LogWarn(c.Request.Context(), common.LogText("Invoice epay webhook rejected reason=webhook_disabled client_ip=%s", c.ClientIP()))
		fail()
		return
	}
	var values url.Values
	if c.Request.Method == http.MethodPost {
		if err := c.Request.ParseForm(); err != nil {
			fail()
			return
		}
		values = c.Request.PostForm
	} else {
		values = c.Request.URL.Query()
	}
	params := lo.MapValues(values, func(value []string, _ string) string {
		if len(value) == 0 {
			return ""
		}
		return value[0]
	})
	client := GetEpayClient()
	if len(params) == 0 || client == nil {
		fail()
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		logger.LogWarn(c.Request.Context(), common.LogText("Invoice epay webhook signature verification failed client_ip=%s", c.ClientIP()))
		fail()
		return
	}
	if verifyInfo.TradeStatus != epay.StatusTradeSuccess {
		logger.LogInfo(c.Request.Context(), common.LogText("Invoice epay webhook ignored event trade_no=%s trade_status=%s", verifyInfo.ServiceTradeNo, verifyInfo.TradeStatus))
		_, _ = c.Writer.Write([]byte("success"))
		return
	}
	money, err := decimal.NewFromString(verifyInfo.Money)
	if err != nil {
		logger.LogWarn(c.Request.Context(), common.LogText("Invoice epay webhook carried an unreadable amount trade_no=%s money=%q", verifyInfo.ServiceTradeNo, verifyInfo.Money))
		fail()
		return
	}
	paidCents := money.Mul(decimal.NewFromInt(100)).Round(0).IntPart()
	result, alreadyDone, err := model.CompleteInvoiceTaxEpay(verifyInfo.ServiceTradeNo, verifyInfo.Type, paidCents)
	switch {
	case err != nil:
		logger.LogError(c.Request.Context(), common.LogText("Invoice tax payment failed trade_no=%s paid_cents=%d client_ip=%s error=%q", verifyInfo.ServiceTradeNo, paidCents, c.ClientIP(), err.Error()))
		fail()
		return
	case alreadyDone:
		logger.LogInfo(c.Request.Context(), common.LogText("Invoice epay duplicate callback ignored trade_no=%s", verifyInfo.ServiceTradeNo))
	case result.Quota > 0:
		logger.LogWarn(c.Request.Context(), common.LogText("Invoice tax payment credited to balance trade_no=%s invoice_id=%d paid_cents=%d quota=%d", verifyInfo.ServiceTradeNo, result.Invoice.Id, paidCents, result.Quota))
	default:
		logger.LogInfo(c.Request.Context(), common.LogText("Invoice tax paid trade_no=%s invoice_id=%d paid_cents=%d", verifyInfo.ServiceTradeNo, result.Invoice.Id, paidCents))
	}
	_, _ = c.Writer.Write([]byte("success"))
}

// GetAllInvoices pages every account's applications for administrators.
func GetAllInvoices(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Query("user_id"))
	listInvoices(c, model.InvoiceFilter{
		UserId:  userId,
		Status:  c.Query("status"),
		Keyword: c.Query("keyword"),
	})
}

// GetInvoiceReviewCount counts the applications waiting for an
// administrator.
func GetInvoiceReviewCount(c *gin.Context) {
	count, err := model.CountInvoicesAwaitingReview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}

// GetInvoiceAdmin returns an application with its orders and its account.
func GetInvoiceAdmin(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	invoice, items, err := model.GetInvoiceWithItems(0, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	account := gin.H{"id": invoice.UserId}
	if user, err := model.GetUserById(invoice.UserId, false); err == nil {
		account["username"] = user.Username
		account["email"] = user.Email
	}
	common.ApiSuccess(c, gin.H{"invoice": invoice, "items": items, "user": account})
}

// UploadInvoiceFile stores the issued invoice's file for an application.
func UploadInvoiceFile(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	maxBytes := int64(operation_setting.GetInvoiceSetting().FileMaxKB) * 1024
	tooLarge := common.NewMessage("The invoice file can be at most {{max}} KB", map[string]any{"max": operation_setting.GetInvoiceSetting().FileMaxKB})
	// The multipart envelope adds a little around the file.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes+64*1024)
	header, err := c.FormFile("file")
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			common.ApiError(c, tooLarge)
			return
		}
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if header.Size > maxBytes {
		common.ApiError(c, tooLarge)
		return
	}
	file, err := header.Open()
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || len(data) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if int64(len(data)) > maxBytes {
		common.ApiError(c, tooLarge)
		return
	}
	name := strings.TrimSpace(filepath.Base(strings.ReplaceAll(header.Filename, `\`, "/")))
	mime := http.DetectContentType(data)
	if mime == "application/zip" && strings.EqualFold(filepath.Ext(name), ".ofd") {
		mime = "application/ofd"
	}
	extension, allowed := invoiceFileTypes[mime]
	if !allowed {
		common.ApiErrorT(c, "Upload a PDF, OFD, PNG or JPG file")
		return
	}
	if name == "" || name == "." || name == "/" || utf8.RuneCountInString(name) > 120 {
		name = fmt.Sprintf("invoice-%d%s", id, extension)
	}
	if err := model.SaveInvoiceFile(id, name, mime, data); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Invoice file uploaded", nil)
}

// DownloadInvoiceFileAdmin sends an administrator an application's file.
func DownloadInvoiceFileAdmin(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	invoice, data, err := model.GetInvoiceFile(0, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	writeInvoiceFile(c, invoice, data)
}

// IssueInvoiceAdmin marks an application issued and emails its invoice
// address.
func IssueInvoiceAdmin(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	invoice, err := model.IssueInvoice(id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sendInvoiceEmail(invoice, false)
	common.ApiSuccess(c, invoice)
}

type invoiceReasonRequest struct {
	Reason string `json:"reason"`
}

func invoiceReason(c *gin.Context) (string, bool) {
	var request invoiceReasonRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return "", false
	}
	reason := strings.TrimSpace(request.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > invoiceReasonLimit {
		common.ApiErrorT(c, "Enter a reason of at most {{max}} characters", map[string]any{"max": invoiceReasonLimit})
		return "", false
	}
	return reason, true
}

// RejectInvoiceAdmin refuses an application, returns its paid tax to the
// balance, and emails its invoice address.
func RejectInvoiceAdmin(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	reason, ok := invoiceReason(c)
	if !ok {
		return
	}
	result, err := model.RejectInvoice(id, c.GetInt("id"), reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sendInvoiceEmail(result.Invoice, result.Quota > 0)
	common.ApiSuccess(c, result.Invoice)
}

// DeleteInvoiceAdmin removes a finished application from both lists.
func DeleteInvoiceAdmin(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	reason, ok := invoiceReason(c)
	if !ok {
		return
	}
	adminId := c.GetInt("id")
	if err := model.DeleteInvoice(id, adminId, reason); err != nil {
		common.ApiError(c, err)
		return
	}
	logger.LogInfo(c.Request.Context(), common.LogText("Invoice application deleted invoice_id=%d admin_id=%d reason=%q", id, adminId, reason))
	common.ApiSuccessT(c, "Invoice application deleted", nil)
}

// sendInvoiceEmail tells the invoice address that an application was issued
// or rejected, in the account's saved language, in the background. A rejected
// application with taxReturned also says the tax went back to the balance.
func sendInvoiceEmail(invoice *model.Invoice, taxReturned bool) {
	language := ""
	if user, err := model.GetUserById(invoice.UserId, false); err == nil {
		language = user.GetSetting().Language
	}
	params := map[string]any{
		"SystemName": common.SystemName,
		"Id":         invoice.Id,
		"Title":      html.EscapeString(invoice.Title),
		"Amount":     model.FormatInvoiceCents(invoice.OrderCents),
		"Reason":     html.EscapeString(invoice.RejectReason),
		"Link":       strings.TrimRight(system_setting.ServerAddress, "/") + "/invoice",
	}
	subjectKey, bodyKey := i18n.MsgEmailInvoiceIssuedSubject, i18n.MsgEmailInvoiceIssuedBody
	if invoice.Status == model.InvoiceStatusRejected {
		subjectKey, bodyKey = i18n.MsgEmailInvoiceRejectedSubject, i18n.MsgEmailInvoiceRejectedBody
	}
	subject := i18n.Translate(language, subjectKey, params)
	content := "<p>" + i18n.Translate(language, bodyKey, params) + "</p>"
	if taxReturned {
		content += "<p>" + i18n.Translate(language, i18n.MsgEmailInvoiceTaxReturned, params) + "</p>"
	}
	content += "<p>" + i18n.Translate(language, i18n.MsgEmailInvoiceCenterLink, params) + "</p>"
	recipient := invoice.Email
	gopool.Go(func() {
		if err := common.SendEmail(subject, recipient, content); err != nil {
			common.SysError(common.LogText("failed to send invoice email invoice_id=%d error=%q", invoice.Id, err.Error()))
		}
	})
}

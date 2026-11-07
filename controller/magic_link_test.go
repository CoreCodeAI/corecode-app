package controller

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// magicLinkTestEmail signs in through the emailed link, never through a password.
const magicLinkTestEmail = "magic-link-customer@example.com"

// startMagicLinkSMTPServer captures outbound mail over a plain localhost SMTP
// session so the send endpoint exercises the real delivery path.
func startMagicLinkSMTPServer(t *testing.T) chan string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })

	messages := make(chan string, 16)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer func() { _ = conn.Close() }()
				writer := bufio.NewWriter(conn)
				scanner := bufio.NewScanner(conn)
				_, _ = writer.WriteString("220 localhost\r\n")
				_ = writer.Flush()
				var body strings.Builder
				inData := false
				for scanner.Scan() {
					line := scanner.Text()
					if inData {
						if line == "." {
							inData = false
							messages <- body.String()
							body.Reset()
							_, _ = writer.WriteString("250 OK\r\n")
							_ = writer.Flush()
							continue
						}
						body.WriteString(line + "\n")
						continue
					}
					switch upper := strings.ToUpper(line); {
					case strings.HasPrefix(upper, "DATA"):
						inData = true
						_, _ = writer.WriteString("354 End data\r\n")
					case strings.HasPrefix(upper, "QUIT"):
						_, _ = writer.WriteString("221 Bye\r\n")
					default:
						_, _ = writer.WriteString("250 OK\r\n")
					}
					_ = writer.Flush()
				}
			}(conn)
		}
	}()

	_, portText, err := net.SplitHostPort(listener.Addr().String())
	require.NoError(t, err)
	var port int
	_, err = fmt.Sscanf(portText, "%d", &port)
	require.NoError(t, err)

	previousServer, previousPort := common.SMTPServer, common.SMTPPort
	previousAccount, previousToken, previousFrom := common.SMTPAccount, common.SMTPToken, common.SMTPFrom
	previousSSL, previousStartTLS := common.SMTPSSLEnabled, common.SMTPStartTLSEnabled

	common.SMTPServer = "127.0.0.1"
	common.SMTPPort = port
	common.SMTPAccount = ""
	common.SMTPToken = ""
	common.SMTPFrom = "magic-link@example.com"
	common.SMTPSSLEnabled = false
	common.SMTPStartTLSEnabled = false
	t.Cleanup(func() {
		common.SMTPServer, common.SMTPPort = previousServer, previousPort
		common.SMTPAccount, common.SMTPToken, common.SMTPFrom = previousAccount, previousToken, previousFrom
		common.SMTPSSLEnabled, common.SMTPStartTLSEnabled = previousSSL, previousStartTLS
	})
	return messages
}

// setupMagicLinkTest reuses the shared enrollment fixture and pins the switches
// the magic-link endpoints read.
func setupMagicLinkTest(t *testing.T) chan string {
	t.Helper()
	_, _ = setupSecurityEnrollmentTest(t)
	previousLogin, previousRegister, previousMagic := common.PasswordLoginEnabled, common.RegisterEnabled, common.MagicLinkRegisterEnabled
	common.PasswordLoginEnabled = true
	common.RegisterEnabled = true
	common.MagicLinkRegisterEnabled = true
	t.Cleanup(func() {
		common.PasswordLoginEnabled = previousLogin
		common.RegisterEnabled = previousRegister
		common.MagicLinkRegisterEnabled = previousMagic
	})
	serverAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://corecode.live"
	t.Cleanup(func() { system_setting.ServerAddress = serverAddress })
	return startMagicLinkSMTPServer(t)
}

func magicLinkPost(t *testing.T, path, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.RemoteAddr = "203.0.113.7:55555"
	handler(c)
	return recorder
}

func decodeMagicLinkResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	return payload
}

func extractMagicLinkToken(t *testing.T, message string) string {
	t.Helper()
	marker := "/email-login?token="
	start := strings.Index(message, marker)
	require.Greater(t, start, -1, "sign-in link missing from email: %s", message)
	rest := message[start+len(marker):]
	end := strings.IndexAny(rest, "'\"<")
	require.Greater(t, end, 0)
	return rest[:end]
}

// firstMagicLinkHref reads the sign-in anchor out of the delivered HTML body.
func firstMagicLinkHref(t *testing.T, message string) string {
	t.Helper()
	marker := "href='"
	start := strings.Index(message, marker)
	require.Greater(t, start, -1, "no link anchor in email: %s", message)
	rest := message[start+len(marker):]
	end := strings.Index(rest, "'")
	require.Greater(t, end, 0)
	return rest[:end]
}

func TestMagicLinkSignsInAndRegistersUnknownAddress(t *testing.T) {
	messages := setupMagicLinkTest(t)

	sent := magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink)
	require.Equal(t, http.StatusOK, sent.Code)
	assert.Equal(t, true, decodeMagicLinkResponse(t, sent)["success"])

	var raw string
	select {
	case raw = <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("no sign-in email was delivered")
	}
	token := extractMagicLinkToken(t, raw)
	assert.Len(t, token, 43, "a 32-byte token is 43 base64url characters")

	recorder := magicLinkPost(t, "/api/magic_link/login", `{"token":"`+token+`"}`, LoginWithMagicLink)
	require.Equal(t, http.StatusOK, recorder.Code)
	payload := decodeMagicLinkResponse(t, recorder)
	require.Equal(t, true, payload["success"], payload["message"])

	data, ok := payload["data"].(map[string]any)
	require.True(t, ok)
	require.True(t, serviceIsAuthBundle(data), "expected a session bundle, got %v", data)

	user, err := model.GetUniqueUserByEmail(magicLinkTestEmail)
	require.NoError(t, err)
	assert.Equal(t, common.RoleCommonUser, user.Role)
	assert.Equal(t, common.UserStatusEnabled, user.Status)
	assert.Empty(t, user.Password, "an emailed link must not create a password")
	assert.Equal(t, magicLinkTestEmail, user.DisplayName)
	// The console's user editor and profile form validate the whole record,
	// so an account the link created must pass the same check to be saved.
	assert.NoError(t, common.Validate.StructExcept(user, "Password"))

	// Consumption returns the same session path as any other login, so the
	// console can reuse its bundle handling unchanged.
	_, err = service.ParseAccessToken(data["access_token"].(string))
	require.NoError(t, err)
}

// The emailed link is the only sign-up path in production, so the invite
// code the customer arrived with has to survive the round trip through the
// mailbox and bind the inviter when the link creates the account.
func TestMagicLinkSignUpBindsTheInviterFromItsCode(t *testing.T) {
	messages := setupMagicLinkTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Affiliate{}, &model.AffiliateReferral{}))
	affiliateSetting := operation_setting.GetAffiliateSetting()
	previousEnabled := affiliateSetting.Enabled
	affiliateSetting.Enabled = true
	t.Cleanup(func() { affiliateSetting.Enabled = previousEnabled })

	inviter := &model.User{Username: "magic_inviter", DisplayName: "magic_inviter", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, inviter.Insert(0))
	require.NoError(t, model.DB.First(inviter, inviter.Id).Error)
	_, err := model.SetAffiliate(inviter.Id, 10, "", 1)
	require.NoError(t, err)

	sent := magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`","aff":"`+inviter.AffCode+`"}`, SendMagicLink)
	require.Equal(t, http.StatusOK, sent.Code)
	var raw string
	select {
	case raw = <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("no sign-in email was delivered")
	}
	recorder := magicLinkPost(t, "/api/magic_link/login", `{"token":"`+extractMagicLinkToken(t, raw)+`"}`, LoginWithMagicLink)
	require.Equal(t, true, decodeMagicLinkResponse(t, recorder)["success"])

	user, err := model.GetUniqueUserByEmail(magicLinkTestEmail)
	require.NoError(t, err)
	assert.Equal(t, inviter.Id, user.InviterId)
	var referrals int64
	require.NoError(t, model.DB.Model(&model.AffiliateReferral{}).Where("user_id = ?", user.Id).Count(&referrals).Error)
	assert.EqualValues(t, 1, referrals, "the new invitee starts counting toward commission at once")
}

// A retail channel's invitee who signs up through the emailed link is bound
// to the channel but receives no gift plan: only OAuth sign-ups do, since a
// farm can buy email addresses far more cheaply. The row records why.
func TestMagicLinkSignUpWithholdsTheChannelGiftPlan(t *testing.T) {
	messages := setupMagicLinkTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Affiliate{}, &model.AffiliateReferral{}, &model.AffiliateSignupGift{},
		&model.SubscriptionPlan{}, &model.UserSubscription{}))
	affiliateSetting := operation_setting.GetAffiliateSetting()
	previousSetting := *affiliateSetting
	t.Cleanup(func() { *affiliateSetting = previousSetting })
	affiliateSetting.Enabled = true

	plan := &model.SubscriptionPlan{Title: "retail trial", DurationUnit: model.SubscriptionDurationDay, DurationValue: 7, Enabled: true}
	require.NoError(t, model.DB.Create(plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	affiliateSetting.RetailGiftPlanId = plan.Id

	inviter := &model.User{Username: "magic_channel", DisplayName: "magic_channel", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, inviter.Insert(0))
	require.NoError(t, model.DB.First(inviter, inviter.Id).Error)
	_, err := model.SetAffiliate(inviter.Id, 30, model.AffiliateTierRetail, 1)
	require.NoError(t, err)

	sent := magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`","aff":"`+inviter.AffCode+`"}`, SendMagicLink)
	require.Equal(t, http.StatusOK, sent.Code)
	var raw string
	select {
	case raw = <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("no sign-in email was delivered")
	}
	recorder := magicLinkPost(t, "/api/magic_link/login", `{"token":"`+extractMagicLinkToken(t, raw)+`"}`, LoginWithMagicLink)
	require.Equal(t, true, decodeMagicLinkResponse(t, recorder)["success"])

	user, err := model.GetUniqueUserByEmail(magicLinkTestEmail)
	require.NoError(t, err)
	assert.Equal(t, inviter.Id, user.InviterId)
	var subscriptions int64
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Count(&subscriptions).Error)
	assert.Zero(t, subscriptions)
	var gift model.AffiliateSignupGift
	require.NoError(t, model.DB.Where("user_id = ?", user.Id).First(&gift).Error)
	assert.Equal(t, model.AffiliateSignupGiftEmailSignup, gift.Status)
}

// Two mailboxes can share a local part. The link is spent before the account
// is inserted, so a username collision used to leave the second customer on an
// "invalid or expired" page with no way to retry.
func TestMagicLinkSignUpSurvivesATakenMailboxName(t *testing.T) {
	messages := setupMagicLinkTest(t)
	localPart, _, _ := strings.Cut(magicLinkTestEmail, "@")
	existing := &model.User{Username: localPart, DisplayName: localPart, Email: localPart + "@example.org", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, existing.Insert(0))

	sent := magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink)
	require.Equal(t, http.StatusOK, sent.Code)
	var raw string
	select {
	case raw = <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("no sign-in email was delivered")
	}
	recorder := magicLinkPost(t, "/api/magic_link/login", `{"token":"`+extractMagicLinkToken(t, raw)+`"}`, LoginWithMagicLink)
	payload := decodeMagicLinkResponse(t, recorder)
	require.Equal(t, true, payload["success"], payload["message"])

	user, err := model.GetUniqueUserByEmail(magicLinkTestEmail)
	require.NoError(t, err)
	assert.NotEqual(t, existing.Id, user.Id)
	assert.NotEqual(t, localPart, user.Username)
	assert.LessOrEqual(t, len(user.Username), model.UserNameMaxLength)
	assert.True(t, strings.HasPrefix(user.Username, localPart[:model.UserNameMaxLength-5]+"_"), user.Username)
}

func serviceIsAuthBundle(data map[string]any) bool {
	_, hasToken := data["access_token"]
	_, hasUser := data["user"]
	_, hasSession := data["session"]
	return hasToken && hasUser && hasSession
}

// The mailed link goes to the mailbox owner, so their saved language must win
// over the request language of whoever pressed the button. SendMagicLink is an
// anonymous route, so nothing else loads the recipient's setting.
func TestMagicLinkMailFollowsTheRecipientsSavedLanguage(t *testing.T) {
	messages := setupMagicLinkTest(t)

	user := &model.User{
		Username: "magic-link-foreign", Email: magicLinkTestEmail,
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	user.SetSetting(dto.UserSetting{Language: "zh-CN"})
	require.NoError(t, user.Insert(0))

	recorder := magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, <-messages, "登录链接")
}

func TestMagicLinkIsSingleUseAndSuperseded(t *testing.T) {
	messages := setupMagicLinkTest(t)

	require.Equal(t, http.StatusOK, magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink).Code)
	first := extractMagicLinkToken(t, <-messages)

	// The resend interval bounds a second send, so clear it before asking again.
	firstTime := time.Now()
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).
		Where("purpose = ?", model.MagicLinkPurpose).
		Update("created_at", firstTime.Add(-2*time.Minute)).Error)

	require.Equal(t, http.StatusOK, magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink).Code)
	second := extractMagicLinkToken(t, <-messages)
	assert.NotEqual(t, first, second)

	// A newer link retires the older one: one mailbox holds one live link.
	replay := magicLinkPost(t, "/api/magic_link/login", `{"token":"`+first+`"}`, LoginWithMagicLink)
	assert.Equal(t, true, decodeMagicLinkResponse(t, replay)["success"] == false)
	assert.Equal(t, "Sign-in link is invalid or has expired, please request a new one", decodeMagicLinkResponse(t, replay)["message"])

	require.Equal(t, http.StatusOK, magicLinkPost(t, "/api/magic_link/login", `{"token":"`+second+`"}`, LoginWithMagicLink).Code)

	// The consumed link cannot be replayed.
	repeat := magicLinkPost(t, "/api/magic_link/login", `{"token":"`+second+`"}`, LoginWithMagicLink)
	assert.Equal(t, false, decodeMagicLinkResponse(t, repeat)["success"])
}

func TestMagicLinkRejectsExpiredAndUnknownTokens(t *testing.T) {
	setupMagicLinkTest(t)

	require.Equal(t, http.StatusOK, magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink).Code)

	require.NoError(t, model.DB.Model(&model.AuthFlow{}).
		Where("purpose = ?", model.MagicLinkPurpose).
		Update("expires_at", time.Now().Add(-time.Minute)).Error)

	expired := magicLinkPost(t, "/api/magic_link/login", `{"token":"unused"}`, LoginWithMagicLink)
	assert.Equal(t, false, decodeMagicLinkResponse(t, expired)["success"])
}

func TestMagicLinkResendIsThrottledPerMailbox(t *testing.T) {
	setupMagicLinkTest(t)

	require.Equal(t, http.StatusOK, magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink).Code)
	throttled := magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink)
	require.Equal(t, http.StatusTooManyRequests, throttled.Code)
	assert.Contains(t, throttled.Body.String(), "seconds")
}

func TestMagicLinkUnknownAddressIsSilentWhenRegistrationClosed(t *testing.T) {
	messages := setupMagicLinkTest(t)
	common.RegisterEnabled = false

	recorder := magicLinkPost(t, "/api/magic_link/send", `{"email":"nobody-here@example.com"}`, SendMagicLink)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, true, decodeMagicLinkResponse(t, recorder)["success"])

	select {
	case raw := <-messages:
		t.Fatalf("unregistered address received mail: %s", raw)
	case <-time.After(200 * time.Millisecond):
	}

	// A registered address still gets its link under the same switch: only new
	// accounts are blocked.
	registered := &model.User{
		Username: "magic-link-existing", Email: magicLinkTestEmail,
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, registered.Insert(0))
	existing := magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink)
	require.Equal(t, http.StatusOK, existing.Code)
	select {
	case <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("registered address received no link")
	}
}

func TestMagicLinkConsumeDoesNotConfirmRegistration(t *testing.T) {
	setupMagicLinkTest(t)
	require.Equal(t, http.StatusOK, magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`"}`, SendMagicLink).Code)

	common.RegisterEnabled = false
	token := "whatever"

	recorder := magicLinkPost(t, "/api/magic_link/login", `{"token":"`+token+`"}`, LoginWithMagicLink)
	payload := decodeMagicLinkResponse(t, recorder)
	assert.Equal(t, false, payload["success"])
	assert.Equal(t, "Sign-in link is invalid or has expired, please request a new one", payload["message"])
}

func TestSafeMagicLinkRedirect(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{name: "in-app path", input: "/pricing?view=grid", expected: "/pricing?view=grid"},
		{name: "empty", input: "", expected: ""},
		{name: "whitespace only", input: "   ", expected: ""},
		{name: "absolute URL", input: "https://evil.test/x", expected: ""},
		{name: "protocol relative", input: "//evil.test/x", expected: ""},
		{name: "backslash host", input: "/\\evil.test", expected: ""},
		{name: "newline", input: "/ok\nHost: evil", expected: ""},
		{name: "oversized", input: "/" + strings.Repeat("a", 300), expected: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, model.SafeMagicLinkRedirect(tc.input))
		})
	}
}

func TestPasswordLoginStaysAvailableForRootWhenDisabled(t *testing.T) {
	setupMagicLinkTest(t)

	root := &model.User{
		Username: "magic-link-root", Role: common.RoleRootUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, root.Insert(0))
	rawPassword := "root-password-for-magic-link-test"
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", root.Id).
		Update("password", mustHashPassword(t, rawPassword)).Error)
	require.NoError(t, model.PublishUserAuthCache(root.Id))

	customer := &model.User{
		Username: "magic-link-customer", Email: magicLinkTestEmail,
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, customer.Insert(0))
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", customer.Id).
		Update("password", mustHashPassword(t, rawPassword)).Error)
	require.NoError(t, model.PublishUserAuthCache(customer.Id))

	common.PasswordLoginEnabled = false

	rootLogin := magicLinkPost(t, "/api/user/login", `{"username":"magic-link-root","password":"`+rawPassword+`"}`, Login)
	assert.Equal(t, true, decodeMagicLinkResponse(t, rootLogin)["success"],
		"root must keep a password path for the deployment relay and email outages")

	customerLogin := magicLinkPost(t, "/api/user/login", `{"username":"magic-link-customer","password":"`+rawPassword+`"}`, Login)
	payload := decodeMagicLinkResponse(t, customerLogin)
	assert.Equal(t, false, payload["success"])
	assert.Equal(t, "Password login has been disabled by administrator", payload["message"])
}

func mustHashPassword(t *testing.T, password string) string {
	t.Helper()
	hashed, err := common.HashAccountPassword(password)
	require.NoError(t, err)
	return hashed
}

func TestSendMagicLinkRejectsInvalidEmail(t *testing.T) {
	setupMagicLinkTest(t)

	recorder := magicLinkPost(t, "/api/magic_link/send", `{"email":"not-an-email"}`, SendMagicLink)
	assert.Equal(t, false, decodeMagicLinkResponse(t, recorder)["success"])
}

func TestMagicLinkURLCarriesTokenWithoutAccountIdentifier(t *testing.T) {
	messages := setupMagicLinkTest(t)

	require.Equal(t, http.StatusOK, magicLinkPost(t, "/api/magic_link/send", `{"email":"`+magicLinkTestEmail+`","redirect":"/pricing"}`, SendMagicLink).Code)
	raw := <-messages
	link := firstMagicLinkHref(t, raw)
	assert.True(t, strings.HasPrefix(link, "https://corecode.live/email-login?token="), link)

	parsed, err := url.Parse(link)
	require.NoError(t, err)
	assert.Equal(t, "/email-login", parsed.Path)
	assert.Len(t, parsed.Query().Get("token"), 43)
	assert.Equal(t, "/pricing", parsed.Query().Get("redirect"))
	assert.NotContains(t, parsed.RawQuery, magicLinkTestEmail, "the link URL must not carry the mailbox")
	assert.NotContains(t, parsed.Query(), "email", "the link URL carries only the token and redirect")
}

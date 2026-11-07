package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

type magicLinkRequest struct {
	Email    string `json:"email"`
	Token    string `json:"token"`
	Code     string `json:"code"`
	Redirect string `json:"redirect"`
	Aff      string `json:"aff"`
}

func magicLinkSendEnabled() bool {
	return common.MagicLinkLoginEnabled
}

func magicLinkRegisterAllowed() bool {
	return common.RegisterEnabled && common.MagicLinkRegisterEnabled
}

// checkMagicLinkThrottle rejects send bursts aimed at one mailbox or issued from
// one client address. auth_flows rows are the durable counter, so a restart or a
// second instance cannot hand a throttled caller a fresh budget.
func checkMagicLinkThrottle(c *gin.Context, email string) bool {
	lastSent, err := model.MagicLinkLastSentAt(email)
	if err != nil {
		common.SysError(common.LogText("magic link throttle lookup failed: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return false
	}
	if wait := magicLinkResendWait(lastSent); wait > 0 {
		common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Please wait {{seconds}} seconds before requesting another link.", map[string]any{"seconds": int64((wait + time.Second - 1) / time.Second)}))
		return false
	}
	recentForEmail, recentForIP, err := magicLinkRecentCounts(email, c.ClientIP())
	if err != nil {
		common.SysError(common.LogText("magic link throttle lookup failed: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return false
	}
	if recentForEmail >= model.MagicLinkMaxPerEmail || recentForIP >= model.MagicLinkMaxPerIP {
		common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Too many sign-in links requested, please try again later."))
		return false
	}
	return true
}

func magicLinkRecentCounts(email, clientIP string) (int64, int64, error) {
	recentForEmail, err := model.CountMagicLinksSince(time.Now().Add(-model.MagicLinkWindow), email, "")
	if err != nil {
		return 0, 0, err
	}
	recentForIP, err := model.CountMagicLinksSince(time.Now().Add(-model.MagicLinkWindow), "", clientIP)
	if err != nil {
		return 0, recentForIP, err
	}
	return recentForEmail, recentForIP, nil
}

func magicLinkResendWait(lastSent time.Time) time.Duration {
	if lastSent.IsZero() {
		return 0
	}
	wait := model.MagicLinkSendInterval - time.Since(lastSent)
	if wait < 0 {
		return 0
	}
	return wait
}

// SendMagicLink emails a single-use sign-in link. The response is the same
// whether or not the address has an account, so requesting a link does not
// confirm who registered unless registration is closed.
func SendMagicLink(c *gin.Context) {
	if !magicLinkSendEnabled() {
		common.ApiErrorT(c, "Email link sign-in has been disabled by administrator")
		return
	}
	var req magicLinkRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	email, err := service.ValidateAccountEmail(req.Email)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if !checkMagicLinkThrottle(c, email) {
		return
	}
	user, lookupErr := model.GetUniqueUserByEmail(email)
	if lookupErr != nil && !errors.Is(lookupErr, model.ErrEmailNotFound) && !errors.Is(lookupErr, model.ErrEmailAmbiguous) {
		common.SysLog(common.LogText("magic link account lookup failed: %v", lookupErr))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	if user == nil && !magicLinkRegisterAllowed() {
		// Registration closed and no account: answer exactly as if a link were on
		// its way, the same non-enumerating behavior as password reset.
		common.SysLog(common.LogText("magic link requested for unregistered address, sending nothing"))
		c.JSON(http.StatusOK, gin.H{
			"success":      true,
			"message":      "",
			"resend_after": int64(model.MagicLinkSendInterval.Seconds()),
		})
		return
	}
	token, code, expiresAt, err := model.CreateMagicLink(email, c.ClientIP(), req.Aff)
	if err != nil {
		common.SysError(common.LogText("failed to create magic link: %v", err))
		common.ApiErrorT(c, "Failed to send sign-in email, please contact the administrator")
		return
	}
	lang := i18n.StatedLang(c)
	if user != nil {
		// The recipient owns the mailbox, so their saved language wins over the
		// request language of whoever pressed the button.
		if saved := user.GetSetting().Language; saved != "" {
			lang = saved
		}
	}
	link := strings.TrimSuffix(system_setting.ServerAddress, "/") + "/email-login?token=" + url.QueryEscape(token)
	if redirect := model.SafeMagicLinkRedirect(req.Redirect); redirect != "" {
		link += "&redirect=" + url.QueryEscape(redirect)
	}
	systemName := map[string]any{"SystemName": common.SystemName}
	subject := i18n.Translate(lang, i18n.MsgEmailMagicLinkSubject, systemName)
	content := fmt.Sprintf("<p>%s</p>"+
		"<p>%s</p>"+
		"<p style=\"font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,Menlo,Consolas,monospace\">%s</p>"+
		"<p>%s</p>"+
		"<p>%s </p>"+
		"<p>%s</p>",
		i18n.Translate(lang, i18n.MsgEmailMagicLinkGreeting, systemName),
		i18n.Translate(lang, i18n.MsgEmailMagicLinkCode),
		code,
		i18n.Translate(lang, i18n.MsgEmailMagicLinkLink, map[string]any{"Link": link}),
		i18n.Translate(lang, i18n.MsgEmailMagicLinkLinkFallback, map[string]any{"Link": link}),
		i18n.Translate(lang, i18n.MsgEmailMagicLinkValidity, map[string]any{"Minutes": int(time.Until(expiresAt).Round(time.Minute) / time.Minute)}))
	if err := common.SendEmail(subject, email, content); err != nil {
		common.SysLog(common.LogText("failed to send magic link email: %v", err))
		common.ApiErrorT(c, "Failed to send sign-in email, please contact the administrator")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"message":      "",
		"expires_at":   expiresAt.Unix(),
		"resend_after": int64(model.MagicLinkSendInterval.Seconds()),
	})
}

// LoginWithMagicLink consumes one sign-in link and issues the browser session.
// An unregistered address creates the account when registration is enabled.
// Rejected, expired, replayed, and unknown-address links all share one message.
func LoginWithMagicLink(c *gin.Context) {
	if !magicLinkSendEnabled() {
		common.ApiErrorT(c, "Email link sign-in has been disabled by administrator")
		return
	}
	var req magicLinkRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	state, err := model.ConsumeMagicLink(req.Token)
	if err != nil {
		writeMagicLinkError(c, err)
		return
	}
	signInMagicLinkAddress(c, state)
}

// LoginWithMagicLinkCode signs in with the code mailed beside the link, for a
// customer reading mail on another device. It spends the same link, so the code
// and the URL are one credential. Wrong, expired, and spent codes and unknown
// addresses share one message.
func LoginWithMagicLinkCode(c *gin.Context) {
	if !magicLinkSendEnabled() {
		common.ApiErrorT(c, "Email link sign-in has been disabled by administrator")
		return
	}
	var req magicLinkRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	state, err := model.ConsumeMagicLinkCode(req.Email, req.Code)
	if errors.Is(err, model.ErrAuthFlowInvalid) {
		common.ApiErrorT(c, "Code is incorrect or has expired")
		return
	}
	if err != nil {
		writeMagicLinkError(c, err)
		return
	}
	signInMagicLinkAddress(c, state)
}

// signInMagicLinkAddress issues the session for an address whose mailbox was
// just proven, registering it when registration is open.
func signInMagicLinkAddress(c *gin.Context, state model.MagicLinkState) {
	c.Set("login_method", "magic_link")
	user, err := model.GetUniqueUserByEmail(state.Email)
	if errors.Is(err, model.ErrEmailNotFound) {
		user, err = registerMagicLinkUser(c, state.Email, state.Aff)
	}
	if err != nil {
		writeMagicLinkError(c, err)
		return
	}
	setupLogin(user, nil, c)
}

func registerMagicLinkUser(c *gin.Context, email string, aff string) (*model.User, error) {
	if !magicLinkRegisterAllowed() {
		return nil, model.ErrMagicLinkRegistrationDisabled
	}
	username, err := availableMagicLinkUsername(email)
	if err != nil {
		return nil, err
	}
	cleanUser := model.User{
		Username:    username,
		DisplayName: email,
		Email:       email,
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
	}
	inviterId := model.InviterIdForAffCode(aff)
	if err := cleanUser.Insert(inviterId); err != nil {
		return nil, err
	}
	giveAffiliateSignupGift(c, cleanUser.Id, inviterId, false)
	if err := issueDefaultAPIToken(c, &cleanUser); err != nil {
		common.SysLog(common.LogText("failed to create default token for magic link user: %v", err))
		return nil, model.ErrDatabase
	}
	return model.GetSelfUserById(cleanUser.Id)
}

// magicLinkUsername derives the account name from the address. The stored name
// stays within the console's 20-character display limit while the mailbox remains
// the identity that the link resolves.
func magicLinkUsername(email string) string {
	name := email
	if at := strings.IndexByte(name, '@'); at > 0 {
		name = name[:at]
	}
	if len(name) > model.UserNameMaxLength {
		name = name[:model.UserNameMaxLength]
	}
	return name
}

// magicLinkUsernameAttempts bounds the suffixed names tried after the mailbox
// name is taken; four random characters make a repeat collision unlikely.
const magicLinkUsernameAttempts = 5

// availableMagicLinkUsername keeps the mailbox name when it is free and
// otherwise appends a random suffix. Two addresses can share a local part
// (a@gmail.com, a@qq.com), and the link is already spent when the insert runs,
// so a taken name would strand the customer on an "invalid link" page. Deleted
// accounts still hold their name in the unique index, so they count as taken.
func availableMagicLinkUsername(email string) (string, error) {
	base := magicLinkUsername(email)
	candidate := base
	for range magicLinkUsernameAttempts {
		taken, err := model.CheckUserExistOrDeleted(candidate, "")
		if err != nil {
			return "", model.ErrDatabase
		}
		if !taken {
			return candidate, nil
		}
		const suffixLen = 5 // "_" and four characters
		prefix := base
		if len(prefix) > model.UserNameMaxLength-suffixLen {
			prefix = prefix[:model.UserNameMaxLength-suffixLen]
		}
		candidate = prefix + "_" + common.GetRandomString(suffixLen-1)
	}
	return "", model.ErrDatabase
}

func writeMagicLinkError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrMagicLinkRegistrationDisabled):
		common.ApiErrorT(c, "New user registration has been disabled by administrator")
	case errors.Is(err, model.ErrDatabase):
		common.ApiErrorT(c, "Database error, please contact the administrator")
	default:
		// Invalid, expired, consumed, replayed, ambiguous, or a failed insert:
		// one message, no existence signal.
		common.ApiErrorT(c, "Sign-in link is invalid or has expired, please request a new one")
	}
}

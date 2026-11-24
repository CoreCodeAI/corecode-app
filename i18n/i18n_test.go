package i18n

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// The web console saves its own language codes (zhCN, zhTW, fr, ...) in the
// user setting; backend messages must follow them, and languages without a
// backend locale fall back to English.
func TestLanguageFromUserSetting(t *testing.T) {
	require.NoError(t, Init())
	for _, tc := range []struct {
		saved string
		want  string
	}{
		{"zhCN", LangZhCN},
		{"zhTW", LangZhTW},
		{"zh-HK", LangZhTW},
		{"zh_TW", LangZhTW},
		{"zh_HK", LangZhTW},
		{"zh-Hant-TW", LangZhTW},
		{"zh", LangZhCN},
		{"en", LangEn},
		{"fr", LangEn},
		{"ja", LangEn},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/v1/chat/completions", nil)
		c.Set(string(constant.ContextKeyUserSetting), dto.UserSetting{Language: tc.saved})
		assert.Equal(t, tc.want, StatedLang(c), tc.saved)
	}
}

// TokenAuth puts the user's settings into the request. A user who saved no
// language must not be loaded again, which would cost a cache or database read
// on every relay request; a request without loaded settings still loads them.
func TestStatedLangLoadsTheUserOnlyWithoutLoadedSettings(t *testing.T) {
	previous := userLangLoaderFunc
	t.Cleanup(func() { userLangLoaderFunc = previous })
	loads := 0
	SetUserLangLoader(func(int) string {
		loads++
		return "zhTW"
	})

	relay, _ := gin.CreateTestContext(httptest.NewRecorder())
	relay.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	relay.Set("id", 7)
	relay.Set(string(constant.ContextKeyUserSetting), dto.UserSetting{})
	assert.Equal(t, "", StatedLang(relay))
	assert.Zero(t, loads)

	dashboard, _ := gin.CreateTestContext(httptest.NewRecorder())
	dashboard.Request = httptest.NewRequest("GET", "/api/user/self", nil)
	dashboard.Set("id", 7)
	assert.Equal(t, LangZhTW, StatedLang(dashboard))
	assert.Equal(t, 1, loads)
}

// A saved language or an Accept-Language header selects the language of a
// backend message. A reader who states neither gets DEFAULT_LANGUAGE, which is
// English when unset.
func TestBackendMessageLanguage(t *testing.T) {
	require.NoError(t, Init())
	t.Cleanup(func() { common.DefaultLanguage = "" })
	quota := map[string]any{"Remaining": "$0.10"}
	const english = "Insufficient quota: wallet $0.10. Top up: https://corecode.live/wallet"
	const chinese = "额度不足：钱包 $0.10。请充值：https://corecode.live/wallet"
	for _, tc := range []struct {
		name            string
		defaultLanguage string
		saved           string
		acceptLanguage  string
		want            string
	}{
		{"nothing stated", "", "", "", english},
		{"no preference header", "", "", "*", english},
		{"nothing stated with a Chinese default", "zh-CN", "", "", chinese},
		{"nothing stated with an English default", "en", "", "", english},
		{"header wins over the default", "zh-CN", "", "en-US,en;q=0.9", english},
		{"header in a language without a locale", "zh-CN", "", "fr-FR", english},
		{"saved language wins over the header", "", "zhTW", "en-US", "額度不足：錢包 $0.10。請儲值：https://corecode.live/wallet"},
		{"saved language", "zh-CN", "en", "", english},
	} {
		t.Run(tc.name, func(t *testing.T) {
			common.DefaultLanguage = tc.defaultLanguage
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			if tc.acceptLanguage != "" {
				c.Request.Header.Set("Accept-Language", tc.acceptLanguage)
			}
			if tc.saved != "" {
				c.Set(string(constant.ContextKeyUserSetting), dto.UserSetting{Language: tc.saved})
			}
			assert.Equal(t, tc.want, T(c, MsgQuotaUserInsufficient, quota))
		})
	}
}

// A key missing from a locale, or a template that does not parse, reaches
// clients as the raw key.
func TestLocalesRenderEveryKey(t *testing.T) {
	require.NoError(t, Init())
	keysFile, err := parser.ParseFile(token.NewFileSet(), "keys.go", nil, parser.SkipObjectResolution)
	require.NoError(t, err)
	var declared []string
	ast.Inspect(keysFile, func(node ast.Node) bool {
		if spec, ok := node.(*ast.ValueSpec); ok {
			for _, value := range spec.Values {
				if literal, ok := value.(*ast.BasicLit); ok {
					key, err := strconv.Unquote(literal.Value)
					require.NoError(t, err)
					declared = append(declared, key)
				}
			}
		}
		return true
	})
	slices.Sort(declared)

	keysByLang := make(map[string][]string)
	for _, lang := range SupportedLanguages() {
		data, err := localeFS.ReadFile("locales/" + lang + ".yaml")
		require.NoError(t, err)
		var messages map[string]string
		require.NoError(t, yaml.Unmarshal(data, &messages))
		for key := range messages {
			keysByLang[lang] = append(keysByLang[lang], key)
		}
		slices.Sort(keysByLang[lang])
	}
	for _, lang := range SupportedLanguages() {
		assert.Equal(t, declared, keysByLang[lang], lang)
		for _, key := range keysByLang[lang] {
			text := Translate(lang, key, map[string]any{})
			assert.NotEqual(t, key, text, "%s %s", lang, key)
			assert.False(t, strings.Contains(text, "{{"), "%s %s: %s", lang, key, text)
		}
	}
}

// Web console responses carry the English source text as message_key plus its
// params, and the web console translates them. The backend sends the same body
// whatever language the request asks for.
func TestWebConsoleMessageResponse(t *testing.T) {
	require.NoError(t, Init())
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{
			name: "params",
			err:  common.NewMessage("Channel {{name}} (#{{id}}) does not exist", map[string]any{"name": "{{id}}", "id": 7}),
			want: `{"success":false,"message":"Channel {{id}} (#7) does not exist","message_key":"Channel {{name}} (#{{id}}) does not exist","message_params":{"id":7,"name":"{{id}}"}}`,
		},
		{
			name: "no params",
			err:  common.NewMessage("Invalid parameters"),
			want: `{"success":false,"message":"Invalid parameters","message_key":"Invalid parameters"}`,
		},
		{
			name: "plain error",
			err:  errors.New("record not found"),
			want: `{"success":false,"message":"record not found"}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("GET", "/api/channel/7", nil)
			c.Request.Header.Set("Accept-Language", "zh-CN")
			common.ApiError(c, tc.err)
			assert.JSONEq(t, tc.want, recorder.Body.String())
		})
	}
}

// Server log lines are English. DEFAULT_LANGUAGE=zh-CN prints the Chinese text of
// the lines that have one in common/log_text.zh-CN.json.
func TestServerLogLanguage(t *testing.T) {
	t.Cleanup(func() { common.SetLogLanguage("") })
	const line = "channel #%d has %d unfinished tasks"
	assert.Equal(t, "channel #7 has 2 unfinished tasks", common.LogText(line, 7, 2))
	common.SetLogLanguage("zh-CN")
	assert.Equal(t, "渠道 #7 未完成的任务有: 2", common.LogText(line, 7, 2))
	assert.Equal(t, "a line without a Chinese text: x", common.LogText("a line without a Chinese text: %s", "x"))
	assert.Equal(t, "任务进度轮询开始", common.LogText("task progress polling started"))
	common.SetLogLanguage("en")
	assert.Equal(t, "channel #7 has 2 unfinished tasks", common.LogText(line, 7, 2))
}

// A saved language wins, then the language the console browser asked for, then
// the request's own Accept-Language. A reader with none of them gets a quota
// refusal in Chinese with an English gloss, unless DEFAULT_LANGUAGE says
// which language such readers read.
func TestQuotaRefusalLanguagePriority(t *testing.T) {
	require.NoError(t, Init())
	t.Cleanup(func() { common.DefaultLanguage = "" })
	args := map[string]any{"Required": "$1.76", "Subscription": "$1.52", "Wallet": "$0"}
	const chinese = "额度不足：本次需预扣 $1.76，订阅剩 $1.52、钱包 $0。请充值：https://corecode.live/wallet"
	const english = "Insufficient quota: this request needs $1.76 reserved; subscription $1.52, wallet $0. Top up: https://corecode.live/wallet"
	const traditional = "額度不足：本次需預扣 $1.76，訂閱剩 $1.52、錢包 $0。請儲值：https://corecode.live/wallet"
	for _, tc := range []struct {
		name            string
		defaultLanguage string
		setting         *dto.UserSetting
		acceptLanguage  string
		want            string
	}{
		{"saved language wins over hint and header", "", &dto.UserSetting{Language: "en", LanguageHint: "zh-CN"}, "zh-TW", english},
		{"hint wins over the header", "", &dto.UserSetting{LanguageHint: "zh-CN"}, "en-US", chinese},
		{"hint stands in for an unsaved language", "", &dto.UserSetting{LanguageHint: "zh-TW"}, "", traditional},
		{"header without a saved language or hint", "", &dto.UserSetting{}, "en-US", english},
		{"header without any setting", "", nil, "zh-TW", traditional},
		{"nothing stated is bilingual", "", &dto.UserSetting{}, "", chinese + "（Insufficient quota: needs $1.76, subscription $1.52, wallet $0）"},
		{"a wildcard header states nothing", "", nil, "*", chinese + "（Insufficient quota: needs $1.76, subscription $1.52, wallet $0）"},
		{"DEFAULT_LANGUAGE replaces the bilingual line", "en", nil, "", english},
	} {
		t.Run(tc.name, func(t *testing.T) {
			common.DefaultLanguage = tc.defaultLanguage
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/messages", nil)
			if tc.acceptLanguage != "" {
				c.Request.Header.Set("Accept-Language", tc.acceptLanguage)
			}
			if tc.setting != nil {
				c.Set(string(constant.ContextKeyUserSetting), *tc.setting)
			}
			assert.Equal(t, tc.want, TBilingual(c, MsgQuotaSubscriptionAndWalletInsufficient, args))
		})
	}
	t.Run("other messages keep their fallback", func(t *testing.T) {
		common.DefaultLanguage = ""
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/messages", nil)
		assert.Equal(t, "unable to parse model", T(c, MsgDistributorInvalidParseModel))
	})
}

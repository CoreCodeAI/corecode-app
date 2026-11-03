package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFeishuBotWebhookAndSignature(t *testing.T) {
	for webhookURL, valid := range map[string]bool{
		"": true,
		"https://open.feishu.cn/open-apis/bot/v2/hook/0f1e2d3c-aaaa-bbbb":    true,
		" https://open.larksuite.com/open-apis/bot/v2/hook/0f1e2d3c ":        true,
		"https://open.feishu.cn/open-apis/bot/v2/hook/":                      false,
		"http://open.feishu.cn/open-apis/bot/v2/hook/0f1e2d3c":               false,
		"https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/0f1e2d3c": false,
		"https://open.feishu.cn/open-apis/bot/v2/hook/x/../../../other":      false,
		"https://example.com/webhook":                                        false,
	} {
		assert.Equal(t, valid, ValidateFeishuBotWebhook(webhookURL) == nil, webhookURL)
	}

	// base64(HMAC-SHA256(key="1599360473\nsecret", message="")), as Feishu's
	// own Python sample computes it.
	assert.Equal(t, "q4jswNiMy51J5JuQV566yJat0/lQ/c+22kINzUgKsGU=", feishuBotSign(1599360473, "secret"))

	assert.NoError(t, feishuBotResult(200, []byte(`{"code":0,"msg":"success","data":{}}`)))
	assert.ErrorContains(t, feishuBotResult(200, []byte(`{"code":19021,"msg":"sign match fail or timestamp is not within one hour from current time"}`)), "19021")
	assert.Error(t, feishuBotResult(400, []byte(`not json`)))
	assert.Error(t, feishuBotResult(200, []byte(`not json`)))
}

package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// CoreCode addition: text messages to a Feishu (or Lark) group through a
// custom bot's webhook.

var feishuBotWebhookPrefixes = []string{
	"https://open.feishu.cn/open-apis/bot/v2/hook/",
	"https://open.larksuite.com/open-apis/bot/v2/hook/",
}

// ValidateFeishuBotWebhook accepts an empty value, which turns the messages
// off, or a custom bot webhook on Feishu or Lark. Any other host is refused,
// so the setting cannot point the server at an arbitrary URL.
func ValidateFeishuBotWebhook(webhookURL string) error {
	webhookURL = strings.TrimSpace(webhookURL)
	if webhookURL == "" {
		return nil
	}
	for _, prefix := range feishuBotWebhookPrefixes {
		if strings.HasPrefix(webhookURL, prefix) && len(webhookURL) > len(prefix) && !strings.ContainsAny(webhookURL[len(prefix):], "/?#") {
			return nil
		}
	}
	return fmt.Errorf("not a Feishu or Lark custom bot webhook")
}

// feishuBotSign is the signature a bot with "signature verification" enabled
// expects: base64 of an HMAC-SHA256 keyed by "timestamp\nsecret" over nothing.
func feishuBotSign(timestamp int64, secret string) string {
	mac := hmac.New(sha256.New, []byte(strconv.FormatInt(timestamp, 10)+"\n"+secret))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// SendFeishuBotText posts text to a custom bot. secret is the bot's signing
// secret, or empty when the bot does not verify signatures.
func SendFeishuBotText(webhookURL string, secret string, text string) error {
	webhookURL = strings.TrimSpace(webhookURL)
	if webhookURL == "" {
		return fmt.Errorf("no Feishu webhook configured")
	}
	if err := ValidateFeishuBotWebhook(webhookURL); err != nil {
		return err
	}
	message := map[string]any{
		"msg_type": "text",
		"content":  map[string]string{"text": text},
	}
	if secret = strings.TrimSpace(secret); secret != "" {
		timestamp := time.Now().Unix()
		message["timestamp"] = strconv.FormatInt(timestamp, 10)
		message["sign"] = feishuBotSign(timestamp, secret)
	}
	body, err := common.Marshal(message)
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	client := *GetSSRFProtectedHTTPClient()
	client.Timeout = 10 * time.Second
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return err
	}
	return feishuBotResult(response.StatusCode, responseBody)
}

// feishuBotResult reads a bot's answer. Feishu reports most failures, such as
// a bad signature or a keyword the bot requires, with HTTP 200 and a nonzero
// code.
func feishuBotResult(status int, body []byte) error {
	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := common.Unmarshal(body, &result); err != nil {
		if status < 200 || status >= 300 {
			return fmt.Errorf("feishu bot answered status %d", status)
		}
		return fmt.Errorf("feishu bot answered an unreadable body: %w", err)
	}
	if result.Code != 0 || status < 200 || status >= 300 {
		return fmt.Errorf("feishu bot answered status %d code %d: %s", status, result.Code, result.Msg)
	}
	return nil
}

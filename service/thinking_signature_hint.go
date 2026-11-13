package service

import "strings"

// thinkingSignatureHint follows Anthropic's 400 for a thinking block it cannot
// verify. A client that resumes a Claude Code session another provider served
// sends thinking signed elsewhere, and every account rejects it the same way,
// so retrying cannot help; the customer has to leave that history behind.
const thinkingSignatureHint = "（CoreCode 提示：这个会话的历史里有其他服务生成的思考内容，Claude 官方接口无法校验它的签名，换账号重试也会失败。请在 Claude Code 里用 /clear 新开会话，或用 /rewind 退回到切换服务之前的那一轮。）"

// withThinkingSignatureHint appends thinkingSignatureHint to an upstream error
// message that reports an invalid thinking signature, once.
func withThinkingSignatureHint(message string) string {
	if !strings.Contains(message, "Invalid `signature` in `") || !strings.Contains(message, "thinking` block") {
		return message
	}
	if strings.Contains(message, thinkingSignatureHint) {
		return message
	}
	return message + " " + thinkingSignatureHint
}

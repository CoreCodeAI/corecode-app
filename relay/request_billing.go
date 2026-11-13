package relay

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// PrepareRequestBilling estimates and reserves one request's charge. Transports
// provide the current request body through BodyStorage or BillingRequestInput;
// channel retries retain the resulting billing session and pricing snapshot.
func PrepareRequestBilling(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	stopEstimate := service.TimePreChannel(c, service.PreChannelBillingEstimate)
	meta := &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
	if info.Request != nil && constant.CountToken {
		meta = info.Request.GetTokenCountMeta()
	} else {
		// Avoid building CombineText when only the pricing quantities are needed.
		switch request := info.Request.(type) {
		case *dto.GeneralOpenAIRequest:
			meta.MaxTokens = int(max(lo.FromPtr(request.MaxTokens), lo.FromPtr(request.MaxCompletionTokens)))
		case *dto.OpenAIResponsesRequest:
			meta.MaxTokens = int(lo.FromPtr(request.MaxOutputTokens))
		case *dto.ClaudeRequest:
			meta.MaxTokens = int(lo.FromPtr(request.MaxTokens))
		case *dto.ImageRequest:
			meta = request.GetTokenCountMeta()
		}
	}

	tokens, err := service.EstimateRequestToken(c, meta, info)
	stopEstimate()
	if err != nil {
		return types.NewError(err, types.ErrorCodeCountTokenFailed)
	}
	if constant.CountToken {
		tokens += claudeThreadKeptTokens(c, info)
	}
	info.SetEstimatePromptTokens(tokens)

	defer service.TimePreChannel(c, service.PreChannelBillingReserve)()
	priceData, err := helper.ModelPriceHelper(c, info, tokens, meta)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
	}
	if priceData.FreeModel {
		logger.LogInfo(c, common.LogText("model %s is free, skipping pre-consume", info.OriginModelName))
		return nil
	}
	return service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info)
}

// claudeThreadKeptTokens is the context a Claude thread continuation carries
// upstream beyond its own messages: it sends only the new turn, and Anthropic
// bills the conversation it keeps. 0 for any other request, or when the
// previous response's context is not known.
func claudeThreadKeptTokens(c *gin.Context, info *relaycommon.RelayInfo) int {
	request, ok := info.Request.(*dto.ClaudeRequest)
	if !ok {
		return 0
	}
	previous := service.ClaudeThreadContinues(request.Thread)
	if previous == "" {
		return 0
	}
	kept, found := service.ClaudeThreadContextTokens(info.UserId, previous)
	if !found {
		logger.LogInfo(c, common.LogText("claude thread continues %s, whose context is not known; estimating the new messages only", previous))
	}
	return kept
}

// RefundFailedRequestBilling applies the common final-failure policy after all
// eligible attempts have ended. A settled BillingSession never refunds again.
func RefundFailedRequestBilling(c *gin.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) *types.NewAPIError {
	if apiErr == nil {
		return nil
	}
	apiErr = service.NormalizeViolationFeeError(apiErr)
	if info.Billing != nil {
		info.Billing.Refund(c)
	}
	service.ChargeViolationFeeIfNeeded(c, info, apiErr)
	return apiErr
}

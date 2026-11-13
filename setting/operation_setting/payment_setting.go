package operation_setting

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type PaymentSetting struct {
	AmountOptions  []int           `json:"amount_options"`
	AmountDiscount map[int]float64 `json:"amount_discount"` // 充值金额对应的折扣，例如 100 元 0.9 表示 100 元充值享受 9 折优惠
	// AmountBonus credits extra quota on an online (epay) top-up: a top-up of
	// at least the key amount gets the value's fraction of its quota on top,
	// for example {"1000": 0.1} credits 1100 for a top-up of 1000.
	AmountBonus map[int]float64 `json:"amount_bonus"`
	// BonusCampaign is the operator's headline for a limited-time bonus, for
	// example a holiday sale. The wallet shows it above the amounts while it is
	// set; clearing it ends the banner. It changes no price: the tiers are
	// still amount_bonus.
	BonusCampaign string `json:"bonus_campaign"`

	ComplianceConfirmed    bool   `json:"compliance_confirmed"`
	ComplianceTermsVersion string `json:"compliance_terms_version"`
	ComplianceConfirmedAt  int64  `json:"compliance_confirmed_at"`
	ComplianceConfirmedBy  int    `json:"compliance_confirmed_by"`
	ComplianceConfirmedIP  string `json:"compliance_confirmed_ip"`

	// 易支付签名方式：MD5 使用 EpayKey；RSA 使用商户私钥签名请求、平台公钥验证回调。
	EpaySignType           string `json:"epay_sign_type"`
	EpayMerchantPrivateKey string `json:"epay_merchant_private_key"`
	EpayPlatformPublicKey  string `json:"epay_platform_public_key"`
}

const CurrentComplianceTermsVersion = "v1"

const (
	EpaySignTypeMD5 = "MD5"
	EpaySignTypeRSA = "RSA"

	EpaySignTypeOptionKey           = "payment_setting.epay_sign_type"
	EpayMerchantPrivateKeyOptionKey = "payment_setting.epay_merchant_private_key"
	EpayPlatformPublicKeyOptionKey  = "payment_setting.epay_platform_public_key"
)

// 默认配置
var paymentSetting = PaymentSetting{
	AmountOptions:  []int{10, 20, 50, 100, 200, 500},
	AmountDiscount: map[int]float64{},
	AmountBonus:    map[int]float64{},
	// 没有保存过签名方式的站点按 MD5 运行，升级后行为不变。
	EpaySignType: EpaySignTypeMD5,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("payment_setting", &paymentSetting)
}

func GetPaymentSetting() *PaymentSetting {
	return &paymentSetting
}

// TopUpBonusRate returns the bonus fraction for a top-up of amount: the rate
// of the highest tier at or below it, or 0 when no tier applies. Tiers are
// ranges, so an amount typed between two tiers gets the lower one.
func TopUpBonusRate(amount int64) float64 {
	bestMin, rate := 0, 0.0
	for minAmount, tierRate := range paymentSetting.AmountBonus {
		if int64(minAmount) <= amount && minAmount > bestMin && tierRate > 0 {
			bestMin, rate = minAmount, tierRate
		}
	}
	return rate
}

// ValidateAmountBonus checks a payment_setting.amount_bonus value before it is
// saved: whole positive amounts mapped to a fraction above 0 and at most 1.
// No tiers is "{}": an empty value would fail to load and leave the previous
// tiers running.
func ValidateAmountBonus(value string) error {
	var tiers map[string]float64
	if err := common.UnmarshalJsonStr(value, &tiers); err != nil {
		return fmt.Errorf("Top-up bonus must be a JSON object of amount to fraction")
	}
	for amount, rate := range tiers {
		if number, err := strconv.Atoi(amount); err != nil || number <= 0 {
			return fmt.Errorf("Top-up bonus amount %q must be a positive whole number", amount)
		}
		if rate <= 0 || rate > 1 {
			return fmt.Errorf("Top-up bonus for %s must be above 0 and at most 1", amount)
		}
	}
	return nil
}

// MaxBonusCampaignLength caps the wallet banner at one or two lines.
const MaxBonusCampaignLength = 120

// ValidateBonusCampaign checks a payment_setting.bonus_campaign value before
// it is saved. An empty value is allowed and removes the banner.
func ValidateBonusCampaign(value string) error {
	if utf8.RuneCountInString(value) > MaxBonusCampaignLength {
		return fmt.Errorf("Top-up campaign text must be at most %d characters", MaxBonusCampaignLength)
	}
	return nil
}

func IsPaymentComplianceConfirmed() bool {
	return paymentSetting.ComplianceConfirmed &&
		paymentSetting.ComplianceTermsVersion == CurrentComplianceTermsVersion
}

// ValidateEpaySignOption checks a change to the Epay signing settings against
// the saved ones. While RSA is active, both keys must parse; under MD5 only a
// newly entered key is checked.
func ValidateEpaySignOption(key, value string) error {
	if key != EpaySignTypeOptionKey && key != EpayMerchantPrivateKeyOptionKey && key != EpayPlatformPublicKeyOptionKey {
		return nil
	}
	// Saved values are written under OptionMapRWMutex by the option update path.
	common.OptionMapRWMutex.RLock()
	signType := paymentSetting.EpaySignType
	privateKey := paymentSetting.EpayMerchantPrivateKey
	publicKey := paymentSetting.EpayPlatformPublicKey
	common.OptionMapRWMutex.RUnlock()
	switch key {
	case EpaySignTypeOptionKey:
		if value != EpaySignTypeMD5 && value != EpaySignTypeRSA {
			return common.NewMessage("Epay signature type must be MD5 or RSA")
		}
		signType = value
	case EpayMerchantPrivateKeyOptionKey:
		privateKey = value
	case EpayPlatformPublicKeyOptionKey:
		publicKey = value
	}
	rsaActive := signType == EpaySignTypeRSA
	if rsaActive || (key == EpayMerchantPrivateKeyOptionKey && strings.TrimSpace(value) != "") {
		if _, err := epay.ParseRSAPrivateKey(privateKey); err != nil {
			return common.NewMessage("The Epay merchant private key is missing or invalid")
		}
	}
	if rsaActive || (key == EpayPlatformPublicKeyOptionKey && strings.TrimSpace(value) != "") {
		if _, err := epay.ParseRSAPublicKey(publicKey); err != nil {
			return common.NewMessage("The Epay platform public key is missing or invalid")
		}
	}
	return nil
}

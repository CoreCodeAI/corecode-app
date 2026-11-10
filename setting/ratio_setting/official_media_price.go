package ratio_setting

import (
	"fmt"
	"maps"
	"math"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
)

// OfficialMediaPrice is the provider's published price for a video or image
// model. A video has PerSecond; an image has PerImage, keyed by the size tiers
// the price board shows. A tier that is absent has no official figure.
type OfficialMediaPrice struct {
	Currency  string             `json:"currency"`
	PerSecond *float64           `json:"per_second,omitempty"`
	PerImage  map[string]float64 `json:"per_image,omitempty"`
}

// CoreCode fork: official reference prices for models that bill per second, per
// image or per call, where a ratio cannot express the official price. Billing
// never reads this map; the pricing page shows it beside CoreCode's own price.
var officialMediaPriceMap = types.NewRWMap[string, OfficialMediaPrice]()

var (
	officialMediaCurrencies = []string{"CNY", "USD"}
	officialMediaImageTiers = []string{"1K", "2K", "4K"}
)

func OfficialMediaPrice2JSONString() string {
	return officialMediaPriceMap.MarshalJSONString()
}

func officialMediaNumber(model string, field string, value any) (float64, error) {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 {
		return 0, fmt.Errorf("official media price for %s: %s must be a number of zero or more", model, field)
	}
	return number, nil
}

func parseOfficialMediaPrice(model string, raw map[string]any) (OfficialMediaPrice, error) {
	var price OfficialMediaPrice
	for key := range raw {
		if key != "currency" && key != "per_second" && key != "per_image" {
			return price, fmt.Errorf("official media price for %s: unknown key %q", model, key)
		}
	}
	currency, _ := raw["currency"].(string)
	if !slices.Contains(officialMediaCurrencies, currency) {
		return price, fmt.Errorf("official media price for %s: currency must be CNY or USD", model)
	}
	price.Currency = currency

	perSecond, hasSecond := raw["per_second"]
	perImage, hasImage := raw["per_image"]
	if hasSecond == hasImage {
		return price, fmt.Errorf("official media price for %s: set exactly one of per_second and per_image", model)
	}
	if hasSecond {
		seconds, err := officialMediaNumber(model, "per_second", perSecond)
		if err != nil {
			return price, err
		}
		price.PerSecond = &seconds
		return price, nil
	}

	tiers, ok := perImage.(map[string]any)
	if !ok || len(tiers) == 0 {
		return price, fmt.Errorf("official media price for %s: per_image must list at least one tier", model)
	}
	price.PerImage = make(map[string]float64, len(tiers))
	for tier, value := range tiers {
		if !slices.Contains(officialMediaImageTiers, tier) {
			return price, fmt.Errorf("official media price for %s: unknown image tier %q", model, tier)
		}
		number, err := officialMediaNumber(model, "per_image "+tier, value)
		if err != nil {
			return price, err
		}
		price.PerImage[tier] = number
	}
	return price, nil
}

// UpdateOfficialMediaPriceByJSONString replaces the map. A rejected value leaves
// the map as it was.
func UpdateOfficialMediaPriceByJSONString(jsonStr string) error {
	raw := make(map[string]map[string]any)
	if err := common.Unmarshal([]byte(jsonStr), &raw); err != nil {
		return err
	}
	parsed := make(map[string]OfficialMediaPrice, len(raw))
	for model, entry := range raw {
		if entry == nil {
			return fmt.Errorf("official media price for %s must be an object", model)
		}
		price, err := parseOfficialMediaPrice(model, entry)
		if err != nil {
			return err
		}
		parsed[model] = price
	}
	officialMediaPriceMap.Clear()
	officialMediaPriceMap.AddAll(parsed)
	InvalidateExposedDataCache()
	return nil
}

// GetOfficialMediaPrice returns a copy of the model's official price, or false
// when none is set.
func GetOfficialMediaPrice(name string) (OfficialMediaPrice, bool) {
	price, ok := officialMediaPriceMap.Get(name)
	if !ok {
		return OfficialMediaPrice{}, false
	}
	if price.PerImage != nil {
		price.PerImage = maps.Clone(price.PerImage)
	}
	return price, true
}

package ratio_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOfficialPriceMarkup(t *testing.T) {
	t.Cleanup(func() { require.NoError(t, UpdateOfficialPriceMarkupByJSONString("{}")) })

	require.NoError(t, UpdateOfficialPriceMarkupByJSONString(`{"claude-fable-5-1":1.5}`))
	markup, ok := GetOfficialPriceMarkup("claude-fable-5-1")
	assert.True(t, ok)
	assert.Equal(t, 1.5, markup)

	markup, ok = GetOfficialPriceMarkup("claude-opus-5-5")
	assert.False(t, ok)
	assert.Equal(t, 1.0, markup)

	for _, value := range []string{`{"claude-fable-5-1":0}`, `{"claude-fable-5-1":-2}`, `not json`} {
		assert.Error(t, UpdateOfficialPriceMarkupByJSONString(value), value)
		markup, _ = GetOfficialPriceMarkup("claude-fable-5-1")
		assert.Equal(t, 1.5, markup, "a rejected value keeps the previous map")
	}
}

func TestOfficialMediaPrice(t *testing.T) {
	t.Cleanup(func() { require.NoError(t, UpdateOfficialMediaPriceByJSONString("{}")) })

	require.NoError(t, UpdateOfficialMediaPriceByJSONString(`{
		"video-a":{"currency":"CNY","per_second":0.67},
		"image-a":{"currency":"USD","per_image":{"1K":0.0317,"2K":0.0475}}
	}`))
	video, ok := GetOfficialMediaPrice("video-a")
	require.True(t, ok)
	assert.Equal(t, "CNY", video.Currency)
	require.NotNil(t, video.PerSecond)
	assert.Equal(t, 0.67, *video.PerSecond)
	assert.Nil(t, video.PerImage)

	image, ok := GetOfficialMediaPrice("image-a")
	require.True(t, ok)
	assert.Equal(t, "USD", image.Currency)
	assert.Equal(t, map[string]float64{"1K": 0.0317, "2K": 0.0475}, image.PerImage, "a tier left out has no official figure")
	assert.Nil(t, image.PerSecond)

	_, ok = GetOfficialMediaPrice("other")
	assert.False(t, ok)
	assert.JSONEq(t, `{"currency":"USD","per_image":{"1K":0.0317,"2K":0.0475}}`, mustMarshal(t, image))

	rejected := []string{
		`not json`,
		`{"m":{"currency":"CNY","per_second":-1}}`,
		`{"m":{"currency":"CNY","per_second":"1"}}`,
		`{"m":{"currency":"CNY","per_image":{"1K":-0.1}}}`,
		`{"m":{"currency":"EUR","per_second":1}}`,
		`{"m":{"per_second":1}}`,
		`{"m":{"currency":"CNY","per_second":1,"extra":1}}`,
		`{"m":{"currency":"CNY","per_image":{"8K":1}}}`,
		`{"m":{"currency":"CNY"}}`,
		`{"m":{"currency":"CNY","per_second":1,"per_image":{"1K":1}}}`,
		`{"m":{"currency":"CNY","per_image":{}}}`,
		`{"m":null}`,
	}
	for _, value := range rejected {
		assert.Error(t, UpdateOfficialMediaPriceByJSONString(value), value)
		_, ok = GetOfficialMediaPrice("video-a")
		assert.True(t, ok, "a rejected value keeps the previous map: %s", value)
	}
}

func mustMarshal(t *testing.T, value any) string {
	t.Helper()
	data, err := common.Marshal(value)
	require.NoError(t, err)
	return string(data)
}

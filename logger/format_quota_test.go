package logger

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
)

// A refusal quotes amounts a customer reads: two decimals, no $0.000000, and
// a nonzero amount under one cent is never shown as zero.
func TestFormatQuotaBrief(t *testing.T) {
	previous := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = previous })
	for _, tc := range []struct {
		quota int
		want  string
	}{
		{0, "$0"},
		{878613, "$1.76"},
		{758273, "$1.52"},
		{500000, "$1.00"},
		{2000, "<$0.01"},
		{1, "<$0.01"},
		{2500, "$0.01"},
		{-250000, "-$0.50"},
		{-1, "$0"},
	} {
		assert.Equal(t, tc.want, FormatQuotaBrief(tc.quota), "%d", tc.quota)
	}
}

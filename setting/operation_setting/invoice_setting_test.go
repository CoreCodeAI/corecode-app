package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateInvoiceTaxRate(t *testing.T) {
	for value, ok := range map[string]bool{
		"4": true, "0": true, "100": true, "6.25": true, "0.01": true,
		"4.123": false, "-1": false, "100.01": false, "abc": false,
		"NaN": false, "nan": false, "Inf": false, "-Inf": false, "+Infinity": false,
	} {
		err := ValidateInvoiceOption("tax_rate", value)
		assert.Equal(t, ok, err == nil, "tax_rate %q: %v", value, err)
	}
}

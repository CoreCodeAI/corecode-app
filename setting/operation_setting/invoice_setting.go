package operation_setting

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/setting/config"
)

// InvoiceSetting runs the invoice center: a customer picks paid orders,
// fills in an invoice title, pays a tax surcharge on the order amount, and an
// administrator issues the invoice and uploads its file. Only general VAT
// invoices are offered.
type InvoiceSetting struct {
	Enabled bool `json:"enabled"`
	// TaxRate is the surcharge, in percent of the order amount, a customer
	// pays to have the orders invoiced; 0 charges nothing.
	TaxRate float64 `json:"tax_rate"`
	// Categories lists the product categories an invoice may carry, one per
	// line.
	Categories string `json:"categories"`
	// OrderDays is how many days after payment an order can be invoiced.
	OrderDays int `json:"order_days"`
	// MaxOrders bounds the orders one application may carry.
	MaxOrders int `json:"max_orders"`
	// PaymentTimeoutMinutes is how long an application waits for its tax
	// before it is cancelled and its orders released.
	PaymentTimeoutMinutes int `json:"payment_timeout_minutes"`
	// FileMaxKB bounds an invoice file an administrator uploads.
	FileMaxKB int `json:"file_max_kb"`
}

var invoiceSetting = InvoiceSetting{
	TaxRate:               4,
	Categories:            "软件开发服务",
	OrderDays:             365,
	MaxOrders:             50,
	PaymentTimeoutMinutes: 30,
	FileMaxKB:             2048,
}

func init() {
	config.GlobalConfig.Register("invoice_setting", &invoiceSetting)
}

func GetInvoiceSetting() *InvoiceSetting {
	return &invoiceSetting
}

// CategoryList returns the configured product categories, trimmed, in order.
func (s *InvoiceSetting) CategoryList() []string {
	return parseInvoiceCategories(s.Categories)
}

func parseInvoiceCategories(value string) []string {
	categories := make([]string, 0)
	for line := range strings.SplitSeq(value, "\n") {
		if category := strings.TrimSpace(line); category != "" {
			categories = append(categories, category)
		}
	}
	return categories
}

// ValidateInvoiceOption checks one invoice_setting field value before it is
// saved.
func ValidateInvoiceOption(field string, value string) error {
	integerBetween := func(low, high int) error {
		number, err := strconv.Atoi(value)
		if err != nil || number < low || number > high {
			return fmt.Errorf("Invoice %s must be a whole number between %d and %d", field, low, high)
		}
		return nil
	}
	switch field {
	case "tax_rate":
		rate, err := strconv.ParseFloat(value, 64)
		if err != nil || math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || rate > 100 || math.Abs(rate*100-math.Round(rate*100)) > 1e-6 {
			return fmt.Errorf("Invoice tax rate must be a percent between 0 and 100 with at most two decimals")
		}
	case "order_days":
		return integerBetween(1, 3650)
	case "max_orders":
		return integerBetween(1, 200)
	case "payment_timeout_minutes":
		return integerBetween(5, 1440)
	case "file_max_kb":
		return integerBetween(10, 10240)
	case "categories":
		categories := parseInvoiceCategories(value)
		if len(categories) == 0 {
			return fmt.Errorf("Invoice categories must list at least one category")
		}
		for _, category := range categories {
			if utf8.RuneCountInString(category) > 100 {
				return fmt.Errorf("Each invoice category can have at most 100 characters")
			}
		}
	}
	return nil
}

package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// BillingSetting holds the switches of the billing path that are not prices.
// Its options read as billing.<field>.
type BillingSetting struct {
	// CacheAwarePreConsumeEnabled lets a Claude request whose full reservation
	// the balance cannot hold reserve a cache-based estimate instead, when the
	// same conversation's cache is still alive (service.EstimateCacheAwarePreConsume).
	// Off, every request reserves its full estimate as before.
	CacheAwarePreConsumeEnabled bool `json:"cache_aware_pre_consume_enabled"`
}

var billingSetting = BillingSetting{
	CacheAwarePreConsumeEnabled: true,
}

func init() {
	config.GlobalConfig.Register("billing", &billingSetting)
}

func GetBillingSetting() *BillingSetting {
	return &billingSetting
}

package service

import (
	"context"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	invoiceExpiryTickInterval = time.Minute
	invoiceExpiryBatchSize    = 200
)

var invoiceExpiryOnce sync.Once

// StartInvoiceExpiryTask cancels, every minute, the invoice applications
// whose tax has gone unpaid past the configured timeout, so their orders can
// be invoiced again. Each cancellation is conditional, so the two servers of a
// release can both run it.
func StartInvoiceExpiryTask() {
	invoiceExpiryOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(invoiceExpiryTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				runInvoiceExpiryOnce()
			}
		})
	})
}

func runInvoiceExpiryOnce() {
	timeout := operation_setting.GetInvoiceSetting().PaymentTimeoutMinutes
	for {
		cancelled, err := model.ExpireUnpaidInvoices(timeout, invoiceExpiryBatchSize)
		if err != nil {
			logger.LogWarn(context.Background(), common.LogText("invoice expiry task failed: %v", err))
			return
		}
		if cancelled > 0 {
			logger.LogInfo(context.Background(), common.LogText("invoice expiry task cancelled %d unpaid applications", cancelled))
		}
		if cancelled < invoiceExpiryBatchSize {
			return
		}
	}
}

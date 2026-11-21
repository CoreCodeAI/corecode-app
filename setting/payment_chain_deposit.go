package setting

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// CoreCode addition: top-ups through a per-user on-chain deposit address.

// ChainDepositEnabled offers the wallet method and issues new addresses.
// Turning it off leaves crediting running, because addresses already issued
// keep receiving.
var ChainDepositEnabled = false

// ChainDepositAdminOnly shows the method to administrators only and refuses
// anyone else's address request, so it can be tried before customers see it.
var ChainDepositAdminOnly = true

// ChainDepositBonusRate is the bonus every on-chain deposit earns on top of
// its top-up tier, as a fraction of what it buys: 0.01 is one percent more.
// Taking a deposit on chain costs less than any payment provider's fee.
var ChainDepositBonusRate = 0.01

// ValidateChainDepositBonusRate accepts a fraction from 0 to 1.
func ValidateChainDepositBonusRate(value string) error {
	rate, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(rate) || rate < 0 || rate > 1 {
		return fmt.Errorf("ChainDepositBonusRate must be a fraction from 0 to 1, such as 0.01")
	}
	return nil
}

// ChainDepositApiUrl is the deposit service's base URL, such as
// "http://10.240.13.4:8081".
var ChainDepositApiUrl = ""

// ChainDepositHmacSecret signs every request to the deposit service and
// verifies every response. It is never returned to the console.
var ChainDepositHmacSecret = ""

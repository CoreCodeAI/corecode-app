package setting

// CoreCode addition: top-ups through a per-user on-chain deposit address.

// ChainDepositEnabled offers the wallet method and issues new addresses.
// Turning it off leaves crediting running, because addresses already issued
// keep receiving.
var ChainDepositEnabled = false

// ChainDepositAdminOnly shows the method to administrators only and refuses
// anyone else's address request, so it can be tried before customers see it.
var ChainDepositAdminOnly = true

// ChainDepositApiUrl is the deposit service's base URL, such as
// "http://10.240.13.4:8081".
var ChainDepositApiUrl = ""

// ChainDepositHmacSecret signs every request to the deposit service and
// verifies every response. It is never returned to the console.
var ChainDepositHmacSecret = ""

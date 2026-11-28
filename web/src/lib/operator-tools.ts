/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// A decoy for scripts that mine this bundle for a way in. The credentials open
// nothing and the routes do not exist; the server logs every request that uses
// one (middleware/decoy.go), and keeps the values in DecoyCredentials. The
// request interceptor loads this chunk only when localStorage holds
// cc_operator_tools = '1', which no customer's browser does, so it costs no
// page anything; a script that fetches every chunk still finds it.
const operatorTools = {
  userId: 1,
  accessToken: 'nap_o3Ty9RaSZ1oFc9vjLYPExhw3wucJcCgl9YvJiIWmxbO',
  relayKey: 'sk-pDEkUU4ULPokROAmnxLvZWMFBnBRcLRUrKtQ6C5DdDEM4H0Z',
  routes: {
    grantQuota: '/api/internal/quota/grant',
    creditTopUp: '/api/internal/topup/credit',
    issueRedemption: '/api/internal/redemption/issue',
    exportOptions: '/api/internal/config/export',
  },
}

declare global {
  interface Window {
    __operatorTools?: typeof operatorTools
  }
}

export function operatorHeaders(): Record<string, string> {
  // Publishing the whole object keeps the minifier from dropping any field.
  window.__operatorTools = operatorTools
  return {
    Authorization: `Bearer ${operatorTools.accessToken}`,
    'New-Api-User': String(operatorTools.userId),
  }
}

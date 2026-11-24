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
import type { InsightsRangeInfo, InsightsTab } from '../lib'
import type {
  CapacityInsights,
  EngineOutlook,
  FinanceInsights,
  QualityInsights,
  RiskInsights,
  UpstreamInsights,
} from '../types'
import {
  useCapacityVerdict,
  useFinanceVerdict,
  useQualityVerdict,
  useRiskVerdict,
  useUpstreamVerdict,
  type TabVerdict,
} from '../verdicts'

type Pair<T> = [T | undefined, T | undefined]

export type TabVerdicts = [InsightsTab, TabVerdict | undefined][]

/**
 * Each tab's own verdict, read the way the tab reads it. The overview shows
 * them as health marks in its status bar and as a card per tab.
 */
export function useOverviewVerdicts(props: {
  capacity: Pair<CapacityInsights>
  quality: Pair<QualityInsights>
  finance: Pair<FinanceInsights>
  risk: RiskInsights | undefined
  upstream: Pair<UpstreamInsights>
  range?: InsightsRangeInfo
  outlook?: EngineOutlook
}): TabVerdicts {
  return [
    [
      'capacity',
      useCapacityVerdict(
        props.capacity[0],
        props.capacity[1],
        undefined,
        undefined,
        props.outlook
      ),
    ],
    ['quality', useQualityVerdict(props.quality[0], props.quality[1])],
    ['finance', useFinanceVerdict(props.finance[0], props.finance[1])],
    [
      'upstream',
      useUpstreamVerdict(props.upstream[0], props.upstream[1], props.range),
    ],
    ['risk', useRiskVerdict(props.risk)],
  ]
}


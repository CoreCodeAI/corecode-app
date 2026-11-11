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
import type {
  EngineOutlook,
  EngineOutlookModel,
  EngineOutlookWindow,
  OutlookModelId,
} from '../../types'

export const NOW = 1_800_000_000_000
const HOUR = 3_600_000

// Six points to 5 hours, eight to 24, ten to 7 days.
export const SAMPLE_HOURS = [0, 1, 2, 3, 4, 5, 12, 24, 96, 168]

export function outlookWindow(
  hours: number,
  overrides: Partial<EngineOutlookWindow> = {}
): EngineOutlookWindow {
  return {
    hours,
    demand_usd: hours * 200,
    served_usd: hours * 200,
    short_usd: 0,
    short_hours: 0,
    first_short_hours: null,
    lowest_usd: 300,
    lowest_hours: Math.min(hours, 4),
    ...overrides,
  }
}

/** A forecast the pool serves in full unless the overrides say otherwise. */
export function outlookModel(
  id: OutlookModelId,
  overrides: Partial<EngineOutlookModel> = {}
): EngineOutlookModel {
  return {
    id,
    available: true,
    rate_usd_per_hour: 200,
    average_usd_per_hour: 200,
    peak_usd_per_hour: 200,
    week_load: 0.7,
    windows: [outlookWindow(5), outlookWindow(24), outlookWindow(168)],
    drawable: [700, 650, 600, 300, 400, 900, 500, 450, 400, 600],
    week_left: [6600, 6400, 6200, 6000, 5800, 5600, 5000, 4000, 3000, 2500],
    demand: SAMPLE_HOURS.map(() => 200),
    low: null,
    high: null,
    additions: [
      {
        plan: 'Team',
        tier: 'team_tier_1',
        week_usd: 1400,
        five_hour_usd: 150,
        measured: 4,
        keep_up: 0,
        cover_week: 0,
      },
    ],
    ...overrides,
  }
}

// The smart forecast on 2026-11-11, rounded: the next 5 hours are served,
// the day is tight, and the week runs dry 42.8 hours in.
const smart = outlookModel('smart', {
  rate_usd_per_hour: 217,
  average_usd_per_hour: 258,
  peak_usd_per_hour: 330,
  week_load: 1.83,
  windows: [
    outlookWindow(5, { demand_usd: 1200, served_usd: 1200 }),
    outlookWindow(24, {
      demand_usd: 6000,
      served_usd: 6000,
      lowest_usd: 150,
      lowest_hours: 20,
    }),
    outlookWindow(168, {
      demand_usd: 43000,
      served_usd: 23400,
      short_usd: 19600,
      short_hours: 61,
      first_short_hours: 42.8,
      lowest_usd: 0,
      lowest_hours: 42.8,
    }),
  ],
  drawable: [700, 650, 600, 300, 400, 900, 500, 150, 0, 200],
  week_left: [6600, 6400, 6200, 6000, 5800, 5600, 5000, 3000, 0, 2000],
  demand: [220, 230, 240, 250, 240, 230, 260, 250, 270, 260],
  low: {
    scale: 0.8,
    windows: [
      outlookWindow(5, { demand_usd: 960 }),
      outlookWindow(24, { demand_usd: 4800 }),
      outlookWindow(168, { demand_usd: 34400 }),
    ],
    drawable: [700, 700, 680, 420, 520, 980, 640, 330, 120, 420],
    week_left: [6600, 6450, 6300, 6150, 6000, 5850, 5400, 3800, 900, 2900],
  },
  high: {
    scale: 1.3,
    windows: [
      outlookWindow(5, { demand_usd: 1560 }),
      outlookWindow(24, { demand_usd: 7800 }),
      outlookWindow(168, { demand_usd: 55900 }),
    ],
    drawable: [700, 600, 500, 150, 250, 800, 300, 0, 0, 0],
    week_left: [6600, 6300, 6000, 5700, 5400, 5100, 4300, 1800, 0, 900],
  },
  additions: [
    {
      plan: 'Team',
      tier: 'team_tier_1',
      week_usd: 1400,
      five_hour_usd: 150,
      measured: 4,
      keep_up: 18,
      cover_week: 17,
    },
    {
      plan: 'Team',
      tier: 'team_standard',
      week_usd: 280,
      five_hour_usd: 30,
      measured: 6,
      keep_up: 88,
      cover_week: null,
    },
  ],
})

export function outlook(overrides: Partial<EngineOutlook> = {}): EngineOutlook {
  return {
    configured: true,
    channel: 'claude',
    observed_at_ms: NOW,
    counted: 14,
    unknown: 0,
    week_capacity_usd: 23700,
    five_hour_capacity_usd: 2400,
    sustainable_usd_per_hour: 141,
    peak_usd_per_hour: 480,
    remaining: [
      {
        hours: 5,
        on_hand_usd: 700,
        five_hour_refill_usd: 1500,
        week_refill_usd: 0,
        with_resets_usd: 2200,
      },
      {
        hours: 24,
        on_hand_usd: 5800,
        five_hour_refill_usd: 0,
        week_refill_usd: 1400,
        with_resets_usd: 7200,
      },
      {
        hours: 168,
        on_hand_usd: 6600,
        five_hour_refill_usd: 0,
        week_refill_usd: 17100,
        with_resets_usd: 23700,
      },
    ],
    resets: [
      {
        credential_id: 11,
        email_mask: 'a***@x.io',
        window: 'five_hour',
        at_ms: NOW + 2 * HOUR,
        adds_usd: 400,
      },
      {
        credential_id: 12,
        email_mask: 'b***@x.io',
        window: 'seven_day',
        at_ms: NOW + 12 * HOUR,
        adds_usd: 1400,
      },
      {
        credential_id: 13,
        email_mask: 'c***@x.io',
        window: 'seven_day',
        at_ms: NOW + 96 * HOUR,
        adds_usd: 1300,
      },
    ],
    sample_hours: SAMPLE_HOURS,
    models: [
      // The last hour ran hot: the day runs short under it.
      outlookModel('linear_1h', {
        rate_usd_per_hour: 300,
        average_usd_per_hour: 300,
        week_load: 2.13,
        windows: [
          outlookWindow(5, { demand_usd: 1500 }),
          outlookWindow(24, {
            demand_usd: 7200,
            served_usd: 6900,
            short_usd: 300,
            short_hours: 1,
            first_short_hours: 22,
          }),
          outlookWindow(168, {
            demand_usd: 50400,
            served_usd: 23700,
            short_usd: 26700,
            short_hours: 89,
            first_short_hours: 22,
          }),
        ],
      }),
      outlookModel('linear_12h', { available: false }),
      outlookModel('linear_24h'),
      outlookModel('history', {
        rate_usd_per_hour: 150,
        average_usd_per_hour: 130,
        week_load: 0.92,
      }),
      smart,
    ],
    growth_per_day: 0.031,
    momentum: 1.12,
    band_forecasts: 40,
    history_hours: 168,
    ...overrides,
  }
}

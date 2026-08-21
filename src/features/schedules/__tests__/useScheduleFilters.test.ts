import { describe, expect, it } from 'vitest'
import { applyAttentionFilter } from '../hooks/useScheduleFilters'
import type { ProcessSchedule } from '../orchestrator'

function makeSchedule(
  id: number,
  overrides: Partial<ProcessSchedule> = {},
): ProcessSchedule {
  return {
    Id: id,
    Name: `Schedule ${id}`,
    Enabled: true,
    folderId: 1,
    folderName: 'Folder',
    ...overrides,
  } as ProcessSchedule
}

describe('applyAttentionFilter', () => {
  it('returns all schedules unchanged when the filter is "none"', () => {
    const schedules = [makeSchedule(1), makeSchedule(2)]
    expect(applyAttentionFilter(schedules, 'none')).toEqual(schedules)
  })

  it('filters to expired and expiring-soon schedules when the filter is "expiring"', () => {
    const expired = makeSchedule(1, {
      StopProcessDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    })
    const expiringSoon = makeSchedule(2, {
      StopProcessDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    const farOut = makeSchedule(3, {
      StopProcessDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    })
    const noStopDate = makeSchedule(4)

    const result = applyAttentionFilter([expired, expiringSoon, farOut, noStopDate], 'expiring')

    expect(result).toEqual([expired, expiringSoon])
  })

  it('filters to only auto-disabled schedules when the filter is "expired"', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const autoDisabled = makeSchedule(1, { Enabled: false, StopProcessDate: past })
    // Still enabled: Orchestrator has not stopped it, so it is "expiring", not auto-disabled.
    const expiredStillEnabled = makeSchedule(2, { Enabled: true, StopProcessDate: past })
    const disabledByHand = makeSchedule(3, { Enabled: false })
    const disabledExpiringSoon = makeSchedule(4, {
      Enabled: false,
      StopProcessDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const result = applyAttentionFilter(
      [autoDisabled, expiredStillEnabled, disabledByHand, disabledExpiringSoon],
      'expired',
    )

    expect(result).toEqual([autoDisabled])
  })

  it('widens the "expiring" set as the horizon grows', () => {
    const in90Days = makeSchedule(1, {
      StopProcessDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    })
    const in2Years = makeSchedule(2, {
      StopProcessDate: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString(),
    })
    const schedules = [in90Days, in2Years]

    expect(applyAttentionFilter(schedules, 'expiring', undefined, undefined, undefined, 14)).toEqual([])
    expect(applyAttentionFilter(schedules, 'expiring', undefined, undefined, undefined, 90)).toEqual([in90Days])
    expect(applyAttentionFilter(schedules, 'expiring', undefined, undefined, undefined, 365)).toEqual([in90Days])
    // Nothing reaches two years, so the widest preset still excludes it.
    expect(
      applyAttentionFilter(schedules, 'expiring', undefined, undefined, undefined, 365),
    ).not.toContain(in2Years)
  })

  it('does not move the "expired" set when the horizon changes', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const autoDisabled = makeSchedule(1, { Enabled: false, StopProcessDate: past })
    const disabledFarFuture = makeSchedule(2, {
      Enabled: false,
      StopProcessDate: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString(),
    })
    const schedules = [autoDisabled, disabledFarFuture]

    for (const horizon of [14, 30, 90, 365]) {
      expect(
        applyAttentionFilter(schedules, 'expired', undefined, undefined, undefined, horizon),
      ).toEqual([autoDisabled])
    }
  })

  it('defaults to the 14-day window when no horizon is passed', () => {
    const in30Days = makeSchedule(1, {
      StopProcessDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })

    expect(applyAttentionFilter([in30Days], 'expiring')).toEqual([])
    expect(applyAttentionFilter([in30Days], 'expiring', undefined, undefined, undefined, 30)).toEqual([in30Days])
  })

  it('round-trips back to the full set when toggled back to "none"', () => {
    const schedules = [
      makeSchedule(1, { StopProcessDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }),
      makeSchedule(2),
    ]

    const filtered = applyAttentionFilter(schedules, 'expiring')
    const restored = applyAttentionFilter(schedules, 'none')

    expect(filtered).toHaveLength(1)
    expect(restored).toEqual(schedules)
  })
})

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

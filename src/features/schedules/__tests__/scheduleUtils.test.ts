import { describe, expect, it } from 'vitest'
import {
  buildEffectiveScheduleMachineIds,
  deriveFolderScopeSelection,
  deriveMachineScopeSelection,
  formatRobotDisplayName,
  fullDateTimeLabel,
  getLifecycleStatus,
  getScheduleOccurrences,
  isAutoDisabledByStopDate,
  isLifecycleAttention,
  isStaleSchedule,
  lifecycleEndLabel,
} from '../scheduleUtils'
import { EXPIRING_SOON_DAYS } from '../constants'
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

describe('formatRobotDisplayName', () => {
  it('strips the @domain-type suffix to the account portion (domain-agnostic)', () => {
    expect(formatRobotDisplayName('automationbot@example.com-unattended')).toBe('automationbot')
    expect(formatRobotDisplayName('aracely_falciola@acme.example.com-attended')).toBe('aracely_falciola')
    expect(formatRobotDisplayName('svc-bot@contoso.org-unattended')).toBe('svc-bot')
  })

  it('preserves a leading domain in the account portion', () => {
    expect(formatRobotDisplayName('autogen\\user@corp.example.com-attended')).toBe('autogen\\user')
  })

  it('returns the input unchanged when there is no "@"', () => {
    expect(formatRobotDisplayName('.\\local-robot-vm')).toBe('.\\local-robot-vm')
    expect(formatRobotDisplayName('Robot 11145')).toBe('Robot 11145')
  })

  it('falls back to the original when the account portion would be empty', () => {
    expect(formatRobotDisplayName('@only-domain')).toBe('@only-domain')
  })
})

describe('buildEffectiveScheduleMachineIds', () => {
  it('uses the direct scheduled-job machine when present (release fallback ignored)', () => {
    const s = makeSchedule(1, { ReleaseId: 50 })
    const direct = new Map<number, number[]>([[1, [900]]])
    const release = new Map<number, number[]>([[50, [999]]])
    const eff = buildEffectiveScheduleMachineIds([s], direct, release)
    expect(eff.get(1)).toEqual([900])
  })

  it('falls back to the release machines only when there is no direct machine', () => {
    const s = makeSchedule(1, { ReleaseId: 50 })
    const direct = new Map<number, number[]>()
    const release = new Map<number, number[]>([[50, [999]]])
    const eff = buildEffectiveScheduleMachineIds([s], direct, release)
    expect(eff.get(1)).toEqual([999])
  })

  it('omits schedules with neither a direct nor a release machine', () => {
    const s = makeSchedule(1, { ReleaseId: 50 })
    const eff = buildEffectiveScheduleMachineIds([s], new Map(), new Map())
    expect(eff.has(1)).toBe(false)
  })

  it('ignores release fallback when the schedule has no ReleaseId', () => {
    const s = makeSchedule(1)
    const release = new Map<number, number[]>([[50, [999]]])
    const eff = buildEffectiveScheduleMachineIds([s], new Map(), release)
    expect(eff.has(1)).toBe(false)
  })
})

describe('deriveMachineScopeSelection', () => {
  it('returns folders + robots of schedules that ran on the selected machine', () => {
    const s1 = makeSchedule(1, {
      folderId: 10,
      MachineRobots: [{ MachineId: null, MachineName: null, RobotId: 201, RobotUserName: 'r1', SessionId: null, SessionName: null }],
    })
    const s2 = makeSchedule(2, {
      folderId: 20,
      MachineRobots: [{ MachineId: null, MachineName: null, RobotId: 202, RobotUserName: 'r2', SessionId: null, SessionName: null }],
    })
    const effective = new Map<number, number[]>([[1, [900]], [2, [901]]])
    const result = deriveMachineScopeSelection([s1, s2], effective, [900])
    expect(result.folderIds).toEqual(['10'])
    expect(result.robotIds).toEqual([201])
  })

  it('returns empty selection when no machines are selected', () => {
    const s1 = makeSchedule(1, { folderId: 10 })
    const effective = new Map<number, number[]>([[1, [900]]])
    expect(deriveMachineScopeSelection([s1], effective, [])).toEqual({ folderIds: [], robotIds: [] })
  })

  it('dedupes folders + robots across multiple matched schedules', () => {
    const s1 = makeSchedule(1, {
      folderId: 10,
      MachineRobots: [{ MachineId: null, MachineName: null, RobotId: 201, RobotUserName: 'r1', SessionId: null, SessionName: null }],
    })
    const s2 = makeSchedule(2, {
      folderId: 10,
      MachineRobots: [{ MachineId: null, MachineName: null, RobotId: 201, RobotUserName: 'r1', SessionId: null, SessionName: null }],
    })
    const effective = new Map<number, number[]>([[1, [900]], [2, [900]]])
    const result = deriveMachineScopeSelection([s1, s2], effective, [900])
    expect(result.folderIds).toEqual(['10'])
    expect(result.robotIds).toEqual([201])
  })
})

describe('deriveFolderScopeSelection', () => {
  const withRobot = (robotId: number) => ({
    MachineRobots: [
      { MachineId: null, MachineName: null, RobotId: robotId, RobotUserName: `r${robotId}`, SessionId: null, SessionName: null },
    ],
  })

  it('returns the machines + robots of schedules in the selected folder(s)', () => {
    const s1 = makeSchedule(1, { folderId: 10, ...withRobot(201) })
    const s2 = makeSchedule(2, { folderId: 20, ...withRobot(202) })
    const effective = new Map<number, number[]>([[1, [900]], [2, [901]]])
    const result = deriveFolderScopeSelection([s1, s2], effective, ['10'])
    expect(result.machineIds).toEqual([900])
    expect(result.robotIds).toEqual([201])
  })

  it('returns empty selection when no folders are selected', () => {
    const s1 = makeSchedule(1, { folderId: 10, ...withRobot(201) })
    const effective = new Map<number, number[]>([[1, [900]]])
    expect(deriveFolderScopeSelection([s1], effective, [])).toEqual({ machineIds: [], robotIds: [] })
  })

  it('dedupes machines + robots across multiple schedules in the selected folders', () => {
    const s1 = makeSchedule(1, { folderId: 10, ...withRobot(201) })
    const s2 = makeSchedule(2, { folderId: 10, ...withRobot(201) })
    const effective = new Map<number, number[]>([[1, [900]], [2, [900]]])
    const result = deriveFolderScopeSelection([s1, s2], effective, ['10'])
    expect(result.machineIds).toEqual([900])
    expect(result.robotIds).toEqual([201])
  })

  it('contributes robots but no machines for dynamic-allocation folders (no job-history machine)', () => {
    const s1 = makeSchedule(1, { folderId: 10, ...withRobot(201) })
    const result = deriveFolderScopeSelection([s1], new Map(), ['10'])
    expect(result.machineIds).toEqual([])
    expect(result.robotIds).toEqual([201])
  })
})

describe('getLifecycleStatus', () => {
  const now = new Date(2026, 4, 6, 12, 0, 0).getTime()

  it('returns null when there is no StopProcessDate', () => {
    const s = makeSchedule(1)
    expect(getLifecycleStatus(s, now)).toBeNull()
  })

  it('returns "expired" when the stop date has already passed', () => {
    const s = makeSchedule(1, { StopProcessDate: new Date(now - 24 * 60 * 60 * 1000).toISOString() })
    expect(getLifecycleStatus(s, now)).toBe('expired')
  })

  it('returns "expiring-soon" at the EXPIRING_SOON_DAYS boundary', () => {
    const s = makeSchedule(1, {
      StopProcessDate: new Date(now + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(getLifecycleStatus(s, now)).toBe('expiring-soon')
  })

  it('returns "ending" for a stop date beyond the expiring-soon window', () => {
    const s = makeSchedule(1, {
      StopProcessDate: new Date(now + (EXPIRING_SOON_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(getLifecycleStatus(s, now)).toBe('ending')
  })

  it('applies to queue triggers too, unlike the isQueueTrigger-gated cron logic elsewhere', () => {
    const s = makeSchedule(1, {
      QueueDefinitionId: 9001,
      StopProcessDate: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(getLifecycleStatus(s, now)).toBe('expired')
  })
})

describe('isLifecycleAttention', () => {
  it('flags only the statuses the Expiring metric counts', () => {
    expect(isLifecycleAttention('expired')).toBe(true)
    expect(isLifecycleAttention('expiring-soon')).toBe(true)
  })

  it('excludes a far-future stop date and a missing one', () => {
    expect(isLifecycleAttention('ending')).toBe(false)
    expect(isLifecycleAttention(null)).toBe(false)
  })
})

const dailyAt10 = (overrides: Partial<ProcessSchedule> = {}) =>
  makeSchedule(1, {
    StartProcessCron: '0 0 10 1/1 * ?',
    StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 10, atMinute: 0 } }),
    StartProcessCronSummary: 'At 10:00 AM',
    ...overrides,
  })

describe('StopProcessDate clamps occurrence generation', () => {
  it('generates no runs when the whole window is past the stop date', () => {
    const schedule = dailyAt10({ StopProcessDate: new Date(2026, 4, 1).toISOString() })

    expect(getScheduleOccurrences(schedule, new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59))).toEqual([])
  })

  it('keeps runs up to the stop date and drops the ones after it', () => {
    const schedule = dailyAt10({ StopProcessDate: new Date(2026, 4, 5, 12, 0, 0).toISOString() })
    const occurrences = getScheduleOccurrences(schedule, new Date(2026, 4, 1), new Date(2026, 4, 10, 23, 59, 59))

    expect(occurrences.map((occurrence) => occurrence.date.getDate())).toEqual([1, 2, 3, 4, 5])
  })

  it('ignores a stop date it cannot parse rather than dropping every run', () => {
    const schedule = dailyAt10({ StopProcessDate: 'not-a-date' })

    expect(getScheduleOccurrences(schedule, new Date(2026, 4, 1), new Date(2026, 4, 3, 23, 59, 59))).toHaveLength(3)
  })
})

describe('isStaleSchedule and StopProcessDate', () => {
  const now = new Date(2026, 7, 20, 12, 0, 0).getTime()

  it('flags an expired trigger as stale even when Orchestrator still reports a next run', () => {
    const schedule = dailyAt10({
      // Orchestrator has not cleared this yet, but the trigger stopped 5 days ago.
      StartProcessNextOccurrence: new Date(2026, 7, 25, 10, 0, 0).toISOString(),
      StopProcessDate: new Date(2026, 7, 15).toISOString(),
    })

    expect(isStaleSchedule(schedule, now)).toBe(true)
  })

  it('leaves a trigger alone while its stop date is still ahead', () => {
    const schedule = dailyAt10({ StopProcessDate: new Date(2026, 8, 20).toISOString() })

    expect(isStaleSchedule(schedule, now)).toBe(false)
  })
})

describe('isAutoDisabledByStopDate', () => {
  const now = new Date(2026, 7, 20, 12, 0, 0).getTime()
  const past = new Date(2026, 7, 15).toISOString()

  it('flags a disabled trigger whose stop date has passed', () => {
    expect(isAutoDisabledByStopDate(makeSchedule(1, { Enabled: false, StopProcessDate: past }), now)).toBe(true)
  })

  it('does not flag one that is still enabled — Orchestrator has not stopped it yet', () => {
    expect(isAutoDisabledByStopDate(makeSchedule(1, { Enabled: true, StopProcessDate: past }), now)).toBe(false)
  })

  it('does not flag a trigger someone disabled that has no stop date', () => {
    expect(isAutoDisabledByStopDate(makeSchedule(1, { Enabled: false }), now)).toBe(false)
  })

  it('does not flag a disabled trigger whose stop date is still ahead', () => {
    const soon = new Date(2026, 7, 23).toISOString()
    expect(isAutoDisabledByStopDate(makeSchedule(1, { Enabled: false, StopProcessDate: soon }), now)).toBe(false)
  })
})

describe('lifecycleEndLabel', () => {
  const now = new Date(2026, 7, 20, 12, 0, 0).getTime()

  it('uses the past tense once the stop date has gone by', () => {
    const schedule = makeSchedule(1, { StopProcessDate: new Date(2026, 7, 15).toISOString() })
    expect(lifecycleEndLabel(schedule, new Date(2026, 7, 15), now)).toMatch(/^Ended on /)
  })

  it('uses the future tense while the stop date is still ahead', () => {
    const schedule = makeSchedule(1, { StopProcessDate: new Date(2026, 7, 23).toISOString() })
    expect(lifecycleEndLabel(schedule, new Date(2026, 7, 23), now)).toMatch(/^Ends /)
  })

  it('is unaffected by whether Orchestrator has disabled the trigger yet', () => {
    const stop = new Date(2026, 7, 15).toISOString()
    const stillEnabled = makeSchedule(1, { Enabled: true, StopProcessDate: stop })
    const disabled = makeSchedule(2, { Enabled: false, StopProcessDate: stop })

    expect(lifecycleEndLabel(stillEnabled, new Date(stop), now)).toMatch(/^Ended on /)
    expect(lifecycleEndLabel(disabled, new Date(stop), now)).toMatch(/^Ended on /)
  })
})

describe('fullDateTimeLabel', () => {
  it('renders a stop date in the schedule timezone, not the viewer timezone', () => {
    // 04:30 UTC is the previous day in Chicago but the same day in Tokyo — the exact case that made
    // the day-details "Ends" line disagree with the trigger's own timezone label.
    const instant = new Date('2026-09-01T04:30:00.000Z')

    expect(fullDateTimeLabel(instant, 'America/Chicago')).toContain('August 31')
    expect(fullDateTimeLabel(instant, 'Asia/Tokyo')).toContain('September 1')
  })

  it('names the zone so the instant is unambiguous', () => {
    expect(fullDateTimeLabel(new Date('2026-09-01T04:30:00.000Z'), 'Asia/Tokyo')).toMatch(/GMT\+9|JST/)
  })
})

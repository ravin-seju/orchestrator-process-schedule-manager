import { describe, expect, it } from 'vitest'
import { applyAttentionFilter } from '@/features/schedules/hooks/useScheduleFilters'
import type { ProcessSchedule } from '@/features/schedules/orchestrator'

function makeSchedule(
  id: number,
  cronExpression: string,
  machineIds: number[] = [],
  overrides: Partial<ProcessSchedule> = {},
): ProcessSchedule {
  return {
    Id: id,
    Name: `Schedule ${id}`,
    folderId: 1,
    folderName: 'Folder',
    Enabled: true,
    StartProcessCron: cronExpression,
    StartProcessCronSummary: `Every day at ${id}:00`,
    StartProcessCronDetails: null,
    StartProcessNextOccurrence: null,
    ReleaseId: id,
    ReleaseKey: `key-${id}`,
    ReleaseName: `Release ${id}`,
    PackageName: null,
    QueueDefinitionId: null,
    TimeZoneId: null,
    TimeZoneIana: null,
    MachineRobots: machineIds.map((mid) => ({
      MachineId: mid,
      MachineName: `Machine ${mid}`,
      RobotId: null,
      RobotName: null,
    })),
    ...overrides,
  } as ProcessSchedule
}

// Two schedules fire at the exact same minute: 9:00 AM daily
const SAME_TIME_CRON = '0 0 9 * * ?'

describe('applyAttentionFilter — collisions', () => {
  it('finds org-wide collisions when no machine scope is provided', () => {
    const s1 = makeSchedule(1, SAME_TIME_CRON, [10])
    const s2 = makeSchedule(2, SAME_TIME_CRON, [20])
    const result = applyAttentionFilter([s1, s2], 'collisions')
    expect(result).toHaveLength(2)
    expect(result).toContain(s1)
    expect(result).toContain(s2)
  })

  it('returns empty collision set when machine scope is active and schedules share no machine', () => {
    const s1 = makeSchedule(1, SAME_TIME_CRON, [10])
    const s2 = makeSchedule(2, SAME_TIME_CRON, [20])
    // Scope to machine 10 — s2 is not on machine 10, so no per-machine collision
    const machineScope = new Set([10])
    const result = applyAttentionFilter([s1, s2], 'collisions', machineScope)
    expect(result).toHaveLength(0)
  })

  it('detects collisions when two schedules share a machine in scope', () => {
    const sharedMachine = 42
    const s1 = makeSchedule(1, SAME_TIME_CRON, [sharedMachine])
    const s2 = makeSchedule(2, SAME_TIME_CRON, [sharedMachine])
    const machineScope = new Set([sharedMachine])
    const result = applyAttentionFilter([s1, s2], 'collisions', machineScope)
    expect(result).toHaveLength(2)
    expect(result).toContain(s1)
    expect(result).toContain(s2)
  })

  it('multi-machine schedule contributes once per machine in scope', () => {
    // s1 is on machines 10 and 20; s2 is only on machine 10
    const s1 = makeSchedule(1, SAME_TIME_CRON, [10, 20])
    const s2 = makeSchedule(2, SAME_TIME_CRON, [10])
    const machineScope = new Set([10])
    const result = applyAttentionFilter([s1, s2], 'collisions', machineScope)
    expect(result).toHaveLength(2)
  })

  it('skips queue triggers under machine scope', () => {
    const sharedMachine = 99
    const s1 = makeSchedule(1, SAME_TIME_CRON, [sharedMachine])
    const s2 = makeSchedule(2, SAME_TIME_CRON, [sharedMachine], { QueueDefinitionId: 5 })
    const machineScope = new Set([sharedMachine])
    const result = applyAttentionFilter([s1, s2], 'collisions', machineScope)
    // s2 is a queue trigger — must not appear in collision result
    expect(result).not.toContain(s2)
  })

  it('empty machine scope behaves identically to no scope (org-wide buckets)', () => {
    const s1 = makeSchedule(1, SAME_TIME_CRON, [10])
    const s2 = makeSchedule(2, SAME_TIME_CRON, [20])
    const noScope = applyAttentionFilter([s1, s2], 'collisions')
    const emptyScope = applyAttentionFilter([s1, s2], 'collisions', new Set())
    expect(emptyScope).toHaveLength(noScope.length)
  })
})

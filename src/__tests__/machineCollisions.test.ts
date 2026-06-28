import { describe, expect, it } from 'vitest'
import { applyAttentionFilter } from '@/features/schedules/hooks/useScheduleFilters'
import { buildEffectiveScheduleMachineIds } from '@/features/schedules/scheduleUtils'
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
      RobotUserName: null,
      SessionId: null,
      SessionName: null,
    })),
    ...overrides,
  } as ProcessSchedule
}

// Build a schedule whose MachineRobots carry RobotId but null MachineId —
// the modern-folder dynamic-allocation shape (machine resolved at runtime).
function makeRobotSchedule(
  id: number,
  cronExpression: string,
  robotIds: number[] = [],
  overrides: Partial<ProcessSchedule> = {},
): ProcessSchedule {
  const base = makeSchedule(id, cronExpression, [], overrides)
  return {
    ...base,
    MachineRobots: robotIds.map((rid) => ({
      MachineId: null,
      MachineName: null,
      RobotId: rid,
      RobotUserName: `robot-${rid}`,
      SessionId: null,
      SessionName: null,
    })),
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

describe('applyAttentionFilter — collisions (robot scope)', () => {
  it('empty machine+robot scope leaves org-wide buckets unchanged (regression guard)', () => {
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [100])
    const s2 = makeRobotSchedule(2, SAME_TIME_CRON, [200])
    const orgWide = applyAttentionFilter([s1, s2], 'collisions')
    const emptyScopes = applyAttentionFilter([s1, s2], 'collisions', new Set(), new Set())
    expect(orgWide).toHaveLength(2)
    expect(emptyScopes).toHaveLength(orgWide.length)
  })

  it('per-(robot, minute): detects collision when two schedules share a robot in scope', () => {
    const sharedRobot = 555
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [sharedRobot])
    const s2 = makeRobotSchedule(2, SAME_TIME_CRON, [sharedRobot])
    const result = applyAttentionFilter([s1, s2], 'collisions', undefined, new Set([sharedRobot]))
    expect(result).toHaveLength(2)
    expect(result).toContain(s1)
    expect(result).toContain(s2)
  })

  it('no collision when scoped schedules fire at the same minute on different robots', () => {
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [100])
    const s2 = makeRobotSchedule(2, SAME_TIME_CRON, [200])
    const result = applyAttentionFilter([s1, s2], 'collisions', undefined, new Set([100, 200]))
    expect(result).toHaveLength(0)
  })

  it('skips schedules with null RobotId under robot scope', () => {
    const sharedRobot = 777
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [sharedRobot])
    // s2 has a MachineRobots entry with null RobotId (dynamic, no specific robot)
    const s2 = makeSchedule(2, SAME_TIME_CRON, [10]) // MachineId set, RobotId null
    const result = applyAttentionFilter([s1, s2], 'collisions', undefined, new Set([sharedRobot]))
    // s1 alone on its robot bucket → no collision; s2 has no in-scope robot → skipped
    expect(result).toHaveLength(0)
  })

  it('multi-robot schedule contributes once per robot in scope', () => {
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [100, 200])
    const s2 = makeRobotSchedule(2, SAME_TIME_CRON, [100])
    const result = applyAttentionFilter([s1, s2], 'collisions', undefined, new Set([100]))
    expect(result).toHaveLength(2)
    expect(result).toContain(s1)
    expect(result).toContain(s2)
  })
})

describe('applyAttentionFilter — collisions (machine scope from job history map)', () => {
  it('resolves a schedule\'s machine from scheduleMachineIds, not inline MachineRobots', () => {
    // Schedules carry NO inline machine (dynamic allocation) — machine comes from job history.
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [11145])
    const s2 = makeRobotSchedule(2, SAME_TIME_CRON, [11145])
    const sharedMachine = 65092
    const scheduleMachineIds = new Map<number, number[]>([
      [1, [sharedMachine]],
      [2, [sharedMachine]],
    ])
    // Without the map, inline MachineRobots have null MachineId → no machine collision.
    const noMap = applyAttentionFilter([s1, s2], 'collisions', new Set([sharedMachine]))
    expect(noMap).toHaveLength(0)
    // With the map, both schedules resolve to the same runtime machine → collide.
    const withMap = applyAttentionFilter([s1, s2], 'collisions', new Set([sharedMachine]), undefined, scheduleMachineIds)
    expect(withMap).toHaveLength(2)
    expect(withMap).toContain(s1)
    expect(withMap).toContain(s2)
  })

  it('skips schedules with no machine in the job-history map under machine scope', () => {
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [11145])
    const s2 = makeRobotSchedule(2, SAME_TIME_CRON, [11145])
    // Only s1 ran on the scoped machine; s2 has no job-history machine.
    const scheduleMachineIds = new Map<number, number[]>([[1, [65092]]])
    const result = applyAttentionFilter([s1, s2], 'collisions', new Set([65092]), undefined, scheduleMachineIds)
    expect(result).toHaveLength(0) // s1 alone in its bucket, s2 skipped
  })
})

describe('applyAttentionFilter — collisions ignore release-fallback machines', () => {
  it('same-release schedules with no direct machine do not collide via the release fallback', () => {
    // Two triggers on one process (shared ReleaseId), neither with a direct scheduled-run machine.
    const s1 = makeRobotSchedule(1, SAME_TIME_CRON, [100], { ReleaseId: 50 })
    const s2 = makeRobotSchedule(2, SAME_TIME_CRON, [200], { ReleaseId: 50 })
    const direct = new Map<number, number[]>() // neither has a direct (scheduled-run) machine
    const releaseFallback = new Map<number, number[]>([[50, [999]]])
    const effective = buildEffectiveScheduleMachineIds([s1, s2], direct, releaseFallback)
    const machineScope = new Set([999])

    // Feeding the EFFECTIVE map (release fallback inflates both to [999]) would be a false positive:
    expect(applyAttentionFilter([s1, s2], 'collisions', machineScope, undefined, effective)).toHaveLength(2)
    // The fix feeds the DIRECT map → neither schedule has machine 999 → no phantom collision:
    expect(applyAttentionFilter([s1, s2], 'collisions', machineScope, undefined, direct)).toHaveLength(0)
  })
})

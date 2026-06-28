import { describe, expect, it } from 'vitest'
import {
  buildEffectiveScheduleMachineIds,
  deriveFolderScopeSelection,
  deriveMachineScopeSelection,
  formatRobotDisplayName,
} from '../scheduleUtils'
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

import { describe, expect, it } from 'vitest'
import type { UsageEntry } from '@/features/jobs/orchestrator'
import type { FolderRuntimeEntry } from '@/features/machines/orchestrator'
import { buildUtilizationModel, utilizationTone, type UtilizationInput } from '@/features/utilization/model'

const hours = (h: number) => h * 3600

const usageOf = (folderId: number, runtimeType: string | null, robotId: number | null, h: number): UsageEntry => ({
  folderId,
  runtimeType,
  robotId,
  sec: hours(h),
})

const rt = (folderId: number, runtimeType: string, total: number): FolderRuntimeEntry => ({ folderId, runtimeType, total })

const input = (overrides: Partial<UtilizationInput> = {}): UtilizationInput => ({
  folderRuntimes: [rt(100, 'Unattended', 8), rt(100, 'TestAutomation', 2), rt(200, 'Unattended', 6)],
  usage: [usageOf(100, 'Unattended', 1, 1800), usageOf(200, 'Unattended', 2, 720), usageOf(200, 'Serverless', 2, 360)],
  excludedFolderIds: new Set(),
  sinceDays: 30,
  robotNames: new Map([[1, 'Bot.Alpha'], [2, 'Bot.Beta']]),
  folderNames: new Map([[100, 'Finance'], [200, 'Shared']]),
  ...overrides,
})

describe('buildUtilizationModel capacity', () => {
  it('adds up counted runtime types per folder and takes the largest folder', () => {
    const model = buildUtilizationModel(input())
    expect(model.source).toBe('runtimes')
    expect(model.capacityRuntimes).toBe(10)
    expect(model.capacityFolderName).toBe('Finance')
    expect(model.capacityHours).toBe(7200)
  })

  it('counts production and testing types but not development or agentic ones', () => {
    const model = buildUtilizationModel(
      input({
        folderRuntimes: [
          rt(100, 'Unattended', 2),
          rt(100, 'AutomationCloud', 1),
          rt(100, 'NonProduction', 1),
          rt(100, 'Development', 5),
          rt(100, 'AgentService', 4),
          rt(100, 'Headless', 3),
        ],
      }),
    )
    expect(model.capacityRuntimes).toBe(4)
  })

  it('leaves excluded folders out of capacity', () => {
    const model = buildUtilizationModel(input({ excludedFolderIds: new Set([100]) }))
    expect(model.capacityRuntimes).toBe(6)
    expect(model.capacityFolderName).toBe('Shared')
  })

  it('has no capacity when no folder reports a counted runtime', () => {
    const model = buildUtilizationModel(input({ folderRuntimes: [rt(100, 'Development', 3)] }))
    expect(model.source).toBeNull()
    expect(model.capacityRuntimes).toBeNull()
    expect(model.capacityHours).toBeNull()
    expect(model.idleHours).toBeNull()
    expect(model.utilizationPct).toBeNull()
    expect(model.displayPct).toBeNull()
    expect(model.consumedHours).toBe(2880)
  })
})

describe('buildUtilizationModel consumed', () => {
  it('sums counted job time and works out utilization and idle hours', () => {
    const model = buildUtilizationModel(input())
    expect(model.consumedHours).toBe(2880)
    expect(model.idleHours).toBe(4320)
    expect(model.utilizationPct).toBeCloseTo(40)
    expect(model.displayPct).toBeCloseTo(40)
    expect(model.consumedFolderCount).toBe(2)
  })

  it('leaves out jobs on uncounted runtime types', () => {
    const model = buildUtilizationModel(
      input({ usage: [usageOf(100, 'Unattended', 1, 100), usageOf(100, 'Development', 1, 50), usageOf(100, null, 1, 25)] }),
    )
    expect(model.consumedHours).toBe(100)
    expect(model.robots).toEqual([
      { id: 1, name: 'Bot.Alpha', hours: 100, sharePct: 100, runtimeTypes: [{ label: 'Unattended', hours: 100 }] },
    ])
  })

  it('leaves out personal workspaces and reports what was left out', () => {
    const model = buildUtilizationModel(
      input({
        usage: [usageOf(100, 'Unattended', 1, 100), usageOf(300, 'Serverless', 9, 4), usageOf(300, 'Development', 9, 2)],
        excludedFolderIds: new Set([300]),
        robotNames: new Map([[1, 'Bot.Alpha'], [9, 'someone-attended']]),
      }),
    )
    expect(model.consumedHours).toBe(100)
    expect(model.excludedHours).toBe(6)
    expect(model.robots.map((r) => r.name)).toEqual(['Bot.Alpha'])
    expect(model.rootFolders.map((f) => f.name)).toEqual(['Finance'])
  })

  it('clamps the display value above 100% but keeps the raw ratio', () => {
    // 1 runtime x 24 h x 30 days = 720 h against 2,880 h consumed: the lower bound was too low.
    const model = buildUtilizationModel(input({ folderRuntimes: [rt(100, 'Unattended', 1)] }))
    expect(model.utilizationPct).toBeCloseTo(400)
    expect(model.displayPct).toBe(100)
    expect(model.idleHours).toBe(0)
  })

  it('returns zero shares instead of dividing by zero when nothing ran', () => {
    const model = buildUtilizationModel(input({ usage: [] }))
    expect(model.consumedHours).toBe(0)
    expect(model.utilizationPct).toBe(0)
    expect(model.robots).toEqual([])
    expect(model.rootFolders).toEqual([])
  })
})

describe('buildUtilizationModel tables', () => {
  it('sorts robots by hours, with a share of consumed time and a fallback name', () => {
    const model = buildUtilizationModel(input({ robotNames: new Map([[1, 'Bot.Alpha']]) }))
    expect(model.robots.map(({ name, hours, sharePct }) => ({ name, hours, sharePct }))).toEqual([
      { name: 'Bot.Alpha', hours: 1800, sharePct: 62.5 },
      { name: 'Robot 2', hours: 1080, sharePct: 37.5 },
    ])
  })

  it('lists the runtime types each robot ran on, most hours first', () => {
    const model = buildUtilizationModel(input())
    expect(model.robots[1].runtimeTypes).toEqual([
      { label: 'Unattended', hours: 720 },
      { label: 'Cloud Serverless', hours: 360 },
    ])
  })

  it('lists only robots with counted time', () => {
    const model = buildUtilizationModel(
      input({ robotNames: new Map([[1, 'Bot.Alpha'], [2, 'Bot.Beta'], [3, 'Bot.Idle']]) }),
    )
    expect(model.robots.map((r) => r.name)).toEqual(['Bot.Alpha', 'Bot.Beta'])
  })

  it('reports root folders as a share of consumed hours, with a fallback name', () => {
    const model = buildUtilizationModel(input({ folderNames: new Map([[100, 'Finance']]) }))
    expect(model.rootFolders).toEqual([
      { name: 'Finance', hours: 1800, sharePct: 62.5, folderCount: 1 },
      { name: 'Folder 200', hours: 1080, sharePct: 37.5, folderCount: 1 },
    ])
  })

  it('rolls sub-folders up into their root folder', () => {
    const model = buildUtilizationModel(
      input({
        usage: [usageOf(100, 'Unattended', 1, 60), usageOf(101, 'Unattended', 1, 30), usageOf(200, 'Unattended', 2, 10)],
        folderNames: new Map([[100, 'Finance'], [101, 'Finance/Onboarding/EMEA'], [200, 'Shared']]),
      }),
    )
    expect(model.rootFolders).toEqual([
      { name: 'Finance', hours: 90, sharePct: 90, folderCount: 2 },
      { name: 'Shared', hours: 10, sharePct: 10, folderCount: 1 },
    ])
    expect(model.consumedFolderCount).toBe(3)
  })

  it('breaks runtimes and hours down by type, counted types first', () => {
    const model = buildUtilizationModel(
      input({
        folderRuntimes: [rt(100, 'Unattended', 8), rt(200, 'Unattended', 6), rt(100, 'Development', 2)],
        usage: [usageOf(100, 'Unattended', 1, 300), usageOf(200, 'Serverless', 2, 50), usageOf(100, 'Development', 3, 400)],
      }),
    )
    expect(model.runtimeTypes).toEqual([
      { type: 'Unattended', label: 'Unattended', counted: true, runtimes: 8, hours: 300 },
      { type: 'Serverless', label: 'Cloud Serverless', counted: true, runtimes: 0, hours: 50 },
      { type: 'Development', label: 'Development', counted: false, runtimes: 2, hours: 400 },
    ])
  })
})

describe('utilizationTone', () => {
  it('splits at 50% and 85%', () => {
    expect(utilizationTone(49.9)).toBe('low')
    expect(utilizationTone(50)).toBe('medium')
    expect(utilizationTone(85)).toBe('medium')
    expect(utilizationTone(85.1)).toBe('high')
  })
})

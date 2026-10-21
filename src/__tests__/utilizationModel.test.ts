import { describe, expect, it } from 'vitest'
import type { UsageEntry } from '@/features/jobs/orchestrator'
import type { FolderRuntimeEntry } from '@/features/machines/orchestrator'
import { buildUtilizationModel, utilizationTone, type UtilizationInput } from '@/features/utilization/model'

const hours = (h: number) => h * 3600

const usageOf = (
  folderId: number,
  runtimeType: string | null,
  robotId: number | null,
  h: number,
  extra: Partial<UsageEntry> = {},
): UsageEntry => ({
  folderId,
  runtimeType,
  robotId,
  sec: hours(h),
  failedSec: 0,
  // All of it in the 10:00 hour unless a test says otherwise.
  byHour: Array.from({ length: 24 }, (_, hour) => (hour === 10 ? hours(h) : 0)),
  waitSec: 0,
  waitCount: 0,
  waitBuckets: [0, 0, 0, 0, 0],
  ...extra,
})

const rt = (folderId: number, runtimeType: string, total: number, connected = total, available = 0): FolderRuntimeEntry => ({
  folderId,
  runtimeType,
  total,
  connected,
  available,
})

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
    expect(model.robots).toMatchObject([
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
    expect(model.rootFolders.filter((f) => !f.idle).map((f) => f.name)).toEqual(['Finance'])
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
    // Folders with runtimes still show, as idle.
    expect(model.rootFolders.every((f) => f.idle && f.hours === 0)).toBe(true)
    expect(model.peakHour).toBeNull()
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
    expect(model.rootFolders).toMatchObject([
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
    expect(model.rootFolders).toMatchObject([
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
    expect(model.runtimeTypes).toMatchObject([
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

describe('buildUtilizationModel operational signals', () => {
  it('reads live status from the capacity folder only, so shared pools are not double-counted', () => {
    const model = buildUtilizationModel(
      input({ folderRuntimes: [rt(100, 'Unattended', 8, 7, 3), rt(100, 'TestAutomation', 2, 2, 2), rt(200, 'Unattended', 6, 6, 6)] }),
    )
    expect(model.live).toEqual({ folderName: 'Finance', total: 10, busy: 4, idle: 5, offline: 1 })
  })

  it('reports connected and offline runtimes per type from the largest folder of that type', () => {
    const model = buildUtilizationModel(input({ folderRuntimes: [rt(100, 'Unattended', 8, 5), rt(200, 'Unattended', 6, 6)] }))
    expect(model.runtimeTypes[0]).toMatchObject({ type: 'Unattended', runtimes: 8, connected: 5, offline: 3 })
  })

  it('lists roots with runtimes but no counted jobs as idle, last', () => {
    const model = buildUtilizationModel(
      input({
        folderRuntimes: [rt(100, 'Unattended', 8), rt(300, 'Unattended', 3)],
        folderNames: new Map([[100, 'Finance'], [200, 'Shared'], [300, 'Pilot/Team A']]),
      }),
    )
    expect(model.rootFolders.at(-1)).toEqual({ name: 'Pilot', hours: 0, sharePct: 0, folderCount: 1, runtimes: 3, idle: true })
    expect(model.rootFolders[0]).toMatchObject({ name: 'Finance', runtimes: 8, idle: false })
  })

  it('finds the peak hour as average busy runtimes against capacity', () => {
    const byHour = Array.from({ length: 24 }, (_, hour) => (hour === 2 ? hours(240) : hour === 14 ? hours(60) : 0))
    const model = buildUtilizationModel(input({ usage: [usageOf(100, 'Unattended', 1, 300, { byHour })] }))
    // 240 h in the 02:00 hour over 30 days = 8 runtimes busy on average, of 10.
    expect(model.peakHour).toEqual({ hour: 2, avgBusy: 8, pctOfCapacity: 80 })
    expect(model.hourly[14].avgBusy).toBe(2)
    expect(model.hourly).toHaveLength(24)
  })

  it('summarises waits as an average and the share over 5 minutes', () => {
    const model = buildUtilizationModel(
      input({
        usage: [
          usageOf(100, 'Unattended', 1, 10, { waitSec: 1200, waitCount: 4, waitBuckets: [2, 1, 1, 0, 0] }),
          usageOf(100, 'Development', 1, 10, { waitSec: 99999, waitCount: 9, waitBuckets: [0, 0, 0, 0, 9] }),
        ],
      }),
    )
    expect(model.wait).toEqual({ jobCount: 4, avgWaitMin: 5, over5MinPct: 25 })
  })

  it('has no wait summary when no job had a usable creation time', () => {
    expect(buildUtilizationModel(input()).wait).toBeNull()
  })

  it('reports failed time as a share of consumed hours', () => {
    const model = buildUtilizationModel(
      input({ usage: [usageOf(100, 'Unattended', 1, 75, { failedSec: hours(3) }), usageOf(200, 'Unattended', 2, 25)] }),
    )
    expect(model.failedHours).toBe(3)
    expect(model.failedPct).toBeCloseTo(3)
  })

  it('warns about concentration from 50% of hours on one robot account', () => {
    const at = (alpha: number, beta: number) =>
      buildUtilizationModel(input({ usage: [usageOf(100, 'Unattended', 1, alpha), usageOf(200, 'Unattended', 2, beta)] }))
    expect(at(49, 51).concentration).toEqual({ name: 'Bot.Beta', sharePct: 51 })
    expect(at(50, 50).concentration).toMatchObject({ sharePct: 50 })
    expect(buildUtilizationModel(input({ usage: [usageOf(100, 'Unattended', 1, 40), usageOf(200, 'Unattended', 2, 35), usageOf(200, 'Unattended', 3, 25)] })).concentration).toBeNull()
  })

  it('keeps excluded folders out of the new signals too', () => {
    const model = buildUtilizationModel(
      input({
        folderRuntimes: [rt(100, 'Unattended', 4, 4, 1), rt(300, 'Unattended', 9, 1, 0)],
        usage: [usageOf(100, 'Unattended', 1, 10), usageOf(300, 'Unattended', 9, 90, { failedSec: hours(90), waitCount: 5, waitBuckets: [0, 0, 0, 0, 5] })],
        excludedFolderIds: new Set([300]),
      }),
    )
    expect(model.live).toMatchObject({ total: 4, offline: 0 })
    expect(model.failedHours).toBe(0)
    expect(model.wait).toBeNull()
    expect(model.concentration).toMatchObject({ name: 'Bot.Alpha', sharePct: 100 })
  })
})

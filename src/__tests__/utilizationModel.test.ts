import { describe, expect, it } from 'vitest'
import type { RobotUsage } from '@/features/jobs/orchestrator'
import { buildUtilizationModel, utilizationTone, type UtilizationInput } from '@/features/utilization/model'

const hours = (h: number) => h * 3600

const usage = (byRobot: [number, number][], byFolder: [number, number][] = []): RobotUsage => ({
  totalSec: byRobot.reduce((sum, [, sec]) => sum + sec, 0),
  byRobot: new Map(byRobot),
  byFolder: new Map(byFolder),
})

const input = (overrides: Partial<UtilizationInput> = {}): UtilizationInput => ({
  capacityRuntimes: 10,
  usage: usage([[1, hours(1800)], [2, hours(1080)]], [[100, hours(2160)], [200, hours(720)]]),
  sinceDays: 30,
  robotNames: new Map([[1, 'Bot.Alpha'], [2, 'Bot.Beta']]),
  folderNames: new Map([[100, 'Finance'], [200, 'Shared']]),
  ...overrides,
})

describe('buildUtilizationModel', () => {
  it('turns deployed runtimes into robot-hours of capacity', () => {
    const model = buildUtilizationModel(input())
    expect(model.source).toBe('runtimes')
    expect(model.capacityRuntimes).toBe(10)
    expect(model.capacityHours).toBe(7200)
    expect(model.consumedHours).toBe(2880)
    expect(model.idleHours).toBe(4320)
    expect(model.utilizationPct).toBeCloseTo(40)
    expect(model.displayPct).toBeCloseTo(40)
  })

  it('treats zero runtimes as unknown capacity rather than zero', () => {
    const model = buildUtilizationModel(input({ capacityRuntimes: 0 }))
    expect(model.source).toBeNull()
    expect(model.capacityRuntimes).toBeNull()
  })

  it('shows consumed hours only when capacity is unknown', () => {
    const model = buildUtilizationModel(input({ capacityRuntimes: null }))
    expect(model.source).toBeNull()
    expect(model.capacityHours).toBeNull()
    expect(model.idleHours).toBeNull()
    expect(model.utilizationPct).toBeNull()
    expect(model.displayPct).toBeNull()
    expect(model.consumedHours).toBe(2880)
    expect(model.robots).toHaveLength(2)
    expect(model.folders).toHaveLength(2)
  })

  it('clamps the display value above 100% but keeps the raw ratio', () => {
    // 1 runtime x 24 h x 30 days = 720 h against 2,880 h consumed: the lower bound was too low.
    const model = buildUtilizationModel(input({ capacityRuntimes: 1 }))
    expect(model.utilizationPct).toBeCloseTo(400)
    expect(model.displayPct).toBe(100)
    expect(model.idleHours).toBe(0)
  })

  it('sorts robots by hours and gives each a share of consumed time', () => {
    const model = buildUtilizationModel(input())
    expect(model.robots.map((r) => r.name)).toEqual(['Bot.Alpha', 'Bot.Beta'])
    expect(model.robots[0].hours).toBe(1800)
    expect(model.robots[0].sharePct).toBeCloseTo(62.5)
    expect(model.robots[1].sharePct).toBeCloseTo(37.5)
  })

  it('lists a known robot that ran nothing at 0 hours', () => {
    const model = buildUtilizationModel(
      input({ robotNames: new Map([[1, 'Bot.Alpha'], [2, 'Bot.Beta'], [3, 'Bot.Idle']]) }),
    )
    expect(model.robots.at(-1)).toEqual({ id: 3, name: 'Bot.Idle', hours: 0, sharePct: 0 })
  })

  it('names an unknown robot by its id', () => {
    const model = buildUtilizationModel(input({ robotNames: new Map([[1, 'Bot.Alpha']]) }))
    expect(model.robots.map((r) => r.name)).toEqual(['Bot.Alpha', 'Robot 2'])
  })

  it('reports folders as a share of consumed hours, with a fallback name', () => {
    const model = buildUtilizationModel(input({ folderNames: new Map([[100, 'Finance']]) }))
    expect(model.folders).toEqual([
      { id: 100, name: 'Finance', hours: 2160, sharePct: 75 },
      { id: 200, name: 'Folder 200', hours: 720, sharePct: 25 },
    ])
  })

  it('returns zero shares instead of dividing by zero when nothing ran', () => {
    const model = buildUtilizationModel(input({ usage: usage([]), robotNames: new Map([[1, 'Bot.Alpha']]) }))
    expect(model.consumedHours).toBe(0)
    expect(model.utilizationPct).toBe(0)
    expect(model.robots).toEqual([{ id: 1, name: 'Bot.Alpha', hours: 0, sharePct: 0 }])
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

import { describe, expect, it } from 'vitest'
import type { ProcessSchedule } from '../orchestrator'
import { buildSummaryMetricData } from '../summaryMetrics'

const baseSchedule = (overrides: Partial<ProcessSchedule>): ProcessSchedule => ({
  Id: 1,
  Name: 'Process A',
  Enabled: true,
  StartProcessCron: '0 0 10 1/1 * ?',
  StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 10, atMinute: 0 } }),
  StartProcessCronSummary: 'At 10:00 AM',
  StartProcessNextOccurrence: null,
  TimeZoneId: 'Central Standard Time',
  TimeZoneIana: 'America/Chicago',
  folderId: 8101,
  folderName: 'Shared',
  ...overrides,
})

const dayRange = (date: Date) => {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)

  const end = new Date(date)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

const metricValues = (
  schedules: ProcessSchedule[],
  statusFilter: 'all' | 'enabled' | 'disabled',
  horizonDays?: number,
) => {
  const { start, end } = dayRange(new Date(2026, 4, 6))
  return Object.fromEntries(
    buildSummaryMetricData({
      horizonDays,
      schedules,
      statusFilter,
      todayEnd: end,
      todayStart: start,
    }).map((metric) => [metric.label, metric.value]),
  )
}

describe('summary metric derivation', () => {
  const enabledDaily = baseSchedule({ Id: 1, Name: 'Enabled Daily', folderId: 100, folderName: 'Shared' })
  const disabledDaily = baseSchedule({
    Id: 2,
    Name: 'Disabled Daily',
    Enabled: false,
    folderId: 100,
    folderName: 'Shared',
  })
  const enabledHourly = baseSchedule({
    Id: 3,
    Name: 'Enabled Hourly',
    ReleaseName: 'Download.File',
    StartProcessCron: '0 0 * 1/1 * ?',
    StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
    StartProcessCronSummary: 'Every hour',
    folderId: 200,
    folderName: 'Finance Ops',
  })
  const disabledMinute = baseSchedule({
    Id: 4,
    Name: 'Disabled Minute',
    Enabled: false,
    StartProcessCron: '0 * * 1/1 * ?',
    StartProcessCronDetails: JSON.stringify({ type: 0, minutely: { atMinute: 1 } }),
    StartProcessCronSummary: 'Every minute',
    folderId: 200,
    folderName: 'Finance Ops',
  })

  it('uses the All metric set with enabled count and unique active triggers today', () => {
    expect(metricValues([enabledDaily, disabledDaily, enabledHourly, disabledMinute], 'all')).toEqual({
      'Active Today': 2,
      Collisions: 2,
      Duplicates: 0,
      Enabled: 2,
      Expiring: 0,
      Folders: 2,
      Stale: 0,
      Triggers: 4,
    })
  })

  it('uses the Enabled metric set with active-today count and folder count', () => {
    expect(metricValues([enabledDaily, enabledHourly], 'enabled')).toEqual({
      'Active Today': 2,
      Collisions: 2,
      Duplicates: 0,
      Expiring: 0,
      Folders: 2,
      Stale: 0,
      Triggers: 2,
    })
  })

  it('uses the Disabled metric set with suppressed runs and folder count', () => {
    expect(metricValues([disabledDaily, disabledMinute], 'disabled')).toEqual({
      Collisions: 0,
      Duplicates: 0,
      Expiring: 0,
      Folders: 2,
      Stale: 0,
      'Suppressed Today': 1_441,
      Triggers: 2,
    })
  })

  it('counts duplicate schedules when a process has multiple triggers in the same folder', () => {
    const duplicate1 = baseSchedule({ Id: 10, Name: 'Invoice Proc', ReleaseId: 42, folderId: 100 })
    const duplicate2 = baseSchedule({
      Id: 11,
      Name: 'Invoice Proc Copy',
      ReleaseId: 42,
      folderId: 100,
      StartProcessCron: '0 0 14 1/1 * ?',
    })
    const unique = baseSchedule({ Id: 12, Name: 'Other Process', ReleaseId: 99, folderId: 100 })

    expect(metricValues([duplicate1, duplicate2, unique], 'enabled')).toEqual(
      expect.objectContaining({ Duplicates: 1 }),
    )
  })

  it('does not count same-process triggers across different folders as duplicates', () => {
    const folderA = baseSchedule({ Id: 20, Name: 'Shared Report', ReleaseId: 55, folderId: 100 })
    const folderB = baseSchedule({ Id: 21, Name: 'Shared Report', ReleaseId: 55, folderId: 200 })

    expect(metricValues([folderA, folderB], 'enabled')).toEqual(
      expect.objectContaining({ Duplicates: 0 }),
    )
  })

  it('excludes queue triggers from Stale and Collisions counts', () => {
    const queueRunner = baseSchedule({
      Id: 30,
      Name: '1478_CapitalBrokenApplications_Runner',
      QueueDefinitionId: 9001,
      StartProcessCron: '0 * * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 0, minutely: { atMinute: 1 } }),
      StartProcessCronSummary: 'Every minute',
      folderId: 300,
      folderName: 'SBSEG/RM',
    })
    const timeMinute = baseSchedule({
      Id: 31,
      Name: 'Time Polling',
      StartProcessCron: '0 * * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 0, minutely: { atMinute: 1 } }),
      StartProcessCronSummary: 'Every minute',
      folderId: 300,
      folderName: 'SBSEG/RM',
    })

    const result = metricValues([queueRunner, timeMinute], 'enabled')
    expect(result.Stale).toBe(0)
    expect(result.Collisions).toBe(0)
    expect(result.Triggers).toBe(2)
  })

  it('counts a schedule as stale when it has no upcoming run in the next 30 days', () => {
    const expiredOneShot = baseSchedule({
      Id: 40,
      Name: 'Expired One Shot',
      StartProcessCron: '',
      StartProcessCronDetails: JSON.stringify({ type: 0 }),
      StartProcessNextOccurrence: '2020-01-01T00:00:00.000Z',
      folderId: 400,
    })

    const result = metricValues([expiredOneShot], 'enabled')
    expect(result.Stale).toBe(1)
  })

  it('counts a schedule as expiring when its stop date has passed or falls within 14 days', () => {
    const expired = baseSchedule({
      Id: 50,
      Name: 'Past Stop Date',
      StopProcessDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      folderId: 500,
    })
    const expiringSoon = baseSchedule({
      Id: 51,
      Name: 'Soon Stop Date',
      StopProcessDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      folderId: 500,
    })
    const farOut = baseSchedule({
      Id: 52,
      Name: 'Far Stop Date',
      StopProcessDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      folderId: 500,
    })

    const result = metricValues([expired, expiringSoon, farOut], 'enabled')
    expect(result.Expiring).toBe(2)
  })

  it('counts more triggers as the horizon widens', () => {
    const in90Days = baseSchedule({
      Id: 60,
      StopProcessDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      folderId: 600,
    })
    const in2Years = baseSchedule({
      Id: 61,
      StopProcessDate: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString(),
      folderId: 600,
    })
    const schedules = [in90Days, in2Years]

    expect(metricValues(schedules, 'enabled', 14).Expiring).toBe(0)
    expect(metricValues(schedules, 'enabled', 90).Expiring).toBe(1)
    expect(metricValues(schedules, 'enabled', 365).Expiring).toBe(1)
  })

  it('names the active horizon in the Expiring description, so tooltip and toggle agree', () => {
    const { start, end } = dayRange(new Date(2026, 4, 6))
    const descriptionFor = (horizonDays: number) =>
      buildSummaryMetricData({
        horizonDays,
        schedules: [],
        statusFilter: 'enabled',
        todayEnd: end,
        todayStart: start,
      }).find((metric) => metric.key === 'expiring')?.description

    expect(descriptionFor(14)).toContain('14d')
    expect(descriptionFor(365)).toContain('1y')
    expect(descriptionFor(14)).not.toContain('1y')
  })
})

const robotAssignment = (robotId: number) => ({
  MachineId: null,
  MachineName: null,
  RobotId: robotId,
  RobotUserName: null,
  SessionId: null,
  SessionName: null,
})

const metricValuesWithRuntime = (
  schedules: ProcessSchedule[],
  scheduleMachineIds: Map<number, number[]>,
  statusFilter: 'all' | 'enabled' | 'disabled' = 'enabled',
) => {
  const { start, end } = dayRange(new Date(2026, 4, 6))
  return Object.fromEntries(
    buildSummaryMetricData({
      schedules,
      scheduleMachineIds,
      statusFilter,
      todayEnd: end,
      todayStart: start,
    }).map((metric) => [metric.label, metric.value]),
  )
}

describe('machine and robot metrics', () => {
  const sA = baseSchedule({ Id: 1, folderId: 100, MachineRobots: [robotAssignment(5)] })
  const sB = baseSchedule({ Id: 2, folderId: 100, MachineRobots: [robotAssignment(5)] })
  const sC = baseSchedule({ Id: 3, folderId: 200, MachineRobots: [robotAssignment(7)] })

  it('counts distinct runtime machines and assigned robots when the runtime map is provided', () => {
    const scheduleMachineIds = new Map<number, number[]>([
      [1, [111]],
      [2, [111, 222]],
      // sC has no run history → contributes no machine
    ])
    const result = metricValuesWithRuntime([sA, sB, sC], scheduleMachineIds, 'enabled')
    expect(result.Machines).toBe(2) // distinct machine keys {111, 222}
    expect(result.Robots).toBe(2) // distinct robot ids {5, 7}
  })

  it('omits Machines and Robots metrics when no runtime map is provided', () => {
    const result = metricValues([sA, sB, sC], 'enabled')
    expect(result).not.toHaveProperty('Machines')
    expect(result).not.toHaveProperty('Robots')
  })

  it('recomputes machine and robot counts from the visible (filtered) schedules', () => {
    const scheduleMachineIds = new Map<number, number[]>([
      [1, [111]],
      [2, [111, 222]],
    ])
    // Only sC visible → no machine history, single robot
    const result = metricValuesWithRuntime([sC], scheduleMachineIds, 'enabled')
    expect(result.Machines).toBe(0)
    expect(result.Robots).toBe(1)
  })
})

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

const metricValues = (schedules: ProcessSchedule[], statusFilter: 'all' | 'enabled' | 'disabled') => {
  const { start, end } = dayRange(new Date(2026, 4, 6))
  return Object.fromEntries(
    buildSummaryMetricData({
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
      Stale: 0,
      Triggers: 4,
    })
  })

  it('uses the Enabled metric set with active-today count and folder count', () => {
    expect(metricValues([enabledDaily, enabledHourly], 'enabled')).toEqual({
      'Active Today': 2,
      Collisions: 2,
      Duplicates: 0,
      Folders: 2,
      Stale: 0,
      Triggers: 2,
    })
  })

  it('uses the Disabled metric set with suppressed runs and folder count', () => {
    expect(metricValues([disabledDaily, disabledMinute], 'disabled')).toEqual({
      Collisions: 0,
      Duplicates: 0,
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
})

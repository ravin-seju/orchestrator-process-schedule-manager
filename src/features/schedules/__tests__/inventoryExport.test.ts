// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildInventoryRows,
  downloadCsv,
  escapeCsvCell,
  inventoryExportColumns,
  inventoryExportFilename,
  toCsv,
} from '../inventoryExport'
import type { ProcessSchedule } from '../orchestrator'

const NOW = Date.UTC(2026, 7, 20, 12, 0)

const makeSchedule = (id: number, overrides: Partial<ProcessSchedule> = {}): ProcessSchedule =>
  ({
    Id: id,
    Name: `Schedule ${id}`,
    Enabled: true,
    ReleaseName: 'Invoice.Process',
    StartProcessCron: '0 0 10 1/1 * ?',
    StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 10, atMinute: 0 } }),
    StartProcessCronSummary: 'At 10:00 AM',
    TimeZoneIana: 'America/Chicago',
    folderId: 1,
    folderName: 'Finance',
    ...overrides,
  }) as ProcessSchedule

// One data row, keyed by column name, so assertions read as intent rather than array indices.
const rowFor = (schedule: ProcessSchedule, context = {}, nowMs = NOW) => {
  const [, row] = buildInventoryRows([schedule], context, nowMs)
  return Object.fromEntries(inventoryExportColumns.map((column, index) => [column, row[index]]))
}

describe('buildInventoryRows', () => {
  it('starts with the header row, in the agreed column order', () => {
    const [header] = buildInventoryRows([], {}, NOW)
    expect(header).toEqual([
      'Name',
      'Process',
      'Folder',
      'Machine',
      'Robot',
      'Trigger Type',
      'Pattern',
      'Ends',
      'Status',
      'Time zone',
      'Next run',
      'Stop strategy',
    ])
  })

  it('exports every schedule it is given, in order — the full set, not an 80-row virtual window', () => {
    const schedules = Array.from({ length: 120 }, (_, index) => makeSchedule(index + 1))
    const rows = buildInventoryRows(schedules, {}, NOW)

    expect(rows).toHaveLength(121)
    expect(rows[1][0]).toBe('Schedule 1')
    expect(rows[120][0]).toBe('Schedule 120')
  })

  it('reads the process, folder, trigger type and pattern from the shared helpers', () => {
    const row = rowFor(makeSchedule(1))

    expect(row.Process).toBe('Invoice.Process')
    expect(row.Folder).toBe('Finance')
    expect(row['Trigger Type']).toBe('Daily')
    expect(row.Pattern).toBe('At 10:00 AM')
    expect(rowFor(makeSchedule(2, { ReleaseName: null, PackageName: null }))).toMatchObject({ Process: 'Unknown' })
  })

  it('leaves Pattern empty for a queue trigger rather than the table’s dash', () => {
    const row = rowFor(makeSchedule(1, { QueueDefinitionId: 9001 }))

    expect(row['Trigger Type']).toBe('Queue')
    expect(row.Pattern).toBe('')
  })

  it('joins every machine and robot, where the table shows only the first plus "+N"', () => {
    const schedule = makeSchedule(7, {
      MachineRobots: [
        { MachineId: null, MachineName: null, RobotId: 201, RobotUserName: null, SessionId: null, SessionName: null },
        { MachineId: null, MachineName: null, RobotId: 202, RobotUserName: 'Bot.Two', SessionId: null, SessionName: null },
      ],
    })
    const row = rowFor(schedule, {
      machineNames: new Map([[501, 'HOST-1'], [502, 'HOST-2']]),
      robotNames: new Map([[201, 'automationbot@example.com-unattended']]),
      scheduleMachineIds: new Map([[7, [501, 502]]]),
    })

    expect(row.Machine).toBe('HOST-1; HOST-2')
    expect(row.Robot).toBe('automationbot; Bot.Two')
  })

  it('leaves Machine and Robot empty without any machine/robot data, matching the table', () => {
    const schedule = makeSchedule(1, {
      MachineRobots: [
        { MachineId: null, MachineName: null, RobotId: 201, RobotUserName: 'Bot.One', SessionId: null, SessionName: null },
      ],
    })

    expect(rowFor(schedule)).toMatchObject({ Machine: '', Robot: '' })
  })

  it('reports all three statuses', () => {
    const past = new Date(NOW - 24 * 60 * 60 * 1000).toISOString()

    expect(rowFor(makeSchedule(1)).Status).toBe('Enabled')
    expect(rowFor(makeSchedule(2, { Enabled: false })).Status).toBe('Disabled')
    expect(rowFor(makeSchedule(3, { Enabled: false, StopProcessDate: past })).Status).toBe('Auto-disabled')
  })

  it("writes Ends as an ISO date in the trigger's own timezone", () => {
    // 03:30 UTC on 24 Aug is still the 23rd in Chicago but already the 24th in Tokyo — the same
    // instant has to produce two different dates, or the zone is being ignored.
    const stop = new Date(Date.UTC(2026, 7, 24, 3, 30)).toISOString()

    expect(rowFor(makeSchedule(1, { StopProcessDate: stop, TimeZoneIana: 'America/Chicago' })).Ends).toBe('2026-08-23')
    expect(rowFor(makeSchedule(2, { StopProcessDate: stop, TimeZoneIana: 'Asia/Tokyo' })).Ends).toBe('2026-08-24')
  })

  it('leaves Ends empty when there is no stop date — never the dash the table uses', () => {
    expect(rowFor(makeSchedule(1)).Ends).toBe('')
  })

  it('exports the raw zone name, falling back to TimeZoneId', () => {
    expect(rowFor(makeSchedule(1))['Time zone']).toBe('America/Chicago')
    expect(
      rowFor(makeSchedule(2, { TimeZoneIana: null, TimeZoneId: 'Central Standard Time' }))['Time zone'],
    ).toBe('Central Standard Time')
  })

  describe('Next run', () => {
    const next = new Date(Date.UTC(2026, 7, 25, 19, 30)).toISOString()

    it("is an ISO date and time in the trigger's zone", () => {
      expect(rowFor(makeSchedule(1, { StartProcessNextOccurrence: next }))['Next run']).toBe('2026-08-25 14:30')
    })

    it('is empty for a disabled trigger', () => {
      expect(rowFor(makeSchedule(1, { Enabled: false, StartProcessNextOccurrence: next }))['Next run']).toBe('')
    })

    it('is empty once the stop date has passed, even if Orchestrator has not cleared the field', () => {
      const row = rowFor(
        makeSchedule(1, {
          StartProcessNextOccurrence: next,
          StopProcessDate: new Date(Date.UTC(2026, 7, 15)).toISOString(),
        }),
      )
      expect(row['Next run']).toBe('')
    })

    it('is empty when the next occurrence falls after a future stop date', () => {
      const row = rowFor(
        makeSchedule(1, {
          StartProcessNextOccurrence: next,
          StopProcessDate: new Date(Date.UTC(2026, 7, 22)).toISOString(),
        }),
      )
      expect(row['Next run']).toBe('')
    })

    it('is empty for a queue trigger, which runs on queue items rather than a clock', () => {
      // Found in the live check: the stress fixture gives queue triggers a next occurrence, and the
      // export printed one. The calendar shows no time-based occurrences for queue triggers; nor
      // may the file.
      const row = rowFor(makeSchedule(1, { QueueDefinitionId: 9001, StartProcessNextOccurrence: next }))
      expect(row['Next run']).toBe('')
    })

    it('is empty when the value is already in the past', () => {
      const stale = new Date(Date.UTC(2026, 7, 19)).toISOString()
      expect(rowFor(makeSchedule(1, { StartProcessNextOccurrence: stale }))['Next run']).toBe('')
    })
  })

  describe('Stop strategy', () => {
    const stop = new Date(Date.UTC(2026, 8, 30)).toISOString()

    it('is empty without a stop date, even though Orchestrator defaults StopStrategy to SoftStop', () => {
      expect(rowFor(makeSchedule(1, { StopStrategy: 'SoftStop' }))['Stop strategy']).toBe('')
    })

    it('names the strategy when a stop date exists', () => {
      expect(rowFor(makeSchedule(1, { StopProcessDate: stop, StopStrategy: 'Kill' }))['Stop strategy']).toBe('Kill')
      expect(rowFor(makeSchedule(2, { StopProcessDate: stop, StopStrategy: 'SoftStop' }))['Stop strategy']).toBe(
        'Soft Stop',
      )
    })

    it('stays empty for an unset strategy rather than implying Soft Stop', () => {
      expect(rowFor(makeSchedule(1, { StopProcessDate: stop, StopStrategy: null }))['Stop strategy']).toBe('')
    })
  })
})

describe('escapeCsvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(escapeCsvCell('Invoice Sync 004')).toBe('Invoice Sync 004')
  })

  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralises a formula-trigger first character %j', (lead) => {
    expect(escapeCsvCell(`${lead}HYPERLINK("x")`).replace(/^"|"$/g, '').startsWith(`'${lead}`)).toBe(true)
  })

  it('quotes a value containing a comma — pattern text routinely does', () => {
    expect(escapeCsvCell('At 10:00 AM, day 13 of every month')).toBe('"At 10:00 AM, day 13 of every month"')
  })

  it('doubles embedded quotes and quotes the field', () => {
    expect(escapeCsvCell('Say "hi"')).toBe('"Say ""hi"""')
  })

  it('quotes a value containing a line break', () => {
    expect(escapeCsvCell('line one\nline two')).toBe('"line one\nline two"')
  })

  it('applies the formula guard before quoting, so both protections hold together', () => {
    expect(escapeCsvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"')
  })
})

describe('toCsv', () => {
  it('opens with a UTF-8 byte-order mark so Excel does not decode as Windows-1252', () => {
    expect(toCsv([['a']]).charCodeAt(0)).toBe(0xfeff)
  })

  it('separates records with CRLF and ends with one', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('\uFEFFa,b\r\nc,d\r\n')
  })

  it('escapes every cell', () => {
    expect(toCsv([['=x', 'a,b']])).toBe('\uFEFF\'=x,"a,b"\r\n')
  })
})

describe('inventoryExportFilename', () => {
  const day = new Date(2026, 9, 8, 15, 0)

  it('slugs the tenant name and stamps the local date', () => {
    expect(inventoryExportFilename('Demo Tenant!', day)).toBe('process-schedules-demo-tenant-2026-10-08.csv')
  })

  it('falls back to "tenant" when nothing usable is left', () => {
    expect(inventoryExportFilename('***', day)).toBe('process-schedules-tenant-2026-10-08.csv')
  })
})

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('hands the browser a CSV blob under the given filename, then releases the object URL', async () => {
    vi.useFakeTimers()
    // jsdom implements neither, so both are installed for the test.
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCsv('process-schedules-demo-2026-10-08.csv', '\uFEFFa,b\r\n')

    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(click).toHaveBeenCalledTimes(1)
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe('process-schedules-demo-2026-10-08.csv')
    expect(link.isConnected).toBe(false) // removed again after the click

    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})

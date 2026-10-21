import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiPath } from '@uipath/uipath-typescript/core'

const { fetchAllPages } = vi.hoisted(() => ({ fetchAllPages: vi.fn() }))

vi.mock('@/features/orchestrator/odataClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/orchestrator/odataClient')>()),
  fetchAllPages,
}))

import { loadJobHistory, type UsageEntry } from '@/features/jobs/orchestrator'

const sdk = {} as UiPath

const job = (
  state: string,
  startIso: string,
  minutes: number,
  robotId: number | null = 1,
  runtimeType: string | null = 'Unattended',
  waitMinutes: number | null = 2,
) => ({
  State: state,
  RuntimeType: runtimeType,
  CreationTime: waitMinutes == null ? null : new Date(Date.parse(startIso) - waitMinutes * 60_000).toISOString(),
  StartTime: startIso,
  EndTime: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
  StartingScheduleId: 10,
  HostMachineName: 'HOST-01',
  Robot: robotId == null ? null : { Id: robotId, Name: `bot-${robotId}` },
  Release: { Id: 5 },
})

const brief = ({ folderId, runtimeType, robotId, sec }: UsageEntry) => ({ folderId, runtimeType, robotId, sec })

const sorted = (usage: UsageEntry[]) =>
  [...usage]
    .sort((a, b) => a.folderId - b.folderId || String(a.runtimeType).localeCompare(String(b.runtimeType)))
    .map(brief)

beforeEach(() => {
  fetchAllPages.mockReset()
})

describe('loadJobHistory usage', () => {
  it('attributes each job to the folder it was fetched from', async () => {
    fetchAllPages.mockImplementation(async (_sdk, _tenant, _path, folderId: number) =>
      folderId === 100
        ? [job('Successful', '2026-10-01T10:00:00Z', 60)]
        : [job('Successful', '2026-10-01T12:00:00Z', 30, 2)],
    )

    const { usage } = await loadJobHistory(sdk, 'Demo', [100, 200], 30)

    expect(sorted(usage)).toEqual([
      { folderId: 100, runtimeType: 'Unattended', robotId: 1, sec: 3600 },
      { folderId: 200, runtimeType: 'Unattended', robotId: 2, sec: 1800 },
    ])
  })

  it('adds up jobs that share a folder, runtime type and robot', async () => {
    fetchAllPages.mockResolvedValue([
      job('Successful', '2026-10-01T10:00:00Z', 10),
      job('Successful', '2026-10-01T11:00:00Z', 20),
      job('Successful', '2026-10-01T12:00:00Z', 5, 1, 'Serverless'),
    ])

    const { usage } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(sorted(usage)).toEqual([
      { folderId: 100, runtimeType: 'Serverless', robotId: 1, sec: 300 },
      { folderId: 100, runtimeType: 'Unattended', robotId: 1, sec: 1800 },
    ])
  })

  it('keeps every runtime type; the model decides which ones count', async () => {
    fetchAllPages.mockResolvedValue([
      job('Successful', '2026-10-01T10:00:00Z', 10, 1, 'Development'),
      job('Successful', '2026-10-01T11:00:00Z', 10, 1, null),
    ])

    const { usage } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(usage.map((entry) => entry.runtimeType)).toEqual(['Development', null])
  })

  it('counts faulted and stopped runs as robot time but keeps them out of runtime stats', async () => {
    fetchAllPages.mockResolvedValue([
      job('Successful', '2026-10-01T10:00:00Z', 10),
      job('Faulted', '2026-10-01T11:00:00Z', 20),
      job('Stopped', '2026-10-01T12:00:00Z', 30),
    ])

    const { usage, rows } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(usage.map(brief)).toEqual([{ folderId: 100, runtimeType: 'Unattended', robotId: 1, sec: 3600 }])
    expect(rows).toHaveLength(1)
    expect(rows[0].durationSec).toBe(600)
  })

  it('skips jobs with no end time or a non-positive duration', async () => {
    fetchAllPages.mockResolvedValue([
      { ...job('Successful', '2026-10-01T10:00:00Z', 10), EndTime: null },
      job('Successful', '2026-10-01T11:00:00Z', -5),
      job('Successful', '2026-10-01T12:00:00Z', 15),
    ])

    const { usage } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(usage.map(brief)).toEqual([{ folderId: 100, runtimeType: 'Unattended', robotId: 1, sec: 900 }])
  })

  it('records a job with no robot under a null robot id', async () => {
    fetchAllPages.mockResolvedValue([job('Successful', '2026-10-01T10:00:00Z', 10, null)])

    const { usage } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(usage.map(brief)).toEqual([{ folderId: 100, runtimeType: 'Unattended', robotId: null, sec: 600 }])
  })

  it('keeps folder attribution aligned when an earlier folder fails', async () => {
    fetchAllPages.mockImplementation(async (_sdk, _tenant, _path, folderId: number) => {
      if (folderId === 100) throw new Error('403')
      return [job('Successful', '2026-10-01T10:00:00Z', 20)]
    })

    const { usage } = await loadJobHistory(sdk, 'Demo', [100, 200], 30)

    expect(usage.map(brief)).toEqual([{ folderId: 200, runtimeType: 'Unattended', robotId: 1, sec: 1200 }])
  })
  it('splits busy time by local hour of day, including across midnight', async () => {
    const start = new Date(2026, 9, 1, 23, 30).toISOString() // 23:30 local
    fetchAllPages.mockResolvedValue([job('Successful', start, 120)]) // until 01:30 local

    const [entry] = (await loadJobHistory(sdk, 'Demo', [100], 30)).usage

    expect(entry.byHour[23]).toBe(1800)
    expect(entry.byHour[0]).toBe(3600)
    expect(entry.byHour[1]).toBe(1800)
    expect(entry.byHour.reduce((sum, sec) => sum + sec, 0)).toBe(entry.sec)
  })

  it('records failed time and waits by band, skipping jobs without a usable creation time', async () => {
    fetchAllPages.mockResolvedValue([
      job('Successful', '2026-10-01T10:00:00Z', 10, 1, 'Unattended', 0.5), // < 1 min
      job('Faulted', '2026-10-01T11:00:00Z', 20, 1, 'Unattended', 3), // 1-5 min
      job('Stopped', '2026-10-01T12:00:00Z', 30, 1, 'Unattended', 10), // 5-15 min
      job('Successful', '2026-10-01T13:00:00Z', 5, 1, 'Unattended', 90), // > 60 min
      job('Successful', '2026-10-01T14:00:00Z', 5, 1, 'Unattended', null), // no creation time
      job('Successful', '2026-10-01T15:00:00Z', 5, 1, 'Unattended', -1), // started before creation
    ])

    const [entry] = (await loadJobHistory(sdk, 'Demo', [100], 30)).usage

    expect(entry.failedSec).toBe(3000)
    expect(entry.waitBuckets).toEqual([1, 1, 1, 0, 1])
    expect(entry.waitCount).toBe(4)
    expect(entry.waitSec).toBe(30 + 180 + 600 + 5400)
  })

  it('asks Jobs for CreationTime in the same request', async () => {
    fetchAllPages.mockResolvedValue([])

    await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(fetchAllPages.mock.calls[0][2]).toContain('$select=CreationTime,StartTime,EndTime')
  })
})

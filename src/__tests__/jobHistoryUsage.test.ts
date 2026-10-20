import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiPath } from '@uipath/uipath-typescript/core'

const { fetchAllPages } = vi.hoisted(() => ({ fetchAllPages: vi.fn() }))

vi.mock('@/features/orchestrator/odataClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/orchestrator/odataClient')>()),
  fetchAllPages,
}))

import { loadJobHistory } from '@/features/jobs/orchestrator'

const sdk = {} as UiPath

const job = (
  state: string,
  startIso: string,
  minutes: number,
  robotId: number | null = 1,
  runtimeType = 'Unattended',
) => ({
  State: state,
  RuntimeType: runtimeType,
  StartTime: startIso,
  EndTime: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
  StartingScheduleId: 10,
  HostMachineName: 'HOST-01',
  Robot: robotId == null ? null : { Id: robotId, Name: `bot-${robotId}` },
  Release: { Id: 5 },
})

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

    expect(usage.byFolder.get(100)).toBe(3600)
    expect(usage.byFolder.get(200)).toBe(1800)
    expect(usage.byRobot.get(1)).toBe(3600)
    expect(usage.byRobot.get(2)).toBe(1800)
    expect(usage.totalSec).toBe(5400)
  })

  it('counts faulted and stopped runs as robot time but keeps them out of runtime stats', async () => {
    fetchAllPages.mockResolvedValue([
      job('Successful', '2026-10-01T10:00:00Z', 10),
      job('Faulted', '2026-10-01T11:00:00Z', 20),
      job('Stopped', '2026-10-01T12:00:00Z', 30),
    ])

    const { usage, rows } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(usage.totalSec).toBe(3600)
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

    expect(usage.totalSec).toBe(900)
  })

  it('counts only Unattended and Serverless runs as robot time', async () => {
    fetchAllPages.mockResolvedValue([
      job('Successful', '2026-10-01T10:00:00Z', 10, 1, 'Unattended'),
      job('Successful', '2026-10-01T11:00:00Z', 20, 1, 'Serverless'),
      job('Successful', '2026-10-01T12:00:00Z', 30, 1, 'Development'),
      job('Successful', '2026-10-01T13:00:00Z', 40, 1, 'Attended'),
      { ...job('Successful', '2026-10-01T14:00:00Z', 50), RuntimeType: null },
    ])

    const { usage, rows } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(usage.totalSec).toBe(1800)
    expect(usage.byRobot.get(1)).toBe(1800)
    // Runtime stats still use every successful run, whatever it ran on.
    expect(rows).toHaveLength(5)
  })

  it('counts a job with no robot in the total and its folder only', async () => {
    fetchAllPages.mockResolvedValue([job('Successful', '2026-10-01T10:00:00Z', 10, null)])

    const { usage } = await loadJobHistory(sdk, 'Demo', [100], 30)

    expect(usage.totalSec).toBe(600)
    expect(usage.byFolder.get(100)).toBe(600)
    expect(usage.byRobot.size).toBe(0)
  })

  it('keeps folder attribution aligned when an earlier folder fails', async () => {
    fetchAllPages.mockImplementation(async (_sdk, _tenant, _path, folderId: number) => {
      if (folderId === 100) throw new Error('403')
      return [job('Successful', '2026-10-01T10:00:00Z', 20)]
    })

    const { usage } = await loadJobHistory(sdk, 'Demo', [100, 200], 30)

    expect(usage.byFolder.has(100)).toBe(false)
    expect(usage.byFolder.get(200)).toBe(1200)
  })
})

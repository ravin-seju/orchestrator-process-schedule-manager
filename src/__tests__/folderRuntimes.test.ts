import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiPath } from '@uipath/uipath-typescript/core'

const { fetchOData } = vi.hoisted(() => ({ fetchOData: vi.fn() }))

vi.mock('@/features/orchestrator/odataClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/orchestrator/odataClient')>()),
  fetchOData,
}))

import { loadFolderRuntimes } from '@/features/machines/orchestrator'

const sdk = {} as UiPath

const runtimes = (rows: [string, number, number?, number?][]) => ({
  value: rows.map(([Type, Total, Connected = Total, Available = 0]) => ({ Type, Total, Connected, Available })),
})

const byFolder = (responses: Record<number, ReturnType<typeof runtimes> | Error>) =>
  fetchOData.mockImplementation(async (_sdk, _tenant, path: string) => {
    const folderId = Number(/folderId=(\d+)/.exec(path)?.[1])
    const response = responses[folderId]
    if (response instanceof Error) throw response
    return response
  })

beforeEach(() => {
  fetchOData.mockReset()
})

describe('loadFolderRuntimes', () => {
  it('returns one entry per folder and runtime type with deployed runtimes', async () => {
    byFolder({
      100: runtimes([['Unattended', 11, 10, 4], ['Development', 2], ['Serverless', 0]]),
      200: runtimes([['Unattended', 6]]),
    })

    const entries = await loadFolderRuntimes(sdk, 'Demo', [100, 200])

    expect(entries).toEqual([
      { folderId: 100, runtimeType: 'Unattended', total: 11, connected: 10, available: 4 },
      { folderId: 100, runtimeType: 'Development', total: 2, connected: 2, available: 0 },
      { folderId: 200, runtimeType: 'Unattended', total: 6, connected: 6, available: 0 },
    ])
  })

  it('asks for each folder by path, with no folder header', async () => {
    byFolder({ 100: runtimes([['Unattended', 1]]) })

    await loadFolderRuntimes(sdk, 'Demo', [100])

    expect(fetchOData).toHaveBeenCalledWith(
      sdk,
      'Demo',
      'Machines/UiPath.Server.Configuration.OData.GetRuntimesForFolder(folderId=100)',
    )
  })

  it('skips a folder that fails and keeps the others aligned', async () => {
    byFolder({
      100: new Error('403'),
      200: runtimes([['Unattended', 4]]),
    })

    const entries = await loadFolderRuntimes(sdk, 'Demo', [100, 200])

    expect(entries).toEqual([{ folderId: 200, runtimeType: 'Unattended', total: 4, connected: 4, available: 0 }])
  })

  it('returns nothing when every folder fails', async () => {
    byFolder({ 100: new Error('403'), 200: new Error('403') })

    expect(await loadFolderRuntimes(sdk, 'Demo', [100, 200])).toEqual([])
  })
})

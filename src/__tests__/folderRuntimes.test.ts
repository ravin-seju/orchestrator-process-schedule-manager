import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiPath } from '@uipath/uipath-typescript/core'

const { fetchOData } = vi.hoisted(() => ({ fetchOData: vi.fn() }))

vi.mock('@/features/orchestrator/odataClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/orchestrator/odataClient')>()),
  fetchOData,
}))

import { loadFolderRuntimes } from '@/features/machines/orchestrator'

const sdk = {} as UiPath

const runtimes = (rows: [string, number][]) => ({ value: rows.map(([Type, Total]) => ({ Type, Total })) })

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
  it('uses the largest folder total, not the sum, as capacity', async () => {
    byFolder({
      100: runtimes([['Unattended', 11]]),
      200: runtimes([['Unattended', 6]]),
    })

    const result = await loadFolderRuntimes(sdk, 'Demo', [100, 200])

    expect(result.capacityRuntimes).toBe(11)
    expect(result.folderRuntimes).toEqual(new Map([[100, 11], [200, 6]]))
  })

  it('counts Unattended and Serverless runtimes only', async () => {
    byFolder({
      100: runtimes([['Unattended', 3], ['Serverless', 2], ['Development', 5], ['TestAutomation', 4]]),
    })

    const result = await loadFolderRuntimes(sdk, 'Demo', [100])

    expect(result.capacityRuntimes).toBe(5)
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

    const result = await loadFolderRuntimes(sdk, 'Demo', [100, 200])

    expect(result.capacityRuntimes).toBe(4)
    expect(result.folderRuntimes).toEqual(new Map([[200, 4]]))
  })

  it('returns null capacity when every folder fails', async () => {
    byFolder({ 100: new Error('403'), 200: new Error('403') })

    const result = await loadFolderRuntimes(sdk, 'Demo', [100, 200])

    expect(result.capacityRuntimes).toBeNull()
  })

  it('returns null capacity when no folder has a capacity runtime', async () => {
    byFolder({ 100: runtimes([['Unattended', 0], ['Development', 2]]) })

    const result = await loadFolderRuntimes(sdk, 'Demo', [100])

    expect(result.capacityRuntimes).toBeNull()
  })
})

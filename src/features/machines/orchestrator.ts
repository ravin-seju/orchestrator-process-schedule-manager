import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchOData, settledBatch } from '@/features/orchestrator/odataClient'
import { CAPACITY_RUNTIME_TYPES } from '@/features/jobs/orchestrator'

interface RawMachineRuntime {
  Type?: string | null
  Total?: number | null
}

export interface FolderRuntimesResult {
  // Lower bound on the tenant's deployed runtimes: the largest single-folder total.
  // null when no folder answered or every total was 0.
  capacityRuntimes: number | null
  folderRuntimes: Map<number, number>
}

// Deployed runtimes per folder, from the one runtime endpoint these tenants allow
// (Machines.View). The license and session endpoints answer 403 even with their scopes.
// The folder id is a path segment, so no folder header is sent.
export async function loadFolderRuntimes(
  sdk: UiPath,
  tenantName: string,
  folderIds: number[],
): Promise<FolderRuntimesResult> {
  const settled = await settledBatch(folderIds, 10, (folderId) =>
    fetchOData<RawMachineRuntime>(
      sdk,
      tenantName,
      `Machines/UiPath.Server.Configuration.OData.GetRuntimesForFolder(folderId=${folderId})`,
    ),
  )

  const folderRuntimes = new Map<number, number>()
  for (const [index, result] of settled.entries()) {
    if (result.status !== 'fulfilled') continue
    const total = (result.value.value ?? [])
      .filter((row) => row.Type != null && CAPACITY_RUNTIME_TYPES.includes(row.Type))
      .reduce((sum, row) => sum + (row.Total ?? 0), 0)
    folderRuntimes.set(folderIds[index], total)
  }

  // Not the sum: a machine shared by several folders appears in each folder's total, so
  // adding them counts it more than once. The largest folder is a safe lower bound.
  const largest = Math.max(0, ...folderRuntimes.values())
  return { capacityRuntimes: largest > 0 ? largest : null, folderRuntimes }
}

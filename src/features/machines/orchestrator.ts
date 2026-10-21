import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchOData, settledBatch } from '@/features/orchestrator/odataClient'

interface RawMachineRuntime {
  Type?: string | null
  Total?: number | null
  Connected?: number | null
  Available?: number | null
}

export interface FolderRuntimeEntry {
  folderId: number
  runtimeType: string
  // Deployed runtimes; of these, `connected` have a host online and `available` are connected and
  // idle at load time. total - connected = offline, connected - available = busy.
  total: number
  connected: number
  available: number
}

// Deployed runtimes per folder and runtime type, from the one runtime endpoint these tenants allow
// (Machines.View); the license and session endpoints answer 403 even with their scopes. The folder
// id is a path segment, so no folder header is sent. Failed folders are skipped. Which types and
// folders count toward capacity is decided by the Utilization model.
export async function loadFolderRuntimes(
  sdk: UiPath,
  tenantName: string,
  folderIds: number[],
): Promise<FolderRuntimeEntry[]> {
  const settled = await settledBatch(folderIds, 10, (folderId) =>
    fetchOData<RawMachineRuntime>(
      sdk,
      tenantName,
      `Machines/UiPath.Server.Configuration.OData.GetRuntimesForFolder(folderId=${folderId})`,
    ),
  )

  const entries: FolderRuntimeEntry[] = []
  for (const [index, result] of settled.entries()) {
    if (result.status !== 'fulfilled') continue
    for (const row of result.value.value ?? []) {
      if (!row.Type || !row.Total) continue
      entries.push({
        folderId: folderIds[index],
        runtimeType: row.Type,
        total: row.Total,
        connected: row.Connected ?? 0,
        available: row.Available ?? 0,
      })
    }
  }
  return entries
}

import type { UiPath } from '@uipath/uipath-typescript/core'
import { fetchOData } from '@/features/orchestrator/odataClient'
import type { MachineInventoryEntry } from '@/features/schedules/types'

interface RawMachine {
  Id: number
  Name: string
  Type?: string
}

interface RawSession {
  State?: string
  ReportingTime?: string | null
  MachineId?: number
  MachineName?: string
}

const mapState = (raw?: string): MachineInventoryEntry['state'] => {
  if (raw === 'Available') return 'Available'
  if (raw === 'Busy') return 'Busy'
  if (raw === 'Disconnected') return 'Disconnected'
  if (raw === 'Unresponsive') return 'Unresponsive'
  return 'Unknown'
}

export async function loadMachines(sdk: UiPath, tenantName: string): Promise<MachineInventoryEntry[]> {
  const machineResponse = await fetchOData<RawMachine>(
    sdk,
    tenantName,
    'Machines?$select=Id,Name,Type&$top=1000',
  )

  const machines = machineResponse.value ?? []
  if (!machines.length) return []

  let sessions: RawSession[] = []
  try {
    const sessionResponse = await fetchOData<RawSession>(
      sdk,
      tenantName,
      'Sessions?$select=State,ReportingTime,MachineId,MachineName&$top=5000',
    )
    sessions = sessionResponse.value ?? []
  } catch {
    // Sessions unavailable (scope or endpoint issue) — machines shown without state
  }

  // Keep the most recent session per machine (latest ReportingTime wins)
  const latestSession = new Map<number, RawSession>()
  for (const session of sessions) {
    if (session.MachineId == null) continue
    const existing = latestSession.get(session.MachineId)
    if (!existing || (session.ReportingTime ?? '') > (existing.ReportingTime ?? '')) {
      latestSession.set(session.MachineId, session)
    }
  }

  return machines.map((machine): MachineInventoryEntry => {
    const session = latestSession.get(machine.Id)
    return {
      id: machine.Id,
      name: machine.Name,
      type: machine.Type ?? '',
      state: mapState(session?.State),
      lastReportingTime: session?.ReportingTime ?? null,
    }
  })
}

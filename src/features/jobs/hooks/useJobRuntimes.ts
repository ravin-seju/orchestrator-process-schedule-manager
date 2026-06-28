import { useEffect, useState } from 'react'
import type { UiPath } from '@uipath/uipath-typescript/core'
import { aggregateRuntimes, loadJobHistory } from '../orchestrator'
import { isTestingPath } from '@/features/schedules/calendarDisplay'
import type { RuntimeStats } from '@/features/schedules/types'
import { cacheGetEntry, cacheSet, cacheKey } from '@/features/orchestrator/cache'

const RUNTIME_STATS_TTL_MS = 4 * 60 * 60 * 1000

type CachedRuntime = {
  stats: [number, RuntimeStats][]
  robotNames: [number, string][]
  machineNames: [number, string][]
  scheduleMachineIds: [number, number[]][]
  releaseMachineIds: [number, number[]][]
  folderKey: string
  sinceDays: number
}

const testingRouteEnabled = import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
const loadStressData = testingRouteEnabled ? () => import('@/features/schedules/stressData') : null

export function useJobRuntimes(
  sdk?: UiPath | null,
  tenantName?: string,
  folderIds?: number[],
  sinceDays = 30,
) {
  const [runtimeStats, setRuntimeStats] = useState<Map<number, RuntimeStats>>(new Map())
  const [robotNames, setRobotNames] = useState<Map<number, string>>(new Map())
  const [machineNames, setMachineNames] = useState<Map<number, string>>(new Map())
  const [scheduleMachineIds, setScheduleMachineIds] = useState<Map<number, number[]>>(new Map())
  const [releaseMachineIds, setReleaseMachineIds] = useState<Map<number, number[]>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const folderKey = folderIds?.join(',') ?? ''

  useEffect(() => {
    if (loadStressData && typeof window !== 'undefined' && isTestingPath(window.location.pathname)) {
      let isActive = true
      loadStressData().then((m) => {
        if (!isActive) return
        setRuntimeStats(m.stressRuntimeStats)
        setRobotNames(m.stressRobotNames)
        setMachineNames(m.stressMachineNames)
        setScheduleMachineIds(m.stressScheduleMachineIds)
        setReleaseMachineIds(m.stressReleaseMachineIds)
      })
      return () => { isActive = false }
    }

    if (!sdk || !tenantName || !folderIds?.length) return

    let isActive = true

    const load = async () => {
      await Promise.resolve()
      if (!isActive) return

      const statsKey = cacheKey('runtimeStats', sdk.config.orgName, tenantName)
      // The cached maps are folder-set + window scoped; a different set must not read them back.
      const sortedFolderKey = [...(folderIds ?? [])].sort((a, b) => a - b).join(',')
      const cached = cacheGetEntry<CachedRuntime>(statsKey)

      const revalidate = async () => {
        const { rows, robotNames: names, machineNames: mNames, scheduleMachineIds: schedMachines, releaseMachineIds: relMachines } =
          await loadJobHistory(sdk, tenantName, folderIds!, sinceDays)
        if (!isActive) return
        const stats = aggregateRuntimes(rows)
        cacheSet(statsKey, {
          stats: [...stats.entries()],
          robotNames: [...names.entries()],
          machineNames: [...mNames.entries()],
          scheduleMachineIds: [...schedMachines.entries()],
          releaseMachineIds: [...relMachines.entries()],
          folderKey: sortedFolderKey,
          sinceDays,
        }, RUNTIME_STATS_TTL_MS)
        setRuntimeStats(stats)
        setRobotNames(names)
        setMachineNames(mNames)
        setScheduleMachineIds(schedMachines)
        setReleaseMachineIds(relMachines)
      }

      if (cached && cached.data.folderKey === sortedFolderKey && cached.data.sinceDays === sinceDays) {
        if (!isActive) return
        setRuntimeStats(new Map(cached.data.stats))
        setRobotNames(new Map(cached.data.robotNames ?? []))
        setMachineNames(new Map(cached.data.machineNames ?? []))
        setScheduleMachineIds(new Map(cached.data.scheduleMachineIds ?? []))
        setReleaseMachineIds(new Map(cached.data.releaseMachineIds ?? []))
        if (cached.isStale) {
          revalidate().catch((err) => console.warn('Background runtime refresh failed:', err))
        }
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        await revalidate()
      } catch (err: unknown) {
        if (!isActive) return
        setError(err instanceof Error ? err.message : 'Failed to load job runtime history')
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    load()

    return () => {
      isActive = false
    }
  // folderKey is a stable primitive derived from folderIds for the dep array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, tenantName, folderKey, sinceDays])

  return { runtimeStats, robotNames, machineNames, scheduleMachineIds, releaseMachineIds, isLoading, error }
}

import { useEffect, useState } from 'react'
import type { UiPath } from '@uipath/uipath-typescript/core'
import { aggregateRuntimes, loadJobHistory } from '../orchestrator'
import { isTestingPath } from '@/features/schedules/calendarDisplay'
import type { RuntimeStats } from '@/features/schedules/types'
import { cacheGetEntry, cacheSet, cacheKey } from '@/features/orchestrator/cache'

const RUNTIME_STATS_TTL_MS = 4 * 60 * 60 * 1000

const testingRouteEnabled = import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
const loadStressData = testingRouteEnabled ? () => import('@/features/schedules/stressData') : null

export function useJobRuntimes(
  sdk?: UiPath | null,
  tenantName?: string,
  folderIds?: number[],
  sinceDays = 30,
) {
  const [runtimeStats, setRuntimeStats] = useState<Map<number, RuntimeStats>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const folderKey = folderIds?.join(',') ?? ''

  useEffect(() => {
    if (loadStressData && typeof window !== 'undefined' && isTestingPath(window.location.pathname)) {
      let isActive = true
      loadStressData().then((m) => {
        if (isActive) setRuntimeStats(m.stressRuntimeStats)
      })
      return () => { isActive = false }
    }

    if (!sdk || !tenantName || !folderIds?.length) return

    let isActive = true

    const load = async () => {
      await Promise.resolve()
      if (!isActive) return

      const statsKey = cacheKey('runtimeStats', sdk.config.orgName, tenantName)
      const cached = cacheGetEntry<[number, RuntimeStats][]>(statsKey)

      const revalidate = async () => {
        const rows = await loadJobHistory(sdk, tenantName, folderIds!, sinceDays)
        if (!isActive) return
        const stats = aggregateRuntimes(rows)
        cacheSet(statsKey, [...stats.entries()], RUNTIME_STATS_TTL_MS)
        setRuntimeStats(stats)
      }

      if (cached) {
        if (!isActive) return
        setRuntimeStats(new Map(cached.data))
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

  return { runtimeStats, isLoading, error }
}

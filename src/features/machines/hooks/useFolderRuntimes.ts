import { useEffect, useState } from 'react'
import type { UiPath } from '@uipath/uipath-typescript/core'
import { loadFolderRuntimes } from '../orchestrator'
import { isTestingPath } from '@/features/schedules/calendarDisplay'
import { cacheGetEntry, cacheSet, cacheKey } from '@/features/orchestrator/cache'

const FOLDER_RUNTIMES_TTL_MS = 4 * 60 * 60 * 1000

type CachedFolderRuntimes = {
  capacityRuntimes: number | null
  folderKey: string
}

const testingRouteEnabled = import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
const loadStressData = testingRouteEnabled ? () => import('@/features/schedules/stressData') : null

// Capacity for the Utilization view. Mirrors useJobRuntimes: cached per tenant and folder set,
// a stale entry is shown while it refreshes, and any failure leaves capacity unknown (null)
// rather than surfacing an error, so the view falls back to consumed hours only.
export function useFolderRuntimes(sdk?: UiPath | null, tenantName?: string, folderIds?: number[]) {
  const [capacityRuntimes, setCapacityRuntimes] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const folderKey = folderIds?.join(',') ?? ''

  useEffect(() => {
    if (loadStressData && typeof window !== 'undefined' && isTestingPath(window.location.pathname)) {
      let isActive = true
      loadStressData().then((m) => {
        if (isActive) setCapacityRuntimes(m.stressCapacityRuntimes)
      })
      return () => { isActive = false }
    }

    if (!sdk || !tenantName || !folderIds?.length) return

    let isActive = true

    const load = async () => {
      await Promise.resolve()
      if (!isActive) return

      const key = cacheKey('folderRuntimes', sdk.config.orgName, tenantName)
      const sortedFolderKey = [...folderIds].sort((a, b) => a - b).join(',')
      const cached = cacheGetEntry<CachedFolderRuntimes>(key)

      const revalidate = async () => {
        const result = await loadFolderRuntimes(sdk, tenantName, folderIds)
        if (!isActive) return
        cacheSet(key, { capacityRuntimes: result.capacityRuntimes, folderKey: sortedFolderKey }, FOLDER_RUNTIMES_TTL_MS)
        setCapacityRuntimes(result.capacityRuntimes)
      }

      if (cached && cached.data.folderKey === sortedFolderKey) {
        setCapacityRuntimes(cached.data.capacityRuntimes)
        if (cached.isStale) {
          revalidate().catch((err) => console.warn('Background folder runtime refresh failed:', err))
        }
        return
      }

      setIsLoading(true)
      try {
        await revalidate()
      } catch (err: unknown) {
        console.warn('Folder runtime load failed:', err)
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
  }, [sdk, tenantName, folderKey])

  return { capacityRuntimes, isLoading }
}

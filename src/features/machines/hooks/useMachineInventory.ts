import { useEffect, useState } from 'react'
import type { UiPath } from '@uipath/uipath-typescript/core'
import { loadMachines } from '../orchestrator'
import { isTestingPath } from '@/features/schedules/calendarDisplay'
import type { MachineInventoryEntry } from '@/features/schedules/types'
import { cacheGetEntry, cacheSet, cacheKey } from '@/features/orchestrator/cache'

const MACHINES_TTL_MS = 60 * 60 * 1000

const testingRouteEnabled = import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
const loadStressData = testingRouteEnabled ? () => import('@/features/schedules/stressData') : null

export function useMachineInventory(sdk?: UiPath | null, tenantName?: string) {
  const [machines, setMachines] = useState<MachineInventoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loadStressData && typeof window !== 'undefined' && isTestingPath(window.location.pathname)) {
      let isActive = true
      loadStressData().then((m) => {
        if (isActive) setMachines(m.stressMachineInventory)
      })
      return () => { isActive = false }
    }

    if (!sdk || !tenantName) return

    let isActive = true

    const load = async () => {
      await Promise.resolve()
      if (!isActive) return

      const machinesKey = cacheKey('machines', sdk.config.orgName, tenantName)
      const cached = cacheGetEntry<MachineInventoryEntry[]>(machinesKey)

      const revalidate = async () => {
        const result = await loadMachines(sdk, tenantName)
        if (!isActive) return
        cacheSet(machinesKey, result, MACHINES_TTL_MS)
        setMachines(result)
      }

      if (cached) {
        if (!isActive) return
        setMachines(cached.data)
        if (cached.isStale) {
          revalidate().catch((err) => console.warn('Background machine refresh failed:', err))
        }
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        await revalidate()
      } catch (err: unknown) {
        if (!isActive) return
        setError(err instanceof Error ? err.message : 'Failed to load machine inventory')
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    load()

    return () => {
      isActive = false
    }
  }, [sdk, tenantName])

  return { machines, isLoading, error }
}

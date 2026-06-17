import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UiPath } from '@uipath/uipath-typescript/core'
import {
  defaultTenantName,
  emptyTenants,
  fallbackTenant,
  tenantToOption,
} from '../constants'
import { isTestingPath } from '../calendarDisplay'
import { loadProcessSchedules, loadTenants } from '../orchestrator'
import type { LoadSchedulesResult, TenantInfo } from '../orchestrator'
import type { TenantOption } from '../types'
import { cacheGetEntry, cacheSet, cacheClear, cacheKey } from '@/features/orchestrator/cache'

const SCHEDULES_TTL_MS = 15 * 60 * 1000

type StressDataModule = typeof import('../stressData')

const testingRouteEnabled = import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
const loadStressDataModule = testingRouteEnabled ? () => import('../stressData') : null
const testingFixturesNotReadyMessage = testingRouteEnabled ? 'Testing fixtures are not ready.' : 'Data source is not ready.'
const testingFixturesLoadErrorMessage = testingRouteEnabled ? 'Failed to load testing fixtures' : 'Failed to load data source'

export function useScheduleData(sdk?: UiPath | null, configuredTenantNames: string[] = []) {
  const configuredTenantKey = configuredTenantNames.join('\u0000')
  const savedTenantNames = useMemo(
    () => configuredTenantKey.split('\u0000').map((tenant) => tenant.trim()).filter(Boolean),
    [configuredTenantKey],
  )
  const configuredDefaultTenant = savedTenantNames[0] || defaultTenantName
  const isTestingEnvironment = useMemo(
    () =>
      testingRouteEnabled && typeof window !== 'undefined'
        ? isTestingPath(window.location.pathname)
        : false,
    [],
  )
  const [stressModule, setStressModule] = useState<StressDataModule | null>(null)
  const [data, setData] = useState<LoadSchedulesResult | null>(null)
  const [tenants, setTenants] = useState<TenantInfo[]>(emptyTenants)
  const [selectedTenant, setSelectedTenant] = useState(configuredDefaultTenant)
  const [tenantError, setTenantError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRevalidating, setIsRevalidating] = useState(false)
  const selectedStressCount = useMemo(
    () => (isTestingEnvironment && stressModule ? stressModule.parseStressTenantName(selectedTenant) : null),
    [isTestingEnvironment, selectedTenant, stressModule],
  )
  const stressData = useMemo(
    () =>
      isTestingEnvironment && stressModule && selectedStressCount
        ? stressModule.createStressScheduleData(selectedStressCount)
        : null,
    [isTestingEnvironment, selectedStressCount, stressModule],
  )
  const stressTenantOptions = useMemo<TenantOption[]>(() => {
    if (!isTestingEnvironment || !stressModule) return []

    return stressModule.stressTenantInfos.map((tenant) => ({
      ...tenant,
      kind: 'stress',
      stressCount: stressModule.parseStressTenantName(tenant.name) ?? undefined,
    }))
  }, [isTestingEnvironment, stressModule])

  useEffect(() => {
    if (!isTestingEnvironment) return

    if (!loadStressDataModule) return

    let isActive = true

    const loadTestingFixtures = async () => {
      setIsLoading(true)
      setLoadError(null)

      try {
        const module = await loadStressDataModule()
        if (!isActive) return

        const stressCount =
          typeof window === 'undefined'
            ? module.defaultStressScheduleCount
            : module.parseStressScheduleCount(window.location.search) ?? module.defaultStressScheduleCount

        setStressModule(module)
        setTenants(module.stressTenantInfos)
        setTenantError(null)
        setSelectedTenant(module.stressTenantName(stressCount))
      } catch (err) {
        if (!isActive) return
        setLoadError(err instanceof Error ? err.message : testingFixturesLoadErrorMessage)
        setIsLoading(false)
      }
    }

    loadTestingFixtures()

    return () => {
      isActive = false
    }
  }, [isTestingEnvironment])

  useEffect(() => {
    if (isTestingEnvironment) return
    if (!sdk) return

    let isActive = true

    const loadTenantOptions = async () => {
      try {
        const result = await loadTenants(sdk, savedTenantNames)
        if (!isActive) return

        const loadedTenants = result.tenants.length ? result.tenants : [fallbackTenant]
        setTenants(loadedTenants)
        setTenantError(null)

        setSelectedTenant((current) => {
          if (loadedTenants.some((tenant) => tenant.name.toLowerCase() === current.toLowerCase())) {
            return current
          }
          return loadedTenants[0].name
        })
      } catch (err) {
        if (!isActive) return
        setTenants([fallbackTenant])
        setTenantError(err instanceof Error ? err.message : 'Failed to load tenants')
      }
    }

    loadTenantOptions()

    return () => {
      isActive = false
    }
  }, [isTestingEnvironment, savedTenantNames, sdk])

  useEffect(() => {
    if (!isTestingEnvironment || !selectedStressCount || typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (url.searchParams.get('stress') === String(selectedStressCount)) return

    url.searchParams.set('stress', String(selectedStressCount))
    window.history.replaceState(null, '', url)
  }, [isTestingEnvironment, selectedStressCount])

  const refresh = useCallback(async () => {
    if (!selectedTenant) return

    setIsLoading(true)
    setLoadError(null)

    if (isTestingEnvironment) {
      if (!stressData) {
        setLoadError(testingFixturesNotReadyMessage)
        setIsLoading(false)
        return
      }
      setData(stressData)
      setIsLoading(false)
      return
    }

    if (!sdk) {
      setLoadError('UiPath sign-in is not ready.')
      setIsLoading(false)
      return
    }

    const schedKey = cacheKey('schedules', sdk.config.orgName, selectedTenant)
    cacheClear(schedKey)

    try {
      const result = await loadProcessSchedules(sdk, selectedTenant, savedTenantNames)
      cacheSet(schedKey, result, SCHEDULES_TTL_MS)
      setData(result)
    } catch (err) {
      console.error('Failed to load triggers:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load triggers')
    } finally {
      setIsLoading(false)
    }
  }, [isTestingEnvironment, savedTenantNames, sdk, selectedTenant, stressData])

  useEffect(() => {
    let isActive = true

    const loadForTenant = async () => {
      await Promise.resolve()
      if (!isActive) return

      setIsLoading(true)
      setLoadError(null)

      if (isTestingEnvironment) {
        if (!stressModule || !stressData) return

        setData(stressData)
        setTenantError(null)
        setIsLoading(false)
        return
      }

      if (!sdk) {
        setIsLoading(false)
        return
      }

      const schedKey = cacheKey('schedules', sdk.config.orgName, selectedTenant)
      const cached = cacheGetEntry<LoadSchedulesResult>(schedKey)
      if (cached) {
        if (!isActive) return
        setData(cached.data)
        setLoadError(null)
        setIsLoading(false)

        // Stale-while-revalidate: serve cached instantly, refresh in background.
        if (cached.isStale) {
          setIsRevalidating(true)
          loadProcessSchedules(sdk, selectedTenant, savedTenantNames)
            .then((result) => {
              if (!isActive) return
              cacheSet(schedKey, result, SCHEDULES_TTL_MS)
              setData(result)
            })
            .catch((err) => {
              // Background refresh failure is non-fatal — cached data stays on screen.
              console.warn('Background trigger refresh failed:', err)
            })
            .finally(() => {
              if (isActive) setIsRevalidating(false)
            })
        }
        return
      }

      try {
        const result = await loadProcessSchedules(sdk, selectedTenant, savedTenantNames)
        if (!isActive) return

        cacheSet(schedKey, result, SCHEDULES_TTL_MS)
        setData(result)
        setLoadError(null)
      } catch (err) {
        console.error('Failed to load triggers:', err)
        if (isActive) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load triggers')
        }
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    loadForTenant()

    return () => {
      isActive = false
    }
  }, [isTestingEnvironment, savedTenantNames, sdk, selectedTenant, stressData, stressModule])

  const liveTenantOptions = useMemo(() => (tenants.length ? tenants : [fallbackTenant]), [tenants])
  const tenantOptions = useMemo(() => {
    if (isTestingEnvironment) return stressTenantOptions

    return liveTenantOptions.map(tenantToOption)
  }, [isTestingEnvironment, liveTenantOptions, stressTenantOptions])
  const activeTenant =
    data?.tenant ??
    tenantOptions.find((tenant) => tenant.name.toLowerCase() === selectedTenant.toLowerCase()) ??
    fallbackTenant

  const selectTenant = useCallback((tenantName: string) => {
    setSelectedTenant(tenantName)
    setLoadError(null)
    setData(null)
  }, [])

  return {
    activeTenant,
    data,
    isLoading,
    isRevalidating,
    isTestingEnvironment,
    loadError,
    refresh,
    selectTenant,
    selectedStressCount,
    selectedTenant,
    stressData,
    tenantError,
    tenantOptions,
  }
}

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiPath } from '@uipath/uipath-typescript/core'
import { cacheGetEntry, cacheSet, cacheClear, cacheKey } from '@/features/orchestrator/cache'
import { __resetLimiterForTests, schedule } from '@/features/orchestrator/rateLimiter'
import { fetchAllPages } from '@/features/orchestrator/odataClient'

describe('cache stale-while-revalidate', () => {
  const key = cacheKey('schedules', 'org', 'tenant')

  beforeEach(() => {
    cacheClear(key)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    cacheClear(key)
    vi.useRealTimers()
  })

  it('returns fresh (not stale) before the soft TTL', () => {
    cacheSet(key, { n: 1 }, { staleMs: 1000, hardMs: 4000 })
    vi.advanceTimersByTime(500)
    const entry = cacheGetEntry<{ n: number }>(key)
    expect(entry).toEqual({ data: { n: 1 }, isStale: false })
  })

  it('returns stale between soft and hard TTL', () => {
    cacheSet(key, { n: 1 }, { staleMs: 1000, hardMs: 4000 })
    vi.advanceTimersByTime(2000)
    const entry = cacheGetEntry<{ n: number }>(key)
    expect(entry).toEqual({ data: { n: 1 }, isStale: true })
  })

  it('returns null past the hard TTL', () => {
    cacheSet(key, { n: 1 }, { staleMs: 1000, hardMs: 4000 })
    vi.advanceTimersByTime(5000)
    expect(cacheGetEntry<{ n: number }>(key)).toBeNull()
  })

  it('derives hard TTL as 4x when given a single numeric TTL', () => {
    cacheSet(key, { n: 1 }, 1000)
    vi.advanceTimersByTime(2000) // past soft (1000), within hard (4000)
    expect(cacheGetEntry<{ n: number }>(key)?.isStale).toBe(true)
    vi.advanceTimersByTime(3000) // now past hard (4000)
    expect(cacheGetEntry<{ n: number }>(key)).toBeNull()
  })
})

describe('rate limiter', () => {
  beforeEach(() => {
    __resetLimiterForTests()
  })

  it('never exceeds the global concurrency cap', async () => {
    let active = 0
    let peak = 0

    const task = () =>
      schedule(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active -= 1
      })

    await Promise.all(Array.from({ length: 12 }, task))

    // MAX_CONCURRENCY is 6 in rateLimiter.ts
    expect(peak).toBeLessThanOrEqual(6)
    expect(active).toBe(0)
  })

  it('runs every scheduled task to completion', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => schedule(async () => i * 2)),
    )
    expect(results).toEqual(Array.from({ length: 8 }, (_, i) => i * 2))
  })
})

describe('fetchAllPages', () => {
  const sdk = {
    getToken: () => 'test-token',
    config: { baseUrl: 'https://cloud.uipath.com', orgName: 'org', tenantName: 'tenant' },
  } as unknown as UiPath

  afterEach(() => {
    vi.restoreAllMocks()
    __resetLimiterForTests()
  })

  it('follows @odata.nextLink across pages and stops when absent', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        value: [{ Id: 1 }, { Id: 2 }],
        '@odata.nextLink': 'https://api.uipath.com/org/tenant/orchestrator_/odata/Things?$skip=2',
      }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ value: [{ Id: 3 }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const rows = await fetchAllPages<{ Id: number }>(sdk, 'tenant', 'Things?$top=2')

    expect(rows).toEqual([{ Id: 1 }, { Id: 2 }, { Id: 3 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns a single page when there is no nextLink', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: [{ Id: 1 }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const rows = await fetchAllPages<{ Id: number }>(sdk, 'tenant', 'Things?$top=200')

    expect(rows).toEqual([{ Id: 1 }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

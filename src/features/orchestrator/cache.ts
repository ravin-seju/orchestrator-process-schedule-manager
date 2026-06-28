const CACHE_VERSION = 'v6'
const NS = `process-schedule-manager.cache.${CACHE_VERSION}`

// Soft TTL → data is served but flagged stale (triggers background revalidation).
// Hard TTL → data is discarded; a blocking fetch is required.
// When a caller passes a single numeric TTL, hard = soft × this multiplier.
const HARD_TTL_MULTIPLIER = 4

interface CacheEntry<T> {
  data: T
  staleAt: number
  expiresAt: number
}

interface TtlOptions {
  staleMs: number
  hardMs: number
}

export interface CacheLookup<T> {
  data: T
  isStale: boolean
}

function storageKey(key: string): string {
  return `${NS}.${key}`
}

function resolveTtl(ttl: number | TtlOptions): TtlOptions {
  if (typeof ttl === 'number') {
    return { staleMs: ttl, hardMs: ttl * HARD_TTL_MULTIPLIER }
  }
  return ttl
}

export function cacheKey(type: string, orgName: string, tenantName: string): string {
  return `${type}.${orgName}.${tenantName}`
}

/**
 * Stale-while-revalidate read. Returns the cached data plus an `isStale` flag
 * whenever the entry is still within its hard TTL. Past the hard TTL the entry
 * is removed and `null` is returned (forcing a blocking fetch).
 */
export function cacheGetEntry<T>(key: string): CacheLookup<T> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    const now = Date.now()
    if (now > entry.expiresAt) {
      window.localStorage.removeItem(storageKey(key))
      return null
    }
    return { data: entry.data, isStale: now > entry.staleAt }
  } catch {
    return null
  }
}

export function cacheSet<T>(key: string, data: T, ttl: number | TtlOptions): void {
  try {
    const { staleMs, hardMs } = resolveTtl(ttl)
    const now = Date.now()
    const entry: CacheEntry<T> = { data, staleAt: now + staleMs, expiresAt: now + hardMs }
    window.localStorage.setItem(storageKey(key), JSON.stringify(entry))
  } catch {
    // QuotaExceededError or restricted environment — skip caching silently
  }
}

export function cacheClear(key: string): void {
  try {
    window.localStorage.removeItem(storageKey(key))
  } catch {
    // ignore
  }
}

export function cacheClearAll(): void {
  try {
    const toRemove = Object.keys(window.localStorage).filter((k) => k.startsWith(NS))
    toRemove.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    // ignore
  }
}

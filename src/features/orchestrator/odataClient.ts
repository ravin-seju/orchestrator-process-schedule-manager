import type { UiPath } from '@uipath/uipath-typescript/core'
import { schedule } from './rateLimiter'

export interface ODataCollection<T> {
  '@odata.nextLink'?: string
  value?: T[]
}

const readODataError = async (response: Response) => {
  const text = await response.text()
  if (!text) return `${response.status} ${response.statusText}`

  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string }
      message?: string
    }

    return typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.message ?? parsed.message ?? text
  } catch {
    return text
  }
}

export const getAccessToken = (sdk: UiPath) => {
  const token = sdk.getToken()
  if (!token) {
    throw new Error('UiPath sign-in token is unavailable. Sign in again and retry.')
  }

  return token
}

export const deriveApiBaseUrl = (baseUrl: string) => {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

  try {
    const parsed = new URL(normalizedBaseUrl)
    if (parsed.hostname === 'staging.uipath.com') return 'https://staging.api.uipath.com'
    if (parsed.hostname === 'cloud.uipath.com') return 'https://api.uipath.com'
    if (parsed.hostname === 'alpha.uipath.com') return 'https://alpha.api.uipath.com'
    if (
      parsed.hostname === 'staging.api.uipath.com' ||
      parsed.hostname === 'api.uipath.com' ||
      parsed.hostname === 'alpha.api.uipath.com'
    ) {
      return parsed.origin
    }

    return normalizedBaseUrl
  } catch {
    return normalizedBaseUrl
  }
}

export const odataUrl = (sdk: UiPath, tenantName: string, path: string) => {
  const apiBase = deriveApiBaseUrl(sdk.config.baseUrl)
  const baseUrl = apiBase.endsWith('/') ? apiBase : `${apiBase}/`
  const orgPath = encodeURIComponent(sdk.config.orgName)
  const tenantPath = encodeURIComponent(tenantName)
  const normalizedPath = path.replace(/^\//, '')

  return new URL(`${orgPath}/${tenantPath}/orchestrator_/odata/${normalizedPath}`, baseUrl).toString()
}

export class ODataFetchError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ODataFetchError'
    this.status = status
  }
}

export const fetchODataMetadata = async (sdk: UiPath, tenantName: string): Promise<string> => {
  const headers = {
    Accept: 'application/xml',
    Authorization: `Bearer ${getAccessToken(sdk)}`,
  }
  const response = await fetch(odataUrl(sdk, tenantName, '$metadata'), { headers })
  if (!response.ok) {
    const message = await readODataError(response)
    throw new ODataFetchError(message, response.status)
  }
  return response.text()
}

export async function settledBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batchResults = await Promise.allSettled(items.slice(i, i + concurrency).map(fn))
    results.push(...batchResults)
  }
  return results
}

export const fetchOData = async <T>(
  sdk: UiPath,
  tenantName: string,
  path: string,
  folderId?: number,
): Promise<ODataCollection<T>> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${getAccessToken(sdk)}`,
  }

  if (folderId !== undefined) {
    headers['X-UIPATH-OrganizationUnitId'] = String(folderId)
  }

  const url = odataUrl(sdk, tenantName, path)
  const MAX_RETRIES = 3

  // Every request flows through the global limiter (concurrency + rate pacing),
  // so all data hooks share one tenant-wide budget. 429-retry stays inside.
  return schedule(async () => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, { headers })

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfterSec = Number(response.headers.get('Retry-After') ?? 0)
        const base = retryAfterSec > 0 ? retryAfterSec * 1000 : Math.min(1000 * 2 ** attempt, 30_000)
        await new Promise((r) => setTimeout(r, base + Math.random() * 200))
        continue
      }

      if (!response.ok) {
        const message = await readODataError(response)
        throw new ODataFetchError(message, response.status)
      }

      return response.json() as Promise<ODataCollection<T>>
    }

    throw new ODataFetchError('Rate limit exceeded after retries', 429)
  })
}

/**
 * Fetch every page of an OData collection, following `@odata.nextLink` until
 * exhausted. Concatenates `value` arrays across pages.
 */
export const fetchAllPages = async <T>(
  sdk: UiPath,
  tenantName: string,
  path: string,
  folderId?: number,
): Promise<T[]> => {
  const results: T[] = []
  let nextPath: string | null = path

  while (nextPath) {
    const response: ODataCollection<T> = await fetchOData<T>(sdk, tenantName, nextPath, folderId)
    results.push(...(response.value ?? []))

    const nextLink: string | undefined = response['@odata.nextLink']
    if (!nextLink) break
    const odataIndex: number = nextLink.indexOf('/odata/')
    nextPath = odataIndex !== -1 ? nextLink.slice(odataIndex + 7) : null
  }

  return results
}

import { getAppBase } from '@uipath/uipath-typescript'
import type { UiPathSDKConfig } from '@uipath/uipath-typescript/core'

export const REQUIRED_ORCHESTRATOR_SCOPES = [
  'OR.Folders.Read',
  'OR.Execution.Read',
  'OR.Jobs.Read',
  'OR.Machines.Read',
  'OR.Robots.Read',
] as const
export const REQUIRED_ORCHESTRATOR_SCOPE_TEXT = REQUIRED_ORCHESTRATOR_SCOPES.join(' ')

export interface AuthConfigExternalAppInput {
  name: string
  clientId: string
  scope: string
  urlAppRedirect: string
}

export interface AuthConfigEntry {
  clientId: string
  organization: string
  organizationSlug: string
  scope: string
  tenant: string
  urlApp: string
  urlAppRedirect: string
  urlBase: string
}

export interface AuthConfigGroupInput {
  organization: string
  organizationSlug?: string
  tenants: string[]
  urlApp: string
  urlBase: string
  externalApps: AuthConfigExternalAppInput[]
}

export interface StoredAuthConfigGroup extends AuthConfigGroupInput {
  id: string
  organizationSlug: string
  source: 'env' | 'custom'
}

export interface StoredAuthConfig extends AuthConfigEntry {
  id: string
  groupId: string
  name: string
  source: 'env' | 'custom'
  tenants: string[]
}

export type NewAuthConfigInput = AuthConfigGroupInput

export type ConnectionDefaults = {
  clientId: string
  organization: string
  redirectUri: string
  tenants: string
  urlApp: string
}

const CUSTOM_AUTH_CONFIGS_STORAGE_KEY = 'process-schedule-manager.oauth.custom-auth-configs'
const ACTIVE_AUTH_CONFIG_STORAGE_KEY = 'process-schedule-manager.oauth.active-auth-config-id'
const SCOPES_ACKNOWLEDGED_STORAGE_KEY = 'process-schedule-manager.oauth.scopes-acknowledged'

const getStorage = () => {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const normalizeOrganizationSlug = (organization: string): string =>
  organization.trim().toLowerCase()

export function parseScopes(scope: string): string[] {
  return Array.from(
    new Set(
      scope
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
}

export function getMissingRequiredScopes(scope: string): string[] {
  const configuredScopes = new Set(parseScopes(scope))
  return REQUIRED_ORCHESTRATOR_SCOPES.filter((requiredScope) => !configuredScopes.has(requiredScope))
}

// One-time-per-connection acknowledgment that the External App must grant all required scopes.
// Keyed by groupId because the scope grant lives on the External App (one clientId = one group),
// shared across that group's tenant entries. Used to show the confirm step once, not every sign-in.
function readAcknowledgedScopeGroupIds(): string[] {
  const storage = getStorage()
  if (!storage) return []

  try {
    const raw = storage.getItem(SCOPES_ACKNOWLEDGED_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function isScopeAcknowledged(groupId: string): boolean {
  return readAcknowledgedScopeGroupIds().includes(groupId)
}

export function acknowledgeScopeGroup(groupId: string): void {
  const storage = getStorage()
  if (!storage || !groupId) return

  const acknowledged = new Set(readAcknowledgedScopeGroupIds())
  acknowledged.add(groupId)
  storage.setItem(SCOPES_ACKNOWLEDGED_STORAGE_KEY, JSON.stringify([...acknowledged]))
}

export function deriveApiBaseUrl(urlApp: string): string {
  const normalizedUrl = urlApp.trim().replace(/\/$/, '')
  if (!normalizedUrl) return ''

  try {
    const parsed = new URL(normalizedUrl)
    if (parsed.hostname === 'cloud.uipath.com') return 'https://api.uipath.com'
    if (parsed.hostname === 'staging.uipath.com') return 'https://staging.api.uipath.com'
    if (parsed.hostname === 'alpha.uipath.com') return 'https://alpha.api.uipath.com'
    return normalizedUrl
  } catch {
    return normalizedUrl
  }
}

export function normalizeSdkBaseUrl(baseUrl: string): string {
  const fallback = 'https://cloud.uipath.com'
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '')
  if (!normalizedBaseUrl) return fallback

  try {
    const parsed = new URL(normalizedBaseUrl)
    if (parsed.hostname === 'api.uipath.com') parsed.hostname = 'cloud.uipath.com'
    if (parsed.hostname === 'staging.api.uipath.com') parsed.hostname = 'staging.uipath.com'
    if (parsed.hostname === 'alpha.api.uipath.com') parsed.hostname = 'alpha.uipath.com'

    if (
      parsed.hostname === 'cloud.uipath.com' ||
      parsed.hostname === 'staging.uipath.com' ||
      parsed.hostname === 'alpha.uipath.com'
    ) {
      return parsed.origin
    }

    return parsed.toString().replace(/\/$/, '')
  } catch {
    return normalizedBaseUrl
  }
}

export function getDefaultRedirectUri(redirectOrigin = window.location.origin): string {
  try {
    const appBase = getAppBase()
    if (!appBase || appBase === '/') return redirectOrigin

    return new URL(appBase, redirectOrigin).toString().replace(/\/$/, '')
  } catch {
    return redirectOrigin
  }
}

function sanitizeExternalApps(
  externalApps: AuthConfigExternalAppInput[],
  { forceRequiredScope = false }: { forceRequiredScope?: boolean } = {},
): AuthConfigExternalAppInput[] {
  return externalApps
    .map((externalApp) => ({
      clientId: externalApp.clientId.trim(),
      name: externalApp.name.trim(),
      scope: forceRequiredScope
        ? [...new Set([...parseScopes(REQUIRED_ORCHESTRATOR_SCOPE_TEXT), ...parseScopes(externalApp.scope)])].join(' ')
        : externalApp.scope.trim(),
      urlAppRedirect: externalApp.urlAppRedirect.trim(),
    }))
    .filter((externalApp) => externalApp.clientId)
}

function buildConfigName(config: {
  clientId: string
  organization: string
  tenant?: string
  tenants?: string[]
}) {
  const tenantLabel = config.tenant || config.tenants?.[0] || ''
  const orgTenant = [config.organization, tenantLabel].filter(Boolean).join(' / ')
  if (orgTenant) return orgTenant
  if (config.clientId) return `Client ${config.clientId.slice(0, 8)}`
  return 'Connection'
}

function normalizeGroup(group: StoredAuthConfigGroup): StoredAuthConfig[] {
  const tenants = group.tenants.length ? group.tenants : ['']
  const externalApps = sanitizeExternalApps(group.externalApps)
  const organizationSlug = normalizeOrganizationSlug(group.organizationSlug || group.organization)

  return externalApps.flatMap((externalApp, appIndex) =>
    tenants.map((tenant, tenantIndex) => ({
      clientId: externalApp.clientId,
      groupId: group.id,
      id: `${group.id}-${appIndex}-${tenantIndex}`,
      name: externalApp.name || buildConfigName({
        clientId: externalApp.clientId,
        organization: group.organization,
        tenant,
        tenants,
      }),
      organization: group.organization,
      organizationSlug,
      scope: externalApp.scope,
      source: group.source,
      tenant,
      tenants,
      urlApp: group.urlApp,
      urlAppRedirect: externalApp.urlAppRedirect,
      urlBase: group.urlBase,
    })),
  )
}

export function getConnectionDefaults(redirectOrigin = window.location.origin): ConnectionDefaults {
  return {
    clientId: '',
    organization: '',
    redirectUri: getDefaultRedirectUri(redirectOrigin),
    tenants: '',
    urlApp: '',
  }
}

function readCustomAuthConfigGroups(): StoredAuthConfigGroup[] {
  const storage = getStorage()
  if (!storage) return []

  try {
    const rawConfigs = storage.getItem(CUSTOM_AUTH_CONFIGS_STORAGE_KEY)
    if (!rawConfigs) return []

    const parsedConfigs = JSON.parse(rawConfigs) as Array<StoredAuthConfigGroup & { organizationSlug?: string }>
    return parsedConfigs
      .map((group) => {
        const organization = group.organization?.trim() ?? ''
        const organizationSlug = normalizeOrganizationSlug(group.organizationSlug || organization)

        return {
          ...group,
          externalApps: sanitizeExternalApps(group.externalApps ?? []),
          organization,
          organizationSlug,
          source: 'custom' as const,
          tenants: Array.from(new Set((group.tenants ?? []).map((tenant) => tenant.trim()).filter(Boolean))),
          urlBase: group.urlBase || deriveApiBaseUrl(group.urlApp),
        }
      })
      .filter((group) => group.id && group.organization && group.urlApp && group.externalApps.length)
  } catch {
    return []
  }
}

function writeCustomAuthConfigGroups(configs: StoredAuthConfigGroup[]) {
  const storage = getStorage()
  if (!storage) return

  storage.setItem(CUSTOM_AUTH_CONFIGS_STORAGE_KEY, JSON.stringify(configs))
}

function getAvailableAuthConfigGroups(): StoredAuthConfigGroup[] {
  return readCustomAuthConfigGroups()
}

export function getAvailableAuthConfigs(): StoredAuthConfig[] {
  return getAvailableAuthConfigGroups().flatMap(normalizeGroup)
}

export function getSelectedAuthConfigId(configs = getAvailableAuthConfigs()): string | null {
  const storage = getStorage()
  const storedId = storage?.getItem(ACTIVE_AUTH_CONFIG_STORAGE_KEY)

  if (storedId && configs.some((config) => config.id === storedId)) return storedId
  return null
}

export function setSelectedAuthConfigId(configId: string | null): void {
  const storage = getStorage()
  if (!storage) return

  if (!configId) {
    storage.removeItem(ACTIVE_AUTH_CONFIG_STORAGE_KEY)
    return
  }

  storage.setItem(ACTIVE_AUTH_CONFIG_STORAGE_KEY, configId)
}

export function getAuthConfigById(configId: string | null | undefined): StoredAuthConfig | null {
  if (!configId) return null

  return getAvailableAuthConfigs().find((config) => config.id === configId) ?? null
}

export function getAuthConfigGroupById(groupId: string): StoredAuthConfigGroup | null {
  return getAvailableAuthConfigGroups().find((group) => group.id === groupId) ?? null
}

export function addCustomAuthConfig(config: NewAuthConfigInput): StoredAuthConfig {
  const organization = config.organization.trim()
  const nextGroup: StoredAuthConfigGroup = {
    externalApps: sanitizeExternalApps(config.externalApps, { forceRequiredScope: true }),
    id: `custom-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString()}`,
    organization,
    organizationSlug: normalizeOrganizationSlug(config.organizationSlug || organization),
    source: 'custom',
    tenants: Array.from(new Set(config.tenants.map((tenant) => tenant.trim()).filter(Boolean))),
    urlApp: config.urlApp.trim(),
    urlBase: config.urlBase || deriveApiBaseUrl(config.urlApp),
  }

  writeCustomAuthConfigGroups([...readCustomAuthConfigGroups(), nextGroup])
  return normalizeGroup(nextGroup)[0]
}

export function updateCustomAuthConfig(
  groupId: string,
  config: NewAuthConfigInput,
  preferredTenant?: string,
  preferredName?: string,
): StoredAuthConfig {
  const organization = config.organization.trim()
  const nextGroup: StoredAuthConfigGroup = {
    externalApps: sanitizeExternalApps(config.externalApps, { forceRequiredScope: true }),
    id: groupId,
    organization,
    organizationSlug: normalizeOrganizationSlug(config.organizationSlug || organization),
    source: 'custom',
    tenants: Array.from(new Set(config.tenants.map((tenant) => tenant.trim()).filter(Boolean))),
    urlApp: config.urlApp.trim(),
    urlBase: config.urlBase || deriveApiBaseUrl(config.urlApp),
  }
  const existingGroups = readCustomAuthConfigGroups()

  writeCustomAuthConfigGroups(existingGroups.map((group) => (group.id === groupId ? nextGroup : group)))

  const normalized = normalizeGroup(nextGroup)
  return (
    normalized.find((entry) => entry.tenant === preferredTenant && entry.name === preferredName) ??
    normalized.find((entry) => entry.tenant === preferredTenant) ??
    normalized[0]
  )
}

export function deleteCustomAuthConfigGroup(groupId: string): StoredAuthConfig[] {
  const existingGroups = readCustomAuthConfigGroups()
  const nextGroups = existingGroups.filter((group) => group.id !== groupId)

  writeCustomAuthConfigGroups(nextGroups)

  const nextConfigs = getAvailableAuthConfigs()
  const selectedConfigId = getStorage()?.getItem(ACTIVE_AUTH_CONFIG_STORAGE_KEY)
  if (selectedConfigId && !nextConfigs.some((config) => config.id === selectedConfigId)) {
    setSelectedAuthConfigId(null)
  }

  return nextConfigs
}

export function resetCustomAuthConfigs(): StoredAuthConfig[] {
  const storage = getStorage()
  storage?.removeItem(CUSTOM_AUTH_CONFIGS_STORAGE_KEY)
  storage?.removeItem(ACTIVE_AUTH_CONFIG_STORAGE_KEY)
  storage?.removeItem(SCOPES_ACKNOWLEDGED_STORAGE_KEY)

  return getAvailableAuthConfigs()
}

export function buildOAuthConfigFromAuthConfig(
  authConfig: StoredAuthConfig,
  redirectOrigin = window.location.origin,
): UiPathSDKConfig {
  return {
    baseUrl: normalizeSdkBaseUrl(authConfig.urlApp),
    clientId: authConfig.clientId,
    orgName: authConfig.organizationSlug,
    redirectUri: authConfig.urlAppRedirect || getDefaultRedirectUri(redirectOrigin),
    scope: authConfig.scope,
    tenantName: authConfig.tenant || 'DefaultTenant',
  }
}

export function buildOAuthConfig(redirectOrigin = window.location.origin): UiPathSDKConfig {
  const configs = getAvailableAuthConfigs()
  const authConfig = configs[0]

  if (!authConfig) {
    throw new Error('No saved UiPath connection is available. Add a connection before signing in.')
  }

  return buildOAuthConfigFromAuthConfig(authConfig, redirectOrigin)
}

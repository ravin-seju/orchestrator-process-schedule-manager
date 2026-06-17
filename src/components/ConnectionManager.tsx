import { useMemo, useState } from 'react'
import { Check, Copy, Edit3, Plus, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react'
import { V11_ENABLED } from '@/features/v11'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getEnvironmentDisplayLabel } from '../features/schedules/constants'
import { useAuth } from '../hooks/useAuth'
import {
  deriveApiBaseUrl,
  getConnectionDefaults,
  getMissingRequiredScopes,
  REQUIRED_ORCHESTRATOR_SCOPES,
  REQUIRED_ORCHESTRATOR_SCOPE_TEXT,
} from '../uipathConfig'
import type { StoredAuthConfig } from '../uipathConfig'

type ConnectionFormState = {
  clientId: string
  extendedScopes: boolean
  organization: string
  redirectUri: string
  tenants: string
  urlApp: string
}

const emptyForm: ConnectionFormState = {
  clientId: '',
  extendedScopes: false,
  organization: '',
  redirectUri: '',
  tenants: '',
  urlApp: '',
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard API unavailable; fail silently
    }
  }
  return (
    <button
      type="button"
      className="connection-setup-copy"
      onClick={handleCopy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  )
}

const parseTenants = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((tenant) => tenant.trim())
      .filter(Boolean),
    ),
  )

function connectionToForm(config: StoredAuthConfig | null): ConnectionFormState {
  if (!config) return emptyForm

  return {
    clientId: config.clientId,
    extendedScopes: config.scope.includes('OR.Machines.Read'),
    organization: config.organization,
    redirectUri: config.urlAppRedirect,
    tenants: config.tenants.join(', '),
    urlApp: config.urlApp,
  }
}

const getUniqueConnectionOptions = (configs: StoredAuthConfig[]) => {
  const seen = new Set<string>()

  return configs.filter((config) => {
    if (seen.has(config.groupId)) return false
    seen.add(config.groupId)
    return true
  })
}

const connectionOptionLabel = (config: StoredAuthConfig) => config.organization

const setupSteps = [
  'Create a non-confidential UiPath External App.',
  'Add the Orchestrator API user scopes required by this app.',
  'Register this app URL as a redirect URI in the External App.',
  'Make sure signed-in users have access to the tenants and folders they need to inspect.',
]

export function ConnectionManager({ compact = false }: { compact?: boolean }) {
  const {
    activeAuthConfig,
    addAuthConfig,
    authConfigs,
    deleteAuthConfigGroup,
    resetAuthConfigs,
    selectAuthConfig,
    updateAuthConfig,
  } = useAuth()
  const [form, setForm] = useState<ConnectionFormState>(emptyForm)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [mode, setMode] = useState<'add' | 'edit'>('add')
  const [editingConfig, setEditingConfig] = useState<StoredAuthConfig | null>(null)
  const savedConnectionOptions = useMemo(() => getUniqueConnectionOptions(authConfigs), [authConfigs])
  const [pendingConnectionGroupId, setPendingConnectionGroupId] = useState(
    activeAuthConfig?.groupId ?? savedConnectionOptions[0]?.groupId ?? '',
  )
  const [confirmingConnection, setConfirmingConnection] = useState<StoredAuthConfig | null>(null)
  const [confirmingDeleteConnection, setConfirmingDeleteConnection] = useState<StoredAuthConfig | null>(null)
  const formTenants = useMemo(() => parseTenants(form.tenants), [form.tenants])
  const activeConfigMissingScopes = useMemo(
    () => (activeAuthConfig ? getMissingRequiredScopes(activeAuthConfig.scope) : []),
    [activeAuthConfig],
  )
  const derivedApiBaseUrl = useMemo(() => deriveApiBaseUrl(form.urlApp), [form.urlApp])
  const setupRedirectUri = form.redirectUri.trim() || getConnectionDefaults().redirectUri
  const canSave =
    form.urlApp.trim().length > 0 &&
    form.organization.trim().length > 0 &&
    form.clientId.trim().length > 0 &&
    formTenants.length > 0

  const updateForm = (field: keyof ConnectionFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const openAddForm = () => {
    setMode('add')
    setEditingConfig(null)
    setForm(emptyForm)
    setIsFormOpen(true)
  }

  const openEditForm = () => {
    const configToEdit = selectedPendingConnection ?? activeAuthConfig
    if (!configToEdit || configToEdit.source !== 'custom') return

    setMode('edit')
    setEditingConfig(configToEdit)
    setForm(connectionToForm(configToEdit))
    setIsFormOpen(true)
  }

  const applySavedConnection = (config: StoredAuthConfig) => {
    selectAuthConfig(config.id)
    setIsFormOpen(false)
  }

  const requestSavedConnectionSwitch = () => {
    const nextConnection = selectedPendingConnection
    if (!nextConnection) return

    if (!activeAuthConfig || nextConnection.groupId === activeAuthConfig.groupId) {
      applySavedConnection(nextConnection)
      return
    }

    setConfirmingConnection(nextConnection)
  }

  const saveForm = () => {
    if (!canSave) return

    const payload = {
      externalApps: [
        {
          clientId: form.clientId.trim(),
          name: '',
          scope: V11_ENABLED && form.extendedScopes
            ? `${REQUIRED_ORCHESTRATOR_SCOPE_TEXT} OR.Machines.Read OR.Robots.Read`
            : REQUIRED_ORCHESTRATOR_SCOPE_TEXT,
          urlAppRedirect: setupRedirectUri,
        },
      ],
      organization: form.organization.trim(),
      organizationSlug: form.organization.trim().toLowerCase(),
      tenants: formTenants,
      urlApp: form.urlApp.trim(),
      urlBase: derivedApiBaseUrl,
    }

    const nextConfig =
      mode === 'edit' && editingConfig?.source === 'custom'
        ? updateAuthConfig(editingConfig.groupId, payload, editingConfig.tenant, editingConfig.name)
        : addAuthConfig(payload, { activate: !activeAuthConfig })

    setPendingConnectionGroupId(nextConfig.groupId)
    setEditingConfig(null)

    setIsFormOpen(false)
  }

  const resetConnections = () => {
    const shouldReset = window.confirm('Clear all saved UiPath connections from this app?')
    if (!shouldReset) return

    resetAuthConfigs()
    setIsFormOpen(false)
    setPendingConnectionGroupId('')
  }

  const deleteSelectedConnection = () => {
    const connectionToDelete = confirmingDeleteConnection
    if (!connectionToDelete) return

    const nextConfigs = deleteAuthConfigGroup(connectionToDelete.groupId)
    const fallbackConnection =
      nextConfigs.find((config) => config.groupId === activeAuthConfig?.groupId) ??
      nextConfigs[0] ??
      null

    setConfirmingDeleteConnection(null)
    setPendingConnectionGroupId(fallbackConnection?.groupId ?? '')
  }

  const hasSavedConnections = authConfigs.length > 0
  const selectedPendingConnection =
    savedConnectionOptions.find((config) => config.groupId === pendingConnectionGroupId) ??
    savedConnectionOptions.find((config) => config.groupId === activeAuthConfig?.groupId) ??
    savedConnectionOptions[0] ??
    null
  const selectedConnectionMissingScopes = selectedPendingConnection
    ? getMissingRequiredScopes(selectedPendingConnection.scope)
    : []
  const isSelectedActive = Boolean(
    activeAuthConfig &&
    selectedPendingConnection &&
    selectedPendingConnection.groupId === activeAuthConfig.groupId,
  )
  const canDeleteSelectedConnection = Boolean(
    selectedPendingConnection &&
    selectedPendingConnection.source === 'custom' &&
    !isSelectedActive,
  )
  const shouldShowSetupGuide = mode === 'add'
  const formDescription = mode === 'edit'
    ? 'Update the saved UiPath connection used by this app.'
    : shouldShowSetupGuide
      ? 'Connect this app to your UiPath organization.'
      : 'Add another saved UiPath connection for this app.'

  return (
    <section className={`connection-manager ${compact ? 'is-compact' : ''}`} aria-label="UiPath connection manager">
      {!hasSavedConnections ? (
        <div className="connection-empty-state">
          <div>
            <h2>Set up your UiPath connection</h2>
            <p>Authorize this app to read your Orchestrator triggers.</p>
          </div>
          <ol>
            {setupSteps.map((step, index) => (
              <li key={step}>
                <span className="connection-empty-state-step-number" aria-hidden="true">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {hasSavedConnections ? (
        <div className="saved-connection-list" aria-label="Saved connections">
          <div className="saved-connection-list-heading">
            <span>Saved Connections</span>
            <small>Choose the organization and environment this app should use.</small>
          </div>
          <div className="saved-connection-select-row">
            <label className="connection-field saved-connection-select-field">
              <span>Connection</span>
              <Select
                value={selectedPendingConnection?.groupId ?? ''}
                onValueChange={setPendingConnectionGroupId}
              >
                <SelectTrigger aria-label="Saved connection">
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  {savedConnectionOptions.map((config) => (
                    <SelectItem key={config.groupId} value={config.groupId}>
                      {connectionOptionLabel(config)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {selectedPendingConnection ? (
              <span className="connection-environment-badge">{getEnvironmentDisplayLabel(selectedPendingConnection.urlApp)}</span>
            ) : null}
            <button
              className={`secondary-action ${isSelectedActive ? 'active-status' : ''}`}
              disabled={!selectedPendingConnection || isSelectedActive}
              onClick={requestSavedConnectionSwitch}
              type="button"
            >
              {isSelectedActive ? 'Active' : 'Switch'}
            </button>
            {canDeleteSelectedConnection && selectedPendingConnection ? (
              <button
                aria-label="Delete selected connection"
                className="icon-button connection-delete-button"
                onClick={() => setConfirmingDeleteConnection(selectedPendingConnection)}
                title="Delete selected connection"
                type="button"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {selectedPendingConnection ? (
            <div className="saved-connection-preview" aria-live="polite">
              <span>Tenants: {selectedPendingConnection.tenants.join(', ')}</span>
              {selectedConnectionMissingScopes.length ? (
                <strong>Missing scopes: {selectedConnectionMissingScopes.join(', ')}</strong>
              ) : null}
            </div>
          ) : null}
          <Dialog
            open={Boolean(confirmingConnection)}
            onOpenChange={(isOpen) => {
              if (!isOpen) setConfirmingConnection(null)
            }}
          >
            <DialogContent
              aria-label="Confirm connection switch"
              className="connection-confirmation-card"
              showClose={false}
              elevated
            >
              <div>
                <DialogTitle asChild>
                  <h3>Switch connection?</h3>
                </DialogTitle>
                <DialogDescription asChild>
                  <p>Switching the organization will close the current UiPath connection and load the selected connection.</p>
                </DialogDescription>
              </div>
              <div className="connection-form-actions">
                <button className="secondary-action" type="button" onClick={() => setConfirmingConnection(null)}>
                  No
                </button>
                <button
                  className="auth-action inline"
                  type="button"
                  onClick={() => {
                    if (confirmingConnection) applySavedConnection(confirmingConnection)
                    setConfirmingConnection(null)
                  }}
                >
                  Yes
                </button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog
            open={Boolean(confirmingDeleteConnection)}
            onOpenChange={(isOpen) => {
              if (!isOpen) setConfirmingDeleteConnection(null)
            }}
          >
            <DialogContent
              aria-label="Confirm connection delete"
              className="connection-confirmation-card"
              showClose={false}
              elevated
            >
              <div>
                <DialogTitle asChild>
                  <h3>Delete connection?</h3>
                </DialogTitle>
                <DialogDescription asChild>
                  <p>This removes the saved connection from this browser. It will not change UiPath or the External App.</p>
                </DialogDescription>
              </div>
              <div className="connection-form-actions">
                <button className="secondary-action" type="button" onClick={() => setConfirmingDeleteConnection(null)}>
                  No
                </button>
                <button className="auth-action inline danger-action" type="button" onClick={deleteSelectedConnection}>
                  Yes
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      {activeAuthConfig && activeConfigMissingScopes.length ? (
        <p className="connection-help connection-help-warning">
          Current connection is missing required scopes: {activeConfigMissingScopes.join(', ')}.
        </p>
      ) : null}

      <div className="connection-actions">
        <button
          className={hasSavedConnections ? 'secondary-action' : 'auth-action inline'}
          type="button"
          onClick={openAddForm}
          aria-label="Add connection"
        >
          <Plus size={14} aria-hidden="true" />
          Add
        </button>
        {hasSavedConnections ? (
          <>
            <button
              className="secondary-action"
              type="button"
              onClick={openEditForm}
              disabled={!selectedPendingConnection || selectedPendingConnection.source !== 'custom'}
              aria-label="Edit connection"
            >
              <Edit3 size={14} aria-hidden="true" />
              Edit
            </button>
            <button
              className="secondary-action danger"
              type="button"
              onClick={resetConnections}
              aria-label="Reset connections"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Reset
            </button>
          </>
        ) : null}
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent
          aria-label={`${mode === 'edit' ? 'Edit' : 'Add'} connection`}
          className="connection-form"
          showClose={false}
        >
            <div className="connection-form-header">
              <div>
                <DialogTitle asChild>
                  <h2>{mode === 'edit' ? 'Edit Connection' : 'Add Connection'}</h2>
                </DialogTitle>
                <DialogDescription asChild>
                  <p>{formDescription}</p>
                </DialogDescription>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsFormOpen(false)} aria-label="Close connection form">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="connection-form-grid">
              <label className="connection-field">
                <span>UiPath Platform URL</span>
                <input value={form.urlApp} onChange={(event) => updateForm('urlApp', event.target.value)} placeholder="https://cloud.uipath.com" />
              </label>
              <label className="connection-field">
                <span>Organization</span>
                <input value={form.organization} onChange={(event) => updateForm('organization', event.target.value)} placeholder="your-organization" />
              </label>
              <label className="connection-field full-width tenants-field">
                <span>Tenants</span>
                <input value={form.tenants} onChange={(event) => updateForm('tenants', event.target.value)} placeholder="DefaultTenant" />
                <small className="connection-field-hint">Separate multiple tenants with commas.</small>
              </label>
              <label className="connection-field full-width">
                <span>Client ID</span>
                <input value={form.clientId} onChange={(event) => updateForm('clientId', event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
              </label>
            </div>

            {shouldShowSetupGuide ? (
              <section className="connection-setup-guide" aria-label="Setup Instructions">
                <div className="connection-setup-heading">
                  <h3>Setup Instructions</h3>
                  <p>Use these values when creating the non-confidential External App in UiPath.</p>
                </div>
                <div className="connection-setup-trust" role="note">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>No client secret is required or stored — sign-in happens directly in this app.</span>
                </div>
                <div className="connection-setup-values">
                  <div className="connection-setup-row">
                    <span>App type</span>
                    <strong>Non-confidential External App</strong>
                    <CopyButton value="Non-confidential External App" label="App type" />
                  </div>
                  <div className="connection-setup-row connection-setup-row-scopes">
                    <span>Required access</span>
                    <div className="connection-scope-chips">
                      {REQUIRED_ORCHESTRATOR_SCOPES.map((scope) => (
                        <span key={scope} className="connection-scope-chip">{scope}</span>
                      ))}
                    </div>
                    <CopyButton value={REQUIRED_ORCHESTRATOR_SCOPE_TEXT} label="Required access scopes" />
                  </div>
                  {V11_ENABLED && (
                    <div className="connection-setup-row connection-extended-scope-row">
                      <label className="connection-extended-scope-toggle">
                        <input
                          type="checkbox"
                          checked={form.extendedScopes}
                          onChange={(e) => setForm((f) => ({ ...f, extendedScopes: e.target.checked }))}
                        />
                        <span>
                          Request machine &amp; robot data
                          <em> — requires OR.Machines.Read and OR.Robots.Read on your External App</em>
                        </span>
                      </label>
                    </div>
                  )}
                  <div className="connection-setup-row">
                    <span>Redirect URI</span>
                    <strong>{setupRedirectUri}</strong>
                    <CopyButton value={setupRedirectUri} label="Redirect URI" />
                  </div>
                </div>
                <div className="connection-setup-tips">
                  <h4>Tips</h4>
                  <ul>
                    <li>Use a client ID from the same UiPath organization and environment as the UiPath Platform URL.</li>
                    <li>For a deployed coded app, register the deployed app URL as the redirect URI. Localhost only works for local development.</li>
                    <li>Organization display casing is preserved; API calls use the lowercase org slug.</li>
                    <li>Add every supported tenant above. Signed-in users need access to the tenants and folders they should inspect.</li>
                  </ul>
                </div>
              </section>
            ) : null}

            <div className="connection-form-actions">
              <button className="secondary-action" type="button" onClick={() => setIsFormOpen(false)}>Cancel</button>
              <button className="auth-action inline" type="button" onClick={saveForm} disabled={!canSave}>
                {mode === 'edit' ? 'Save Changes' : 'Save Connection'}
              </button>
            </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

import { useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { BrandLockup } from './components/BrandLockup'
import { ConnectionManager } from './components/ConnectionManager'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog'
import { getEnvironmentDisplayLabel } from './features/schedules/constants'
import { SchedulePlanner } from './features/schedules'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { getMissingRequiredScopes } from './uipathConfig'

const friendlyAuthError = (message: string) => {
  const normalizedMessage = message.toLowerCase()

  if (
    normalizedMessage.includes('invalid_grant') ||
    normalizedMessage.includes('failed to get access token') ||
    normalizedMessage.includes('failed to complete oauth')
  ) {
    return 'Sign-in could not be completed. Try signing in again. If it continues, confirm the redirect URI and External App setup.'
  }

  if (
    normalizedMessage.includes('missing configured scope') ||
    normalizedMessage.includes('missing required scope')
  ) {
    return null
  }

  return 'Sign-in could not be completed. Check the UiPath connection settings, then try again.'
}

function LoadingAuth() {
  return (
    <main className="auth-shell">
      <section className="auth-panel is-loading" aria-live="polite">
        <div className="brand-row">
          <BrandLockup />
        </div>
        <h1>Preparing your workspace</h1>
        <p>Checking your remembered UiPath connection...</p>
        <Loader2 className="auth-loader spin" size={24} aria-hidden="true" />
      </section>
    </main>
  )
}

function SignInGate() {
  const { activeAuthConfig, error, login } = useAuth()
  const [showConnectionManager, setShowConnectionManager] = useState(false)
  const missingScopes = useMemo(
    () => (activeAuthConfig ? getMissingRequiredScopes(activeAuthConfig.scope) : []),
    [activeAuthConfig],
  )
  const canSignIn = Boolean(activeAuthConfig && missingScopes.length === 0)
  const activeConnectionEnvironment = activeAuthConfig ? getEnvironmentDisplayLabel(activeAuthConfig.urlApp) : ''
  const requiresConnectionSetup = !activeAuthConfig || missingScopes.length > 0
  const showGuidedConnection = requiresConnectionSetup || showConnectionManager
  const authErrorMessage = error ? friendlyAuthError(error) : null
  const description = activeAuthConfig
    ? showGuidedConnection
      ? 'Review your saved UiPath connection before loading live trigger data.'
      : 'Use your saved UiPath connection to load live trigger data.'
    : 'Connect this app to your UiPath organization to load live trigger data.'

  return (
    <main className="auth-shell">
      <section className={`auth-panel ${showGuidedConnection ? 'guided-auth-panel' : 'saved-auth-panel'}`} aria-live="polite">
        <div className="brand-row">
          <BrandLockup />
        </div>
        <div className="auth-copy">
          <h1>Sign in to continue</h1>
          <p>{description}</p>
        </div>

        {showGuidedConnection ? (
          <ConnectionManager compact />
        ) : activeAuthConfig ? (
          <div className="saved-connection-card" aria-label="Saved UiPath connection">
            <span>Saved Connection</span>
            <strong>{activeAuthConfig.organization} <em>{activeConnectionEnvironment}</em></strong>
          </div>
        ) : null}

        {missingScopes.length ? (
          <div className="auth-error">
            This connection is missing required Orchestrator access: {missingScopes.join(', ')}.
          </div>
        ) : null}
        {authErrorMessage ? <div className="auth-error">{authErrorMessage}</div> : null}
        {!activeAuthConfig ? <p className="connection-help">Complete the connection selections above to enable sign in.</p> : null}

        <div className="auth-actions-row">
          <button className="auth-action" onClick={login} type="button" disabled={!canSignIn}>
            Sign in
          </button>
          {activeAuthConfig && !requiresConnectionSetup ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => setShowConnectionManager((isVisible) => !isVisible)}
            >
              {showConnectionManager ? 'Hide Connection' : 'Manage Connection'}
            </button>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function ConnectionSettingsDialog({
  onClose,
}: {
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(isOpen) => {
      if (!isOpen) onClose()
    }}>
      <DialogContent
        aria-label="Manage UiPath connection"
        className="connection-form manage-connection-dialog"
        showClose={false}
      >
        <div className="connection-form-header">
          <div>
            <DialogTitle asChild>
              <h2>Manage Connection</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>Review or change the selected organization and connection.</p>
            </DialogDescription>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close connection settings">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <ConnectionManager compact />
      </DialogContent>
    </Dialog>
  )
}

function AuthenticatedPlanner() {
  const { activeAuthConfigGroup, isAuthenticated, isInitializing, sdk } = useAuth()
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false)

  if (isInitializing) return <LoadingAuth />
  if (!isAuthenticated || !sdk) return <SignInGate />

  return (
    <>
      <SchedulePlanner
        configuredTenantNames={activeAuthConfigGroup?.tenants ?? []}
        environmentSourceUrl={activeAuthConfigGroup?.urlApp}
        sdk={sdk}
        onManageConnection={() => setIsConnectionDialogOpen(true)}
      />
      {isConnectionDialogOpen ? <ConnectionSettingsDialog onClose={() => setIsConnectionDialogOpen(false)} /> : null}
    </>
  )
}

export default function LiveApp() {
  return (
    <AuthProvider>
      <AuthenticatedPlanner />
    </AuthProvider>
  )
}

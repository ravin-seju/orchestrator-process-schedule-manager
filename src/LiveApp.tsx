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
import { acknowledgeScopeGroup, getMissingRequiredScopes, isScopeAcknowledged, REQUIRED_ORCHESTRATOR_SCOPES } from './uipathConfig'

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
    return 'Your session is missing required permissions. Sign in again to refresh your access.'
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
  const { activeAuthConfig, dismissSignInIncomplete, error, isAuthenticating, login, signInIncomplete } = useAuth()
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

  // One-time-per-connection acknowledgment that the External App grants every required scope.
  // ackBump re-reads the persisted flag after the user confirms (and on connection switch).
  const [ackBump, setAckBump] = useState(0)
  const scopeAcknowledged = useMemo(
    () => !activeAuthConfig || isScopeAcknowledged(activeAuthConfig.groupId),
    [activeAuthConfig, ackBump],
  )
  // The sign-in button spinner is driven by isAuthenticating from useAuth — login() owns that
  // flag so it survives the redirect (the page unloads) and resets on local failure.
  const handleConfirmScopes = () => {
    if (activeAuthConfig) acknowledgeScopeGroup(activeAuthConfig.groupId)
    setAckBump((value) => value + 1)
    login()
  }

  // The confirm card is one screen, but "Sign in" is an action reachable from the manager view too.
  // Gate the action itself: an unacknowledged connection must pass the card before login() can run.
  const needsScopeConfirm =
    Boolean(activeAuthConfig) && !requiresConnectionSetup && !scopeAcknowledged && !signInIncomplete
  const handleSignIn = () => {
    if (needsScopeConfirm) {
      // Closing the manager lets the confirm-card branch render on the next pass.
      setShowConnectionManager(false)
      return
    }
    login()
  }

  // The user returned from UiPath without completing OAuth — almost always because the
  // External App is missing a requested scope (UiPath renders its own hosted error page,
  // which we cannot replace). Land them on an app-side recovery screen with the exact
  // scopes to grant, instead of a bare sign-in card with no context.
  if (signInIncomplete) {
    return (
      <main className="auth-shell">
        <section className="auth-panel signin-gate-panel" aria-live="polite">
          <div className="brand-row">
            <BrandLockup />
          </div>
          <div className="auth-copy">
            <h1>Sign-in did not complete</h1>
            <p>
              UiPath could not grant the access this app needs. The most common cause is an External App
              that is missing one or more required Orchestrator scopes. Confirm all of these are granted on
              your External App, then try again.
            </p>
          </div>
          <div className="signin-gate-scopes connection-scope-chips" aria-label="Required Orchestrator scopes">
            {REQUIRED_ORCHESTRATOR_SCOPES.map((scope) => (
              <span key={scope} className="connection-scope-chip">{scope}</span>
            ))}
          </div>
          <div className="auth-actions-row">
            <button
              className="auth-action"
              type="button"
              onClick={login}
              disabled={!canSignIn || isAuthenticating}
              aria-busy={isAuthenticating}
            >
              {isAuthenticating ? (
                <><Loader2 className="spin" size={16} aria-hidden="true" /> Signing you in…</>
              ) : (
                'Try Again'
              )}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                dismissSignInIncomplete()
                setShowConnectionManager(true)
              }}
            >
              Manage Connection
            </button>
          </div>
        </section>
      </main>
    )
  }

  // One-time-per-connection scope confirmation: before the first sign-in of a connection, surface
  // the required scopes once (they must be granted on the External App or UiPath errors). Once
  // acknowledged it never shows again for that connection — no per-login nag. Yields to the manager
  // view so its own "Manage Connection" button can open the connection manager.
  if (needsScopeConfirm && !showConnectionManager) {
    return (
      <main className="auth-shell">
        <section className="auth-panel signin-gate-panel" aria-live="polite">
          <div className="brand-row">
            <BrandLockup />
          </div>
          <div className="auth-copy">
            <h1>Confirm Orchestrator access</h1>
            <p>
              At sign-in this app requests the scopes below. Make sure your UiPath External App grants all
              of them — if any are missing, UiPath returns an error and sign-in cannot complete.
            </p>
          </div>
          <div className="signin-gate-scopes connection-scope-chips" aria-label="Required Orchestrator scopes">
            {REQUIRED_ORCHESTRATOR_SCOPES.map((scope) => (
              <span key={scope} className="connection-scope-chip">{scope}</span>
            ))}
          </div>
          <div className="auth-actions-row">
            <button
              className="auth-action"
              type="button"
              onClick={handleConfirmScopes}
              disabled={!canSignIn || isAuthenticating}
              aria-busy={isAuthenticating}
            >
              {isAuthenticating ? (
                <><Loader2 className="spin" size={16} aria-hidden="true" /> Signing you in…</>
              ) : (
                'Continue to sign in'
              )}
            </button>
            <button className="secondary-action" type="button" onClick={() => setShowConnectionManager(true)}>
              Manage Connection
            </button>
          </div>
        </section>
      </main>
    )
  }

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
          <button
            className="auth-action"
            type="button"
            onClick={handleSignIn}
            disabled={!canSignIn || isAuthenticating}
            aria-busy={isAuthenticating}
          >
            {isAuthenticating ? (
              <><Loader2 className="spin" size={16} aria-hidden="true" /> Signing you in…</>
            ) : (
              'Sign in'
            )}
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

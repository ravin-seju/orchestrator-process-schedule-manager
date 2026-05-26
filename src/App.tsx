import { lazy, Suspense, useLayoutEffect } from 'react'
import { BrandLockup } from './components/BrandLockup'
import { ErrorBoundary } from './components/ErrorBoundary'

const LiveApp = lazy(() => import('./LiveApp'))
const TestingApp =
  import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
    ? lazy(() => import('./TestingApp'))
    : null

const isTestingRoute = () =>
  typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '').endsWith('/testing')

const designVariantFromPath = (pathname: string) => {
  const normalizedPath = pathname.toLowerCase()

  if (normalizedPath.includes('/modern-calendar-workspace')) return 'modern-calendar-workspace'
  if (normalizedPath.includes('/data-workspace-console')) return 'data-workspace-console'

  return 'automation-command-center'
}

function LoadingAppShell() {
  return (
    <main className="auth-shell">
      <section className="auth-panel is-loading" aria-live="polite">
        <div className="brand-row">
          <BrandLockup />
        </div>
        <h1>Preparing your workspace</h1>
        <p>Loading Process Schedule Manager...</p>
      </section>
    </main>
  )
}

function TestingUnavailable() {
  return (
    <main className="auth-shell">
      <section className="auth-panel saved-auth-panel" aria-live="polite">
        <div className="brand-row">
          <BrandLockup />
        </div>
        <div className="auth-copy">
          <h1>Testing mode is unavailable</h1>
          <p>This customer build does not include local fixture data. Open the live app to sign in with a UiPath connection.</p>
        </div>
      </section>
    </main>
  )
}

export default function App() {
  const isTesting = isTestingRoute()
  const designVariant =
    typeof window === 'undefined'
      ? 'automation-command-center'
      : designVariantFromPath(window.location.pathname)

  useLayoutEffect(() => {
    document.documentElement.dataset.design = designVariant
  }, [designVariant])

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingAppShell />}>
        {TestingApp && isTesting ? <TestingApp /> : isTesting ? <TestingUnavailable /> : <LiveApp />}
      </Suspense>
    </ErrorBoundary>
  )
}

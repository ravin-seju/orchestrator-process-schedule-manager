import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error?: Error
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Process Schedule Manager failed to render', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-fallback" role="alert">
          <section className="fallback-card">
            <span className="fallback-eyebrow">Application error</span>
            <h1>Something went wrong while loading the trigger manager.</h1>
            <p>
              Refresh the app and try again. If this keeps happening, check the browser console for the
              captured render error.
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              Refresh app
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

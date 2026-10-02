import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Shows what went wrong instead of a blank page if rendering throws. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="app">
        <div className="panel crash">
          <h2>Something went wrong</h2>
          <p className="alert alert--error">{error.message || String(error)}</p>
          <p className="muted small">
            Your photo never left this device. On a phone, closing other tabs before trying again often helps. If it keeps happening, the
            message above tells us what broke.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
            Start over
          </button>
        </div>
      </div>
    )
  }
}

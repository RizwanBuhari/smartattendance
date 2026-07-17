// A minimal error boundary. React unmounts the whole root when a render/effect
// error is uncaught, which shows as a blank white page. Wrapping a risky subtree
// (e.g. the Leaflet map cards) keeps the rest of the page alive and shows a
// readable message instead.
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback
      return (
        <div className="error">
          Something went wrong rendering this section:{' '}
          {String(this.state.error?.message ?? this.state.error)}
        </div>
      )
    }
    return this.props.children
  }
}

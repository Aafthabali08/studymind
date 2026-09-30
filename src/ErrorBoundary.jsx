import React from "react";

/**
 * Catches render errors (and failed page downloads after a new deploy) so the
 * user sees a recovery screen instead of a blank page.
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("StudyMind crashed:", error, info?.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const outdated =
      /dynamically imported module|Importing a module script failed|Loading chunk/i.test(
        String(error?.message || error),
      );
    return (
      <div className="crash-screen" role="alert">
        <h1>{outdated ? "StudyMind was updated." : "Something went wrong."}</h1>
        <p>
          {outdated
            ? "A newer version is available. Reload to continue; your work is saved in your account."
            : "Sorry about that. Reload to continue; your documents, notes and sessions are saved in your account."}
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => window.location.reload()}>
            Reload StudyMind
          </button>
          {!outdated && (
            <button
              className="secondary"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { setApp, toast } from '../state/store';

/** A second break this soon after recovering means trying again won't help. */
const AGAIN_WITHIN_MS = 5000;

type State = { error: Error | null };

/**
 * If something on screen breaks, closes whatever menu or popup was open and
 * draws the app again, instead of leaving a black window. Voice keeps going
 * (it doesn't live on screen). If it breaks again straight away, it shows
 * what went wrong with a Reload button.
 */
export class CrashGuard extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  private lastCrash = 0;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Screen error', error, info.componentStack);
    const now = Date.now();
    const again = now - this.lastCrash < AGAIN_WITHIN_MS;
    this.lastCrash = now;
    if (again) return;
    toast('Something went wrong there, so it was closed.', 'warn');
    this.recover();
  }

  /** Closes menus and popups (the likely cause) and draws the app again. */
  private recover = (): void => {
    setApp({ ctxMenu: null, popover: null, modal: null, lightbox: null, profileCard: null });
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong on screen</h2>
        <p>You're still connected. Try again, or reload Gamecoms if it keeps happening.</p>
        <code>{error.message}</code>
        <div className="crash-actions">
          <button className="btn-plain" onClick={this.recover}>Try again</button>
          <button className="btn-neon" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

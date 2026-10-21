import { Component, type ErrorInfo, type ReactNode } from "react";

interface BoundaryState {
  error: Error | null;
}

/** * Keeps a thrown render from leaving a blank black page. */
export class VisibleErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="bz-error-boundary" role="alert">
          <h1>Affichage interrompu</h1>
          <p>L'écran reste visible. Recharge la page si besoin.</p>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

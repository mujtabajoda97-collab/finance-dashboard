'use client';

import { Component, type ReactNode } from 'react';

/**
 * Keeps an optional feature (alarm engine, spending chart, debt history…) from taking the whole app down:
 * if it throws while rendering, only this part disappears and the rest of the page keeps working.
 */
export class SafeBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('[SafeBoundary]', error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

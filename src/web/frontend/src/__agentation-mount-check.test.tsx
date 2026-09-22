/**
 * Agentation mount verification (repository UI policy) — renders the real app
 * shell and asserts the Agentation toolbar mounts, checked as
 * `#agentation-root` OR the `data-agentation-root` attribute the installed
 * agentation version actually renders (via a React portal into document.body,
 * so it is looked up on `document`, never on the test container).
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import App from './App';

// Stub browser surfaces the live app touches on mount but jsdom does not have:
// - WebSocket: App opens the live event stream; jsdom's undici-backed
//   WebSocket throws an unhandled ERR_INVALID_ARG_TYPE against a relative URL.
// - fetch: relative API URLs are invalid in jsdom; fail them fast and quietly.
beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  class StubWebSocket {
    static OPEN = 1;
    onopen: ((ev?: unknown) => void) | null = null;
    onmessage: ((ev?: unknown) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev?: unknown) => void) | null = null;
    close(): void {
      this.onclose?.({});
    }
    send(): void {}
  }
  (window as { WebSocket: unknown }).WebSocket = StubWebSocket;
  window.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe('agentation mount check', () => {
  it('mounts the Agentation toolbar in the live app shell', async () => {
    render(React.createElement(App));
    await waitFor(
      () => {
        const root =
          document.getElementById('agentation-root') ??
          document.querySelector('[data-agentation-root]');
        expect(root).not.toBeNull();
      },
      { timeout: 15_000 },
    );
    expect(
      document.getElementById('agentation-root') ??
        document.querySelector('[data-agentation-root]'),
    ).not.toBeNull();
  }, 20_000);
});

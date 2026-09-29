/**
 * Integration coverage for the documented lower-case r / upper-case R split.
 *
 * This deliberately uses real blessed elements and the real TUI components.
 * A screen-level key handler alone cannot catch regressions here: blessed also
 * dispatches a key to the focused view element, where replay/DAG and several
 * other views give lower-case r a context-local meaning.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import blessed from 'blessed';
import { FabricTuiApp } from './app.js';
import { InMemoryEventStore } from '../store.js';
import type { LogEvent } from '../types.js';

type TuiInternals = {
  screen: blessed.Widgets.Screen;
  viewMode: string;
  sessionReplay: {
    loadEvents(events: LogEvent[]): void;
    seekTo(index: number): void;
    getProgress(): { current: number };
    getState(): string;
  };
  dependencyDag: { viewMode: string };
  gitIntegration: { viewMode: string; refresh(): void };
  semanticNarrativePanel: { viewMode: string; refresh(): void };
  workerAnalyticsPanel: { viewMode: string; refresh(): void };
  crossReferencePanel: { viewMode: string; refresh(): void };
  budgetAlertPanel: { refresh(): void };
};

const events: LogEvent[] = [
  { ts: 1_000, worker: 'worker-r-key', level: 'info', msg: 'first' },
  { ts: 2_000, worker: 'worker-r-key', level: 'info', msg: 'second' },
  { ts: 3_000, worker: 'worker-r-key', level: 'info', msg: 'third' },
];

/**
 * Emit the same keypress event blessed receives from a terminal. The `full`
 * field matters for case-sensitive bindings such as `r` versus `R`.
 */
function sendKey(screen: blessed.Widgets.Screen, key: string): void {
  screen.program.emit('keypress', key, { name: key, full: key });
}

function internals(app: FabricTuiApp): TuiInternals {
  return app as unknown as TuiInternals;
}

describe('TUI r/R key semantics', () => {
  let app: FabricTuiApp;
  let screen: blessed.Widgets.Screen;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // blessed writes the terminal title during screen construction. Keep the
    // integration run from emitting control sequences into Vitest's output.
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    app = new FabricTuiApp(new InMemoryEventStore());
    screen = internals(app).screen;
  });

  afterEach(() => {
    screen.destroy();
    stdoutWrite.mockRestore();
  });

  it('keeps r as a pure re-render in the default view and makes R the replay toggle', () => {
    const state = internals(app);
    const render = vi.spyOn(screen, 'render');

    sendKey(screen, 'r');
    expect(render).toHaveBeenCalled();
    expect(state.viewMode).toBe('default');

    sendKey(screen, 'R');
    expect(state.viewMode).toBe('replay');

    sendKey(screen, 'r');
    expect(state.viewMode).toBe('replay');
    sendKey(screen, 'R');
    expect(state.viewMode).toBe('default');
  });

  it('keeps lowercase r as a refresh/re-render in every documented view', () => {
    const views = [
      { key: 'H', mode: 'heatmap' },
      { key: 'D', mode: 'dag' },
      { key: 'R', mode: 'replay' },
      { key: 'E', mode: 'errors' },
      { key: 'G', mode: 'digest' },
      { key: 'C', mode: 'collisions' },
      { key: 'I', mode: 'git' },
      { key: 'N', mode: 'narrative' },
      { key: 'A', mode: 'analytics' },
      { key: 'T', mode: 'transcript' },
      { key: 'X', mode: 'xref' },
      { key: 'B', mode: 'budget' },
    ] as const;

    for (const view of views) {
      sendKey(screen, view.key);
      expect(internals(app).viewMode).toBe(view.mode);

      const render = vi.spyOn(screen, 'render');
      sendKey(screen, 'r');

      expect(render).toHaveBeenCalled();
      expect(internals(app).viewMode).toBe(view.mode);
      sendKey(screen, 'escape');
      render.mockRestore();
    }
  });

  it('resets replay with lowercase r without leaving replay, while R exits it', () => {
    const state = internals(app);
    state.sessionReplay.loadEvents(events);
    sendKey(screen, 'R');
    state.sessionReplay.seekTo(2);
    expect(state.viewMode).toBe('replay');
    expect(state.sessionReplay.getProgress().current).toBe(2);

    sendKey(screen, 'r');
    expect(state.viewMode).toBe('replay');
    expect(state.sessionReplay.getProgress().current).toBe(0);
    expect(state.sessionReplay.getState()).toBe('idle');

    sendKey(screen, 'R');
    expect(state.viewMode).toBe('default');
  });

  it('keeps DAG lower-case r local and reserves R for replay', () => {
    const state = internals(app);
    sendKey(screen, 'D');
    expect(state.dependencyDag.viewMode).toBe('tree');

    sendKey(screen, 'r');
    expect(state.viewMode).toBe('dag');
    expect(state.dependencyDag.viewMode).toBe('ready');

    sendKey(screen, 'R');
    expect(state.viewMode).toBe('replay');
  });

  it.each([
    { key: 'I', mode: 'git', panel: 'gitIntegration' },
    { key: 'N', mode: 'narrative', panel: 'semanticNarrativePanel' },
    { key: 'A', mode: 'analytics', panel: 'workerAnalyticsPanel' },
    { key: 'X', mode: 'xref', panel: 'crossReferencePanel' },
    { key: 'B', mode: 'budget', panel: 'budgetAlertPanel' },
  ] as const)('$panel refreshes on r without changing its view', ({ key, mode, panel }) => {
    const state = internals(app);
    sendKey(screen, key);
    expect(state.viewMode).toBe(mode);

    const refresh = vi.spyOn(state[panel], 'refresh');
    sendKey(screen, 'r');

    expect(state.viewMode).toBe(mode);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    { key: 'H', mode: 'heatmap' },
    { key: 'D', mode: 'dag' },
    { key: 'E', mode: 'errors' },
    { key: 'G', mode: 'digest' },
    { key: 'C', mode: 'collisions' },
    { key: 'I', mode: 'git' },
    { key: 'N', mode: 'narrative' },
    { key: 'A', mode: 'analytics' },
    { key: 'T', mode: 'transcript' },
    { key: 'X', mode: 'xref' },
    { key: 'B', mode: 'budget' },
  ] as const)('R from $mode always enters replay, while lowercase r stays local', ({ key, mode }) => {
    const state = internals(app);
    sendKey(screen, key);
    expect(state.viewMode).toBe(mode);

    sendKey(screen, 'r');
    expect(state.viewMode).toBe(mode);

    sendKey(screen, 'R');
    expect(state.viewMode).toBe('replay');
  });
});

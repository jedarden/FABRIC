/**
 * FABRIC TUI Application
 *
 * Main TUI application class using blessed for terminal rendering.
 */

import * as blessed from 'blessed';
import { LogEvent, WorkerInfo } from '../types.js';
import { InMemoryEventStore } from '../store.js';
import { colors } from './utils/colors.js';
import { WorkerGrid } from './components/WorkerGrid.js';
import { ActivityStream } from './components/ActivityStream.js';
import { WorkerDetail } from './components/WorkerDetail.js';
import { CommandPalette } from './components/CommandPalette.js';
import { FileHeatmap } from './components/FileHeatmap.js';
import { DependencyDag } from './components/DependencyDag.js';
import { SessionReplay } from './components/SessionReplay.js';

export interface TuiOptions {
  /** Log file path to tail */
  logPath?: string;

  /** Maximum events to display */
  maxEvents?: number;

  /** Refresh interval in ms */
  refreshInterval?: number;
}

export class FabricTuiApp {
  private screen: blessed.Widgets.Screen;
  private store: InMemoryEventStore;
  private options: Required<TuiOptions>;
  private isRunning = false;

  // View mode
  private viewMode: 'default' | 'heatmap' | 'dag' | 'replay' = 'default';

  // UI Components
  private headerBox!: blessed.Widgets.BoxElement;
  private workerGrid!: WorkerGrid;
  private activityStream!: ActivityStream;
  private workerDetail!: WorkerDetail;
  private commandPalette!: CommandPalette;
  private fileHeatmap!: FileHeatmap;
  private dependencyDag!: DependencyDag;
  private sessionReplay!: SessionReplay;
  private footerBox!: blessed.Widgets.BoxElement;
  private helpOverlay?: blessed.Widgets.BoxElement;

  constructor(store: InMemoryEventStore, options: TuiOptions = {}) {
    this.store = store;
    this.options = {
      logPath: options.logPath || '',
      maxEvents: options.maxEvents || 1000,
      refreshInterval: options.refreshInterval || 100,
    };

    this.screen = this.createScreen();
    this.createLayout();
    this.bindKeys();
  }

  /**
   * Create the blessed screen
   */
  private createScreen(): blessed.Widgets.Screen {
    return blessed.screen({
      smartCSR: true,
      title: 'FABRIC - Flow Analysis & Bead Reporting Interface Console',
      fullUnicode: true,
    });
  }

  /**
   * Create the UI layout
   */
  private createLayout(): void {
    // Header
    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      content: ' FABRIC - Worker Activity Monitor',
      style: {
        fg: colors.header,
        bold: true,
      },
    });

    // Worker grid panel (left side)
    this.workerGrid = new WorkerGrid({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '40%',
      bottom: 1,
    });

    // Activity stream (right side)
    this.activityStream = new ActivityStream({
      parent: this.screen,
      top: 1,
      right: 0,
      width: '60%',
      bottom: 1,
      maxLines: this.options.maxEvents,
    });

    // Worker detail panel (hidden by default)
    this.workerDetail = new WorkerDetail({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: '60%',
    });

    // Command palette (hidden by default, Ctrl+K)
    this.commandPalette = new CommandPalette({
      parent: this.screen,
      onSubmit: (cmd) => this.handleCommand(cmd),
    });

    // File heatmap panel (hidden by default, 'H' key)
    this.fileHeatmap = new FileHeatmap({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 1,
    });
    this.fileHeatmap.getElement().hide();

    // Dependency DAG panel (hidden by default, 'D' key)
    this.dependencyDag = new DependencyDag({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 1,
    });

    // Session Replay panel (hidden by default, 'R' key)
    this.sessionReplay = new SessionReplay({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      height: '100%-2',
      onEvent: (event, index, total) => {
        // Could add event to activity stream if needed
      },
      onStateChange: (state) => {
        if (state === 'ended') {
          // Update footer to show replay ended
          this.updateFooter();
        }
      },
    });
    this.sessionReplay.hide();

    // Footer with key hints
    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      content: ' [Tab] Switch  [j/k] Scroll  [/] Search  [H] Heatmap  [D] DAG  [?] Help  [q] Quit',
      style: {
        fg: colors.muted,
      },
    });
  }

  /**
   * Bind keyboard shortcuts
   */
  private bindKeys(): void {
    // Quit
    this.screen.key(['q', 'C-c'], () => {
      this.stop();
    });

    // Help toggle
    this.screen.key(['?'], () => {
      this.toggleHelp();
    });

    // Tab switching
    this.screen.key(['tab'], () => {
      this.screen.focusNext();
    });

    this.screen.key(['S-tab'], () => {
      this.screen.focusPrevious();
    });

    // Refresh
    this.screen.key(['r'], () => {
      this.render();
    });

    // Command palette
    this.screen.key(['C-k'], () => {
      this.commandPalette.toggle();
    });

    // Toggle worker detail
    this.screen.key(['enter'], () => {
      const selected = this.workerGrid.getSelected();
      if (selected) {
        this.showWorkerDetail(selected);
      }
    });

    // Toggle file heatmap view
    this.screen.key(['H'], () => {
      this.toggleHeatmapView();
    });

    // Toggle dependency DAG view
    this.screen.key(['D'], () => {
      this.toggleDagView();
    });

    // Toggle session replay view
    this.screen.key(['R'], () => {
      this.toggleReplayView();
    });

    // Escape to return to default view
    this.screen.key(['escape'], () => {
      if (this.viewMode !== 'default') {
        this.setViewMode('default');
      }
    });
  }

  /**
   * Handle command from palette
   */
  private handleCommand(cmd: string): void {
    if (cmd === 'clear') {
      this.activityStream.clearFilter();
    } else if (cmd === 'pause') {
      this.activityStream.togglePause();
    } else if (cmd === 'refresh') {
      this.render();
    } else if (cmd === 'help') {
      this.toggleHelp();
    } else if (cmd === 'quit') {
      this.stop();
    } else if (cmd === 'heatmap') {
      this.toggleHeatmapView();
    } else if (cmd === 'dag') {
      this.toggleDagView();
    } else if (cmd === 'replay') {
      this.toggleReplayView();
    } else if (cmd.startsWith('filter:worker:')) {
      const workerId = cmd.replace('filter:worker:', '');
      this.activityStream.setFilter({ workerId });
    } else if (cmd.startsWith('filter:level:')) {
      const level = cmd.replace('filter:level:', '');
      this.activityStream.setFilter({ level });
    }
  }

  /**
   * Toggle heatmap view
   */
  private toggleHeatmapView(): void {
    if (this.viewMode === 'heatmap') {
      this.setViewMode('default');
    } else {
      this.setViewMode('heatmap');
    }
  }

  /**
   * Toggle dependency DAG view
   */
  private toggleDagView(): void {
    if (this.viewMode === 'dag') {
      this.setViewMode('default');
    } else {
      this.setViewMode('dag');
    }
  }

  /**
   * Toggle session replay view
   */
  private toggleReplayView(): void {
    if (this.viewMode === 'replay') {
      this.setViewMode('default');
    } else {
      this.setViewMode('replay');
    }
  }

  /**
   * Set view mode
   */
  private setViewMode(mode: 'default' | 'heatmap' | 'dag' | 'replay'): void {
    this.viewMode = mode;

    if (mode === 'heatmap') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.dependencyDag.getElement().hide();

      // Show heatmap
      this.fileHeatmap.getElement().show();
      this.fileHeatmap.updateData(
        (opts) => this.store.getFileHeatmap(opts),
        () => this.store.getFileHeatmapStats()
      );
      this.fileHeatmap.focus();

      // Update header
      this.headerBox.setContent(' FABRIC - File Heatmap');
      this.footerBox.setContent(' [s] Sort  [c] Collisions  [Esc] Back  [?] Help  [q] Quit');
    } else if (mode === 'dag') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();

      // Show dependency DAG
      this.dependencyDag.getElement().show();
      this.dependencyDag.focus();

      // Update header
      this.headerBox.setContent(' FABRIC - Task Dependency DAG');
      this.footerBox.setContent(' [t]ree [b]lockers [r]eady [s]tats [f]ilter [R]efresh [Esc] Back  [q] Quit');
    } else if (mode === 'replay') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();

      // Show session replay
      this.sessionReplay.show();

      // Load all current events into replay
      const allEvents = this.store.query();
      if (allEvents.length > 0) {
        this.sessionReplay.loadEvents(allEvents);
      }

      this.sessionReplay.focus();

      // Update header and footer
      this.headerBox.setContent(' FABRIC - Session Replay');
      this.updateFooter();
    } else {
      // Hide special views
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();

      // Show default panels
      this.workerGrid.getElement().show();
      this.activityStream.getElement().show();

      // Update header
      this.headerBox.setContent(' FABRIC - Worker Activity Monitor');
      this.footerBox.setContent(' [Tab] Switch  [j/k] Scroll  [/] Search  [H] Heatmap  [D] DAG  [R] Replay  [?] Help  [q] Quit');
    }

    this.screen.render();
  }

  /**
   * Update footer based on replay state
   */
  private updateFooter(): void {
    if (this.viewMode === 'replay') {
      const state = this.sessionReplay.getState();
      const speed = this.sessionReplay.getSpeed();
      const stateText = state === 'playing' ? 'PLAYING' : state === 'paused' ? 'PAUSED' : state === 'ended' ? 'ENDED' : 'READY';
      this.footerBox.setContent(` [${stateText}] [Space] Play/Pause  [←/→] Step  [↑/↓] Speed(${speed}x)  [Home/End] Jump  [r] Reset  [Esc] Back  [q] Quit`);
      this.screen.render();
    }
  }

  /**
   * Show worker detail panel
   */
  private showWorkerDetail(worker: WorkerInfo): void {
    const events = this.store.query({ worker: worker.id });
    this.workerDetail.setWorker(worker);
    this.workerDetail.setRecentEvents(events);
    this.workerDetail.show();
  }

  /**
   * Toggle help overlay
   */
  private toggleHelp(): void {
    if (this.helpOverlay) {
      this.helpOverlay.destroy();
      this.helpOverlay = undefined;
    } else {
      this.helpOverlay = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: '55%',
        label: ' Help ',
        content: `
Keyboard Shortcuts
==================

Navigation:
  j/k     - Scroll down/up
  g/G     - Scroll to top/bottom
  Tab     - Next panel
  Shift+Tab - Previous panel

Actions:
  /       - Search
  f       - Filter
  r       - Refresh
  p       - Pause scroll
  H       - Toggle file heatmap
  D       - Toggle dependency DAG
  R       - Toggle session replay

Heatmap View:
  s       - Cycle sort mode
  c       - Toggle collisions only
  Esc     - Return to default view

Dependency DAG View:
  t       - Tree view
  b       - Top blockers
  r       - Ready tasks
  s       - Statistics
  f       - Cycle filters
  R       - Force refresh
  Esc     - Return to default view

Session Replay:
  Space   - Play/Pause
  ←/→     - Step backward/forward
  ↑/↓     - Speed up/down
  1-5     - Set speed (0.5x-10x)
  Home/End - Jump to start/end
  r       - Reset to beginning
  Esc     - Return to default view

General:
  ?       - Toggle this help
  q       - Quit
  Ctrl+C  - Quit
`,
        border: { type: 'line' },
        style: {
          border: { fg: colors.border },
          label: { fg: colors.header },
        },
        keys: true,
        vi: true,
      });
      this.helpOverlay.focus();
    }
    this.screen.render();
  }

  /**
   * Render workers panel
   */
  private renderWorkers(): void {
    const workers = this.store.getWorkers();
    this.workerGrid.updateWorkers(workers);
  }

  /**
   * Add event to activity stream
   */
  addEvent(event: LogEvent): void {
    this.activityStream.addEvent(event);
    this.renderWorkers();

    // Update heatmap if visible
    if (this.viewMode === 'heatmap') {
      this.fileHeatmap.updateData(
        (opts) => this.store.getFileHeatmap(opts),
        () => this.store.getFileHeatmapStats()
      );
    }

    // DAG view auto-refreshes on its own schedule

    this.screen.render();
  }

  /**
   * Render the entire UI
   */
  render(): void {
    if (this.viewMode === 'heatmap') {
      this.fileHeatmap.updateData(
        (opts) => this.store.getFileHeatmap(opts),
        () => this.store.getFileHeatmapStats()
      );
    } else if (this.viewMode === 'dag') {
      // DAG view handles its own refresh
      this.dependencyDag.refresh();
    } else {
      this.renderWorkers();
    }
    this.screen.render();
  }

  /**
   * Start the TUI event loop
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.render();
    this.screen.render();
  }

  /**
   * Stop the TUI and cleanup
   */
  stop(): void {
    this.isRunning = false;
    this.screen.destroy();
    process.exit(0);
  }
}

/**
 * Create and start a TUI app
 */
export function createTuiApp(store: InMemoryEventStore, options?: TuiOptions): FabricTuiApp {
  return new FabricTuiApp(store, options);
}

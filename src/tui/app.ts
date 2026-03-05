/**
 * FABRIC TUI Application
 *
 * Main TUI application class using blessed for terminal rendering.
 */

import blessed from 'blessed';
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
import { ErrorGroupPanel } from './components/ErrorGroupPanel.js';
import { SessionDigest, generateSessionDigest } from './components/SessionDigest.js';
import { CollisionAlert } from './components/CollisionAlert.js';
import { GitIntegration } from './components/GitIntegration.js';
import { SemanticNarrativePanel } from './components/SemanticNarrativePanel.js';
import { WorkerAnalyticsPanel } from './components/WorkerAnalyticsPanel.js';
import { getErrorGroupManager } from '../errorGrouping.js';
import { WorkerSessionSummary } from '../types.js';
import { parseGitEvents } from '../gitParser.js';

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
  private viewMode: 'default' | 'heatmap' | 'dag' | 'replay' | 'errors' | 'digest' | 'collisions' | 'git' | 'narrative' | 'analytics' = 'default';

  // Focus mode state
  private focusModeEnabled = false;
  private pinnedWorkerId?: string;
  private pinnedBeadId?: string;

  // UI Components
  private headerBox!: blessed.Widgets.BoxElement;
  private workerGrid!: WorkerGrid;
  private activityStream!: ActivityStream;
  private workerDetail!: WorkerDetail;
  private commandPalette!: CommandPalette;
  private fileHeatmap!: FileHeatmap;
  private dependencyDag!: DependencyDag;
  private sessionReplay!: SessionReplay;
  private errorGroupPanel!: ErrorGroupPanel;
  private sessionDigest!: SessionDigest;
  private collisionAlert!: CollisionAlert;
  private gitIntegration!: GitIntegration;
  private semanticNarrativePanel!: SemanticNarrativePanel;
  private workerAnalyticsPanel!: WorkerAnalyticsPanel;
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
      tags: true,
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

    // Error Group Panel (hidden by default, 'E' key)
    this.errorGroupPanel = new ErrorGroupPanel({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 1,
      onSelect: (groupId) => {
        // Could show detailed error view if needed
      },
    });
    this.errorGroupPanel.hide();

    // Session Digest panel (hidden by default, 'G' key)
    this.sessionDigest = new SessionDigest({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      height: '100%-2',
      onExport: (format, path) => {
        // Log export
      },
    });
    this.sessionDigest.hide();

    // Collision Alert panel (hidden by default, 'C' key)
    this.collisionAlert = new CollisionAlert({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '70%',
      onAcknowledge: (alertId) => {
        this.store.acknowledgeAlert(alertId);
        this.updateCollisionAlerts();
      },
    });
    this.collisionAlert.hide();

    // Git Integration panel (hidden by default, 'I' key)
    this.gitIntegration = new GitIntegration({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 1,
      maxCommits: 10,
      maxFiles: 15,
    });
    this.gitIntegration.hide();

    // Semantic Narrative panel (hidden by default, 'N' key)
    this.semanticNarrativePanel = new SemanticNarrativePanel({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 1,
      onSelect: (segmentId) => {
        // Could highlight segment in activity stream
      },
    });
    this.semanticNarrativePanel.hide();

    // Worker Analytics panel (hidden by default, 'A' key)
    this.workerAnalyticsPanel = new WorkerAnalyticsPanel({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 1,
      onSelect: (workerId) => {
        // Could highlight worker in grid
      },
    });
    this.workerAnalyticsPanel.hide();

    // Footer with key hints
    this.footerBox = blessed.box({
      parent: this.screen,
      tags: true,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      content: this.getFooterContent(),
      style: {
        fg: colors.muted,
      },
    });
  }

  /**
   * Get footer content based on current state
   */
  private getFooterContent(): string {
    if (this.viewMode === 'default') {
      let content = ' [Tab] Switch  [j/k] Scroll  [/] Search  [H] Heatmap  [D] DAG  [E] Errors  [I] Git  [C] Collisions  [N] Narrative  [A] Analytics';

      // Show focus mode status
      if (this.focusModeEnabled) {
        content += '  {green-fg}[FOCUS MODE]{/}';
        if (this.pinnedWorkerId) {
          content += ` Worker:${this.pinnedWorkerId.slice(0, 8)}`;
        }
        if (this.pinnedBeadId) {
          content += ` Bead:${this.pinnedBeadId}`;
        }
      }

      content += '  [p]Pin Worker  [P]Pin Bead  [F]Focus';
      content += '  [?] Help  [q] Quit';

      return content;
    }

    // Return default content for other views
    return ' [Tab] Switch  [j/k] Scroll  [/] Search  [H] Heatmap  [D] DAG  [E] Errors  [C] Collisions  [N] Narrative  [A] Analytics  [?] Help  [q] Quit';
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

    // Toggle error group view
    this.screen.key(['E'], () => {
      this.toggleErrorsView();
    });

    // Toggle session digest view
    this.screen.key(['G'], () => {
      this.toggleDigestView();
    });

    // Toggle collision alert view
    this.screen.key(['C'], () => {
      this.toggleCollisionsView();
    });

    // Toggle git integration view
    this.screen.key(['I'], () => {
      this.toggleGitView();
    });

    // Toggle semantic narrative view
    this.screen.key(['N'], () => {
      this.toggleNarrativeView();
    });

    // Toggle worker analytics view
    this.screen.key(['A'], () => {
      this.toggleAnalyticsView();
    });

    // Escape to return to default view
    this.screen.key(['escape'], () => {
      if (this.viewMode !== 'default') {
        this.setViewMode('default');
      }
    });

    // Focus mode keybindings
    this.screen.key(['p'], () => {
      this.toggleWorkerPin();
    });

    this.screen.key(['P'], () => {
      this.toggleBeadPin();
    });

    this.screen.key(['F'], () => {
      this.toggleFocusMode();
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
    } else if (cmd === 'errors') {
      this.toggleErrorsView();
    } else if (cmd === 'digest') {
      this.toggleDigestView();
    } else if (cmd === 'collisions') {
      this.toggleCollisionsView();
    } else if (cmd === 'git') {
      this.toggleGitView();
    } else if (cmd === 'narrative') {
      this.toggleNarrativeView();
    } else if (cmd === 'analytics') {
      this.toggleAnalyticsView();
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
   * Toggle error group view
   */
  private toggleErrorsView(): void {
    if (this.viewMode === 'errors') {
      this.setViewMode('default');
    } else {
      this.setViewMode('errors');
    }
  }

  /**
   * Toggle session digest view
   */
  private toggleDigestView(): void {
    if (this.viewMode === 'digest') {
      this.setViewMode('default');
    } else {
      this.setViewMode('digest');
    }
  }

  /**
   * Toggle collision alert view
   */
  private toggleCollisionsView(): void {
    if (this.viewMode === 'collisions') {
      this.setViewMode('default');
    } else {
      this.setViewMode('collisions');
    }
  }

  /**
   * Toggle git integration view
   */
  private toggleGitView(): void {
    if (this.viewMode === 'git') {
      this.setViewMode('default');
    } else {
      this.setViewMode('git');
    }
  }

  /**
   * Toggle semantic narrative view
   */
  private toggleNarrativeView(): void {
    if (this.viewMode === 'narrative') {
      this.setViewMode('default');
    } else {
      this.setViewMode('narrative');
    }
  }

  /**
   * Toggle worker analytics view
   */
  private toggleAnalyticsView(): void {
    if (this.viewMode === 'analytics') {
      this.setViewMode('default');
    } else {
      this.setViewMode('analytics');
    }
  }

  /**
   * Update collision alerts from store
   */
  private updateCollisionAlerts(): void {
    const alerts = this.store.getAllCollisionAlerts();
    this.collisionAlert.updateAlerts(alerts);
  }

  /**
   * Set view mode
   */
  private setViewMode(mode: 'default' | 'heatmap' | 'dag' | 'replay' | 'errors' | 'digest' | 'collisions' | 'git' | 'narrative' | 'analytics'): void {
    this.viewMode = mode;

    if (mode === 'heatmap') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();

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
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();

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
      this.errorGroupPanel.hide();

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
    } else if (mode === 'errors') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();

      // Show error group panel
      this.errorGroupPanel.show();

      // Get error groups from error manager
      const errorManager = getErrorGroupManager();
      const groups = errorManager.getGroups();
      this.errorGroupPanel.updateGroups(groups);
      this.errorGroupPanel.focus();

      // Update header
      this.headerBox.setContent(' FABRIC - Error Groups');
      this.footerBox.setContent(' [↑/↓] Navigate  [Enter] Expand/Collapse  [Esc] Back  [?] Help  [q] Quit');
    } else if (mode === 'digest') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();

      // Show session digest
      this.sessionDigest.show();

      // Generate digest from current session data
      const allEvents = this.store.query();
      const workers = this.store.getWorkers();

      // Convert WorkerInfo to WorkerSessionSummary
      const workerSummaries: WorkerSessionSummary[] = workers.map(w => ({
        workerId: w.id,
        beadsCompleted: w.beadsCompleted,
        filesModified: w.activeFiles.length,
        errorsEncountered: w.status === 'error' ? 1 : 0,
        totalEvents: 0, // Would need to count per worker
        activeTimeMs: w.lastActivity - w.firstSeen,
        firstActivity: w.firstSeen,
        lastActivity: w.lastActivity,
      }));

      const digest = generateSessionDigest(allEvents, workerSummaries);
      this.sessionDigest.setDigest(digest);
      this.sessionDigest.focus();

      // Update header
      this.headerBox.setContent(' FABRIC - Session Digest');
      this.footerBox.setContent(' [1-5] Tabs  [e] Export JSON  [m] Export Markdown  [j/k] Scroll  [Esc] Back  [?] Help  [q] Quit');
    } else if (mode === 'collisions') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();
      this.sessionDigest.hide();

      // Show collision alert panel
      this.updateCollisionAlerts();
      this.collisionAlert.show();

      // Update header
      this.headerBox.setContent(' FABRIC - Collision Alerts');
      this.footerBox.setContent(' [↑/↓] or [j/k] Navigate  [Enter] Acknowledge  [a] Acknowledge All  [Esc] Close  [?] Help  [q] Quit');
    } else if (mode === 'git') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();
      this.sessionDigest.hide();
      this.collisionAlert.hide();

      // Show git integration panel
      this.gitIntegration.show();

      // Update git data from store
      const allEvents = this.store.query();
      const gitEvents = parseGitEvents(allEvents);
      this.gitIntegration.updateGitEvents(gitEvents);
      this.gitIntegration.focus();

      // Update header
      this.headerBox.setContent(' FABRIC - Git Integration');
      this.footerBox.setContent(' [r] Refresh  [c] Clear  [Esc] Back  [?] Help  [q] Quit');
    } else if (mode === 'narrative') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();
      this.sessionDigest.hide();
      this.collisionAlert.hide();
      this.gitIntegration.hide();

      // Show semantic narrative panel
      this.semanticNarrativePanel.show();
      this.semanticNarrativePanel.updateAggregated();
      this.semanticNarrativePanel.focus();

      // Update header
      this.headerBox.setContent(' FABRIC - Semantic Narrative');
      this.footerBox.setContent(' [↑/↓] or [j/k] Navigate  [Enter] Detail  [f] Full View  [r] Refresh  [Esc] Back  [?] Help  [q] Quit');
    } else if (mode === 'analytics') {
      // Hide other panels
      this.workerGrid.getElement().hide();
      this.activityStream.getElement().hide();
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();
      this.sessionDigest.hide();
      this.collisionAlert.hide();
      this.gitIntegration.hide();
      this.semanticNarrativePanel.hide();

      // Show worker analytics panel
      this.workerAnalyticsPanel.show();

      // Get metrics from workers in store
      const workers = this.store.getWorkers();
      // Convert WorkerInfo to WorkerMetrics format
      const metrics = workers.map(w => ({
        workerId: w.id,
        periodStart: w.firstSeen,
        periodEnd: w.lastActivity,
        beadsCompleted: w.beadsCompleted,
        beadsPerHour: w.beadsCompleted / Math.max(1, (w.lastActivity - w.firstSeen) / 3600000),
        avgCompletionTimeMs: 0,
        errorRate: w.status === 'error' ? 1 : 0,
        errorCount: w.status === 'error' ? 1 : 0,
        costPerBead: 0,
        totalCostUsd: 0,
        totalTokens: 0,
        activeTimeMs: w.lastActivity - w.firstSeen,
        idleTimeMs: 0,
        idlePercentage: 0,
        totalEvents: w.eventCount || 0,
        tokensPerBead: 0,
        efficiencyScore: Math.min(1, w.beadsCompleted / 10),
      }));
      this.workerAnalyticsPanel.setMetrics(metrics);
      this.workerAnalyticsPanel.focus();

      // Update header
      this.headerBox.setContent(' FABRIC - Worker Analytics');
      this.footerBox.setContent(' [↑/↓] or [j/k] Navigate  [Enter] Detail  [a] Aggregated  [s] Sort  [r] Refresh  [Esc] Back  [?] Help  [q] Quit');
    } else {
      // Hide special views
      this.fileHeatmap.getElement().hide();
      this.dependencyDag.getElement().hide();
      this.sessionReplay.hide();
      this.errorGroupPanel.hide();
      this.sessionDigest.hide();
      this.collisionAlert.hide();
      this.gitIntegration.hide();
      this.semanticNarrativePanel.hide();
      this.workerAnalyticsPanel.hide();

      // Show default panels
      this.workerGrid.getElement().show();
      this.activityStream.getElement().show();

      // Update header
      this.headerBox.setContent(' FABRIC - Worker Activity Monitor');
      this.footerBox.setContent(this.getFooterContent());
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
    } else {
      this.footerBox.setContent(this.getFooterContent());
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
   * Toggle worker pin
   */
  private toggleWorkerPin(): void {
    if (this.viewMode !== 'default') return;

    const selected = this.workerGrid.getSelected();
    if (!selected) return;

    if (this.pinnedWorkerId === selected.id) {
      // Unpin worker
      this.pinnedWorkerId = undefined;
    } else {
      // Pin worker
      this.pinnedWorkerId = selected.id;
    }

    this.updateFooter();
    this.render();
  }

  /**
   * Toggle bead pin
   */
  private toggleBeadPin(): void {
    if (this.viewMode !== 'default') return;

    const selected = this.workerGrid.getSelected();
    if (!selected || !selected.lastEvent?.bead) return;

    const beadId = selected.lastEvent.bead;
    if (this.pinnedBeadId === beadId) {
      // Unpin bead
      this.pinnedBeadId = undefined;
    } else {
      // Pin bead
      this.pinnedBeadId = beadId;
    }

    this.updateFooter();
    this.render();
  }

  /**
   * Toggle focus mode
   */
  private toggleFocusMode(): void {
    if (this.viewMode !== 'default') return;

    this.focusModeEnabled = !this.focusModeEnabled;

    // If disabling focus mode, clear pins
    if (!this.focusModeEnabled) {
      this.pinnedWorkerId = undefined;
      this.pinnedBeadId = undefined;
    }

    this.updateFooter();
    this.render();
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
      tags: true,
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
  H       - Toggle file heatmap
  D       - Toggle dependency DAG
  R       - Toggle session replay
  E       - Toggle error groups
  C       - Toggle collision alerts
  G       - Toggle session digest
  I       - Toggle git integration
  N       - Toggle semantic narrative
  A       - Toggle worker analytics

Focus Mode:
  F       - Toggle focus mode
  p       - Pin/unpin selected worker
  P       - Pin/unpin bead (from selected worker)

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

Session Digest:
  G       - Toggle session digest view
  1-5     - Switch tabs (Summary/Beads/Files/Errors/Workers)
  e       - Export as JSON
  m       - Export as Markdown
  j/k     - Scroll content
  Esc     - Return to default view

Collision Alerts:
  ↑/↓ or j/k - Navigate alerts
  Enter   - Acknowledge selected alert
  a       - Acknowledge all alerts
  Esc     - Return to default view

Semantic Narrative:
  N       - Toggle semantic narrative view
  ↑/↓ or j/k - Navigate segments
  Enter   - Toggle detail view
  f       - Toggle full narrative
  r       - Refresh narrative
  Esc     - Return to default view

Worker Analytics:
  A       - Toggle worker analytics view
  ↑/↓ or j/k - Navigate workers
  Enter   - Toggle detail view
  a       - Toggle aggregated view
  s       - Cycle sort mode
  r       - Refresh metrics
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
    this.workerGrid.setFocusMode(this.focusModeEnabled, this.pinnedWorkerId);
    this.activityStream.setFocusMode(this.focusModeEnabled, this.pinnedBeadId, this.pinnedWorkerId);
  }

  /**
   * Add event to activity stream
   */
  addEvent(event: LogEvent): void {
    this.activityStream.addEvent(event);
    this.renderWorkers();

    // Update focus mode state after rendering
    this.workerGrid.setFocusMode(this.focusModeEnabled, this.pinnedWorkerId);
    this.activityStream.setFocusMode(this.focusModeEnabled, this.pinnedBeadId, this.pinnedWorkerId);

    // Update heatmap if visible
    if (this.viewMode === 'heatmap') {
      this.fileHeatmap.updateData(
        (opts) => this.store.getFileHeatmap(opts),
        () => this.store.getFileHeatmapStats()
      );
    }

    // Update collision alerts if visible
    if (this.viewMode === 'collisions') {
      this.updateCollisionAlerts();
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

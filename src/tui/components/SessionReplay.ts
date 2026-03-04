/**
 * SessionReplay Component
 *
 * Provides session replay functionality - ability to replay worker activity
 * history chronologically with playback controls.
 */

import blessed from 'blessed';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { LogEvent, ReplaySpeed, ReplayState, EventFilter } from '../../types.js';
import { parseLogLine } from '../../parser.js';
import { colors, getLevelColor } from '../utils/colors.js';

export interface SessionReplayOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from left */
  left: number | string;

  /** Width of the panel */
  width: number | string;

  /** Height of the panel */
  height: number | string;

  /** Callback when event is emitted during playback */
  onEvent?: (event: LogEvent, index: number, total: number) => void;

  /** Callback when state changes */
  onStateChange?: (state: ReplayState) => void;
}

export interface ReplaySessionData {
  sourcePath: string;
  events: LogEvent[];
  startTime: number;
  endTime: number;
}

/**
 * SessionReplay handles loading and playing back historical log events
 */
export class SessionReplay extends EventEmitter {
  private container: blessed.Widgets.BoxElement;
  private timelineBox: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;
  private controlsBox: blessed.Widgets.BoxElement;
  private parent: blessed.Widgets.Screen;

  private events: LogEvent[] = [];
  private filteredEvents: LogEvent[] = [];
  private currentIndex: number = 0;
  private state: ReplayState = 'idle';
  private speed: ReplaySpeed = 1;
  private filter?: EventFilter;
  private playbackTimer?: NodeJS.Timeout;
  private sourcePath: string = '';

  private onEventCallback?: (event: LogEvent, index: number, total: number) => void;
  private onStateChangeCallback?: (state: ReplayState) => void;

  constructor(options: SessionReplayOptions) {
    super();

    this.parent = options.parent;
    this.onEventCallback = options.onEvent;
    this.onStateChangeCallback = options.onStateChange;

    // Main container
    this.container = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Session Replay ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
    });

    // Timeline bar at top
    this.timelineBox = blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      content: this.formatTimeline(),
      style: {
        fg: colors.info,
        bg: colors.bgPanel,
      },
    });

    // Log display area
    this.logBox = blessed.log({
      parent: this.container,
      top: 1,
      left: 0,
      right: 0,
      bottom: 2,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        fg: colors.info,
      },
    });

    // Controls bar at bottom
    this.controlsBox = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      right: 0,
      height: 2,
      content: this.formatControls(),
      style: {
        fg: colors.muted,
      },
    });

    this.bindKeys();
  }

  /**
   * Bind keyboard shortcuts
   */
  private bindKeys(): void {
    this.container.key(['space'], () => this.toggle());
    this.container.key(['p'], () => this.toggle());
    this.container.key(['right'], () => this.stepForward());
    this.container.key(['left'], () => this.stepBackward());
    this.container.key(['n'], () => this.stepForward());
    this.container.key(['b'], () => this.stepBackward());
    this.container.key(['up'], () => this.increaseSpeed());
    this.container.key(['down'], () => this.decreaseSpeed());
    this.container.key(['home'], () => this.seekTo(0));
    this.container.key(['end'], () => this.seekTo(this.filteredEvents.length - 1));
    this.container.key(['r'], () => this.reset());
    this.container.key(['1'], () => this.setSpeed(0.5));
    this.container.key(['2'], () => this.setSpeed(1));
    this.container.key(['3'], () => this.setSpeed(2));
    this.container.key(['4'], () => this.setSpeed(5));
    this.container.key(['5'], () => this.setSpeed(10));
  }

  /**
   * Load events from a log file
   */
  loadFile(filePath: string, filter?: EventFilter): Promise<number> {
    return new Promise((resolve, reject) => {
      const expandedPath = filePath.startsWith('~')
        ? filePath.replace('~', process.env.HOME || '')
        : filePath;

      if (!fs.existsSync(expandedPath)) {
        reject(new Error(`Log file not found: ${expandedPath}`));
        return;
      }

      this.sourcePath = expandedPath;
      this.filter = filter;

      const content = fs.readFileSync(expandedPath, 'utf-8');
      const lines = content.split('\n');

      this.events = [];
      for (const line of lines) {
        if (line.trim()) {
          const event = parseLogLine(line);
          if (event) {
            this.events.push(event);
          }
        }
      }

      // Sort by timestamp
      this.events.sort((a, b) => a.ts - b.ts);

      // Apply filter
      this.applyFilter();

      // Reset state
      this.currentIndex = 0;
      this.state = 'idle';
      this.updateDisplay();
      this.emit('loaded', this.events.length);

      resolve(this.events.length);
    });
  }

  /**
   * Load events from array
   */
  loadEvents(events: LogEvent[], filter?: EventFilter): void {
    this.events = [...events].sort((a, b) => a.ts - b.ts);
    this.filter = filter;
    this.applyFilter();
    this.currentIndex = 0;
    this.state = 'idle';
    this.updateDisplay();
    this.emit('loaded', this.events.length);
  }

  /**
   * Apply current filter to events
   */
  private applyFilter(): void {
    if (!this.filter) {
      this.filteredEvents = [...this.events];
      return;
    }

    this.filteredEvents = this.events.filter(event => {
      if (this.filter!.worker && event.worker !== this.filter!.worker) return false;
      if (this.filter!.level && event.level !== this.filter!.level) return false;
      if (this.filter!.bead && event.bead !== this.filter!.bead) return false;
      if (this.filter!.path && event.path !== this.filter!.path) return false;
      if (this.filter!.since && event.ts < this.filter!.since) return false;
      if (this.filter!.until && event.ts > this.filter!.until) return false;
      return true;
    });
  }

  /**
   * Set filter and reapply
   */
  setFilter(filter?: EventFilter): void {
    this.filter = filter;
    this.applyFilter();
    this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.filteredEvents.length - 1));
    this.updateDisplay();
  }

  /**
   * Start or resume playback
   */
  play(): void {
    if (this.state === 'ended' || this.filteredEvents.length === 0) return;

    this.state = 'playing';
    this.onStateChangeCallback?.(this.state);
    this.updateDisplay();
    this.scheduleNextEvent();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state !== 'playing') return;

    this.state = 'paused';
    this.onStateChangeCallback?.(this.state);
    this.clearTimer();
    this.updateDisplay();
  }

  /**
   * Toggle play/pause
   */
  toggle(): void {
    if (this.state === 'playing') {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Step forward one event
   */
  stepForward(): void {
    if (this.currentIndex >= this.filteredEvents.length - 1) return;

    this.pause();
    this.currentIndex++;
    this.displayCurrentEvent();
    this.updateDisplay();
  }

  /**
   * Step backward one event
   */
  stepBackward(): void {
    if (this.currentIndex <= 0) return;

    this.pause();
    this.currentIndex--;
    this.displayCurrentEvent();
    this.updateDisplay();
  }

  /**
   * Jump to specific index
   */
  seekTo(index: number): void {
    const safeIndex = Math.max(0, Math.min(index, this.filteredEvents.length - 1));
    if (safeIndex === this.currentIndex) return;

    this.pause();
    this.currentIndex = safeIndex;
    this.displayCurrentEvent();
    this.updateDisplay();
  }

  /**
   * Seek to percentage (0-100)
   */
  seekToPercent(percent: number): void {
    const index = Math.floor((percent / 100) * (this.filteredEvents.length - 1));
    this.seekTo(index);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: ReplaySpeed): void {
    this.speed = speed;
    this.updateDisplay();

    // Reschedule if playing
    if (this.state === 'playing') {
      this.clearTimer();
      this.scheduleNextEvent();
    }
  }

  /**
   * Increase speed
   */
  increaseSpeed(): void {
    const speeds: ReplaySpeed[] = [0.5, 1, 2, 5, 10];
    const currentIdx = speeds.indexOf(this.speed);
    if (currentIdx < speeds.length - 1) {
      this.setSpeed(speeds[currentIdx + 1]);
    }
  }

  /**
   * Decrease speed
   */
  decreaseSpeed(): void {
    const speeds: ReplaySpeed[] = [0.5, 1, 2, 5, 10];
    const currentIdx = speeds.indexOf(this.speed);
    if (currentIdx > 0) {
      this.setSpeed(speeds[currentIdx - 1]);
    }
  }

  /**
   * Reset replay to beginning
   */
  reset(): void {
    this.pause();
    this.currentIndex = 0;
    this.state = 'idle';
    this.logBox.setContent('');
    this.updateDisplay();
    this.emit('reset');
  }

  /**
   * Get current state
   */
  getState(): ReplayState {
    return this.state;
  }

  /**
   * Get current speed
   */
  getSpeed(): ReplaySpeed {
    return this.speed;
  }

  /**
   * Get progress info
   */
  getProgress(): { current: number; total: number; percent: number } {
    const total = this.filteredEvents.length;
    const current = this.currentIndex;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    return { current, total, percent };
  }

  /**
   * Get session time range
   */
  getTimeRange(): { start: number; end: number } | null {
    if (this.filteredEvents.length === 0) return null;
    return {
      start: this.filteredEvents[0].ts,
      end: this.filteredEvents[this.filteredEvents.length - 1].ts,
    };
  }

  /**
   * Schedule next event playback
   */
  private scheduleNextEvent(): void {
    if (this.state !== 'playing') return;
    if (this.currentIndex >= this.filteredEvents.length) {
      this.state = 'ended';
      this.onStateChangeCallback?.(this.state);
      this.updateDisplay();
      this.emit('ended');
      return;
    }

    // Calculate delay based on time difference and speed
    let delay = 100; // Default 100ms between events

    if (this.currentIndex > 0 && this.currentIndex < this.filteredEvents.length) {
      const prevEvent = this.filteredEvents[this.currentIndex - 1];
      const currEvent = this.filteredEvents[this.currentIndex];
      const timeDiff = currEvent.ts - prevEvent.ts;
      delay = Math.max(10, Math.min(5000, timeDiff / this.speed));
    }

    this.playbackTimer = setTimeout(() => {
      this.displayCurrentEvent();
      this.currentIndex++;
      this.onEventCallback?.(
        this.filteredEvents[this.currentIndex - 1],
        this.currentIndex,
        this.filteredEvents.length
      );
      this.updateDisplay();
      this.scheduleNextEvent();
    }, delay);
  }

  /**
   * Clear playback timer
   */
  private clearTimer(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = undefined;
    }
  }

  /**
   * Display current event
   */
  private displayCurrentEvent(): void {
    if (this.currentIndex >= this.filteredEvents.length) return;

    const event = this.filteredEvents[this.currentIndex];
    const formatted = this.formatEvent(event);
    this.logBox.log(formatted);
    this.emit('event', event, this.currentIndex, this.filteredEvents.length);
  }

  /**
   * Format event for display
   */
  private formatEvent(event: LogEvent): string {
    const time = new Date(event.ts).toLocaleTimeString();
    const levelColor = getLevelColor(event.level as 'debug' | 'info' | 'warn' | 'error');
    const workerShort = event.worker.slice(0, 8);

    let msg = event.msg;
    if (event.tool) {
      msg = `[{cyan-fg}${event.tool}{/}] ${msg}`;
    }
    if (event.bead) {
      msg = `{blue-fg}${event.bead}{/} ${msg}`;
    }

    return `{gray-fg}${time}{/} {bold}${workerShort}{/} {${levelColor}-fg}${event.level.toUpperCase()}{/} ${msg}`;
  }

  /**
   * Format timeline display
   */
  private formatTimeline(): string {
    const { current, total, percent } = this.getProgress();
    const timeRange = this.getTimeRange();

    // Create progress bar
    const barWidth = 30;
    const filled = Math.round((percent / 100) * barWidth);
    const empty = barWidth - filled;
    const progressBar = '█'.repeat(filled) + '░'.repeat(empty);

    let timeInfo = '';
    if (timeRange) {
      const startTime = new Date(timeRange.start).toLocaleTimeString();
      const endTime = new Date(timeRange.end).toLocaleTimeString();
      timeInfo = `${startTime} - ${endTime}`;
    }

    const stateIcon = this.getStateIcon();

    return ` ${stateIcon} [${progressBar}] ${percent}% (${current}/${total}) ${timeInfo}`;
  }

  /**
   * Get icon for current state
   */
  private getStateIcon(): string {
    switch (this.state) {
      case 'playing': return '▶';
      case 'paused': return '⏸';
      case 'ended': return '⏹';
      default: return '⏵';
    }
  }

  /**
   * Format controls display
   */
  private formatControls(): string {
    const speedDisplay = `${this.speed}x`;
    return ` Speed: ${speedDisplay} | [Space] Play/Pause | [←/→] Step | [↑/↓] Speed | [1-5] 0.5x-10x | [Home/End] Jump | [r] Reset`;
  }

  /**
   * Update display elements
   */
  private updateDisplay(): void {
    this.timelineBox.setContent(this.formatTimeline());
    this.controlsBox.setContent(this.formatControls());
    this.container.setLabel(` Session Replay ${this.sourcePath ? `- ${this.sourcePath.split('/').pop()} ` : ' '}`);
    this.parent.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.container.focus();
  }

  /**
   * Show the component
   */
  show(): void {
    this.container.show();
    this.parent.render();
  }

  /**
   * Hide the component
   */
  hide(): void {
    this.container.hide();
    this.parent.render();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.clearTimer();
    this.container.destroy();
  }
}

export default SessionReplay;

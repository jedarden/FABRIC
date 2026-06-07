import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LogEvent, WorkerInfo, WebSocketMessage, CollisionAlert as CollisionAlertData, RecoverySuggestion } from './types';
import { ThemeProvider, useTheme } from './ThemeContext';
import WorkerGrid from './components/WorkerGrid';
import ActivityStream from './components/ActivityStream';
import WorkerDetail from './components/WorkerDetail';
import CollisionAlert from './components/CollisionAlert';
import FileHeatmap from './components/FileHeatmap';
import DependencyDag from './components/DependencyDag';
import RecoveryPanel from './components/RecoveryPanel';
import CrossReferencePanel from './components/CrossReferencePanel';
import FileContextPanel from './components/FileContextPanel';
import TimelineView from './components/TimelineView';
import SessionReplay from './components/SessionReplay';
import CostDashboard from './components/CostDashboard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import ErrorGroupPanel from './components/ErrorGroupPanel';
import SemanticNarrativePanel from './components/SemanticNarrativePanel';
import BudgetAlertPanel, { BudgetBanner } from './components/BudgetAlertPanel';
import OomAlertBanner from './components/OomAlertBanner';
import SessionDigestPanel from './components/SessionDigestPanel';
import GitIntegrationPanel from './components/GitIntegrationPanel';
import ProductivityPanel from './components/ProductivityPanel';
import FleetSummaryBar from './components/FleetSummaryBar';
import SystemMemoryIndicator from './components/SystemMemoryIndicator';
import HistoricalSessionsPanel from './components/HistoricalSessionsPanel';
import WorkerAnalyticsPanel from './components/WorkerAnalyticsPanel';
import CommandPalette from './components/CommandPalette';
import { SystemMemoryPanel } from './components/SystemMemoryPanel';
import { Agentation } from 'agentation';
import { extractReplayFromUrl, ReplayExport } from './utils/replayExport';
import { FocusPresetManager, createWebPresetManager, FocusPreset } from './utils/focusPresets';

const FOCUS_MODE_STORAGE_KEY = 'fabric-focus-mode';

// WebSocket reconnection configuration
const RECONNECT_BASE_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 30000; // 30 seconds
const RECONNECT_MAX_RETRIES = 10;  // Max retries before manual intervention

// Focus preset manager singleton
let presetManagerInstance: FocusPresetManager | null = null;

function getPresetManager(): FocusPresetManager {
  if (!presetManagerInstance) {
    presetManagerInstance = createWebPresetManager();
  }
  return presetManagerInstance;
}

// Connection states
type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface ReconnectState {
  state: ConnectionState;
  attemptCount: number;
  nextRetryIn: number | null;
}

/**
 * Custom hook for WebSocket with auto-reconnect and exponential backoff
 */
function useWebSocketReconnect(
  onMessage: (message: WebSocketMessage) => void
): {
  reconnectState: ReconnectState;
  connect: () => void;
  disconnect: () => void;
  resetAndReconnect: () => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptCountRef = useRef(0);

  const [reconnectState, setReconnectState] = useState<ReconnectState>({
    state: 'disconnected',
    attemptCount: 0,
    nextRetryIn: null,
  });

  const getReconnectDelay = useCallback((attempt: number): number => {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempt), RECONNECT_MAX_DELAY);
    return delay;
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    clearTimers();

    if (attemptCountRef.current >= RECONNECT_MAX_RETRIES) {
      // Max retries reached - require manual intervention
      setReconnectState({
        state: 'disconnected',
        attemptCount: attemptCountRef.current,
        nextRetryIn: null,
      });
      return;
    }

    const delay = getReconnectDelay(attemptCountRef.current);
    const targetTime = Date.now() + delay;

    setReconnectState(prev => ({
      ...prev,
      state: 'reconnecting',
      attemptCount: attemptCountRef.current,
      nextRetryIn: Math.ceil(delay / 1000),
    }));

    // Countdown interval
    countdownIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000));
      setReconnectState(prev => ({
        ...prev,
        nextRetryIn: remaining,
      }));
    }, 1000);

    // Schedule reconnect
    reconnectTimeoutRef.current = setTimeout(() => {
      attemptCountRef.current++;
      connectInternal();
    }, delay);
  }, [getReconnectDelay, clearTimers]);

  const connectInternal = useCallback(() => {
    clearTimers();

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptCountRef.current = 0;
      setReconnectState({
        state: 'connected',
        attemptCount: 0,
        nextRetryIn: null,
      });
      console.log('WebSocket connected');
    };

    ws.onclose = (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
      // Only attempt reconnect if not manually closed (1000 = normal closure)
      if (event.code !== 1000) {
        scheduleReconnect();
      } else {
        setReconnectState({
          state: 'disconnected',
          attemptCount: attemptCountRef.current,
          nextRetryIn: null,
        });
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        onMessage(message);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
  }, [onMessage, clearTimers, scheduleReconnect]);

  const connect = useCallback(() => {
    connectInternal();
  }, [connectInternal]);

  const disconnect = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    setReconnectState({
      state: 'disconnected',
      attemptCount: 0,
      nextRetryIn: null,
    });
  }, [clearTimers]);

  const resetAndReconnect = useCallback(() => {
    clearTimers();
    attemptCountRef.current = 0;
    connectInternal();
  }, [clearTimers, connectInternal]);

  // Auto-connect on mount
  useEffect(() => {
    connectInternal();
    return () => {
      disconnect();
    };
  }, [connectInternal, disconnect]);

  return { reconnectState, connect, disconnect, resetAndReconnect };
}

interface FocusModeState {
  enabled: boolean;
  pinnedWorkers: string[];
  pinnedBeads: string[];
}

/**
 * Theme toggle button component
 */
const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className="theme-toggle-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
      <span className="theme-toggle-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
};

const App: React.FC = () => {
  const { toggleTheme, setTheme } = useTheme();
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [collisionAlerts, setCollisionAlerts] = useState<CollisionAlertData[]>([]);
  const [showCollisionPanel, setShowCollisionPanel] = useState(false);
  const [showFileHeatmap, setShowFileHeatmap] = useState(false);
  const [showDependencyDag, setShowDependencyDag] = useState(false);
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [showCrossReference, setShowCrossReference] = useState(false);
  const [showFileContext, setShowFileContext] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showCostDashboard, setShowCostDashboard] = useState(false);
  const [showErrorGroups, setShowErrorGroups] = useState(false);
  const [showBudgetAlert, setShowBudgetAlert] = useState(false);
  const [showSessionDigest, setShowSessionDigest] = useState(false);
  const [showGitIntegration, setShowGitIntegration] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);
  const [showProductivity, setShowProductivity] = useState(false);
  const [showHistoricalSessions, setShowHistoricalSessions] = useState(false);
  const [showWorkerAnalytics, setShowWorkerAnalytics] = useState(false);
  const [showSystemMemory, setShowSystemMemory] = useState(false);
  const [budgetBannerDismissed, setBudgetBannerDismissed] = useState(false);
  const [oomBannerDismissed, setOomBannerDismissed] = useState(false);
  const [hideTestWorkers, setHideTestWorkers] = useState(true);

  // Budget alert state polled from /api/cost/summary
  const [budgetSummary, setBudgetSummary] = useState<{
    budget: { limit: number; spent: number; percentUsed: number; isOverBudget: boolean; warningLevel: 'none' | 'warning' | 'critical'; remaining: number };
    burnRate: { costPerMinute: number; minutesToExhaustion: number | null; timeToExhaustion: string | null; projectedTotalCost: number; windowMinutes: number; isHighBurnRate: boolean };
  } | null>(null);
  const [highlightSequence, setHighlightSequence] = useState<number | null>(null);
  const [selectedTimelineTime, setSelectedTimelineTime] = useState<number | null>(null);
  const [recoverySuggestions, setRecoverySuggestions] = useState<RecoverySuggestion[]>([]);

  // Session Replay state
  const [showSessionReplay, setShowSessionReplay] = useState(false);
  const [replayEvents, setReplayEvents] = useState<LogEvent[]>([]);
  const [replayMetadata, setReplayMetadata] = useState<ReplayExport['metadata'] | null>(null);
  const [replayImportError, setReplayImportError] = useState<string | null>(null);

  // Check URL for replay parameter on mount
  useEffect(() => {
    const replayData = extractReplayFromUrl();
    if (replayData) {
      setReplayEvents(replayData.events);
      setReplayMetadata(replayData.metadata);
      setShowSessionReplay(true);
      // Clear the URL parameter after loading
      const url = new URL(window.location.href);
      url.searchParams.delete('replay');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Poll budget status for banner alerts
  useEffect(() => {
    const pollBudget = async () => {
      try {
        const res = await fetch('/api/cost/summary');
        if (res.ok) {
          const data = await res.json();
          setBudgetSummary({ budget: data.budget, burnRate: data.burnRate });
        }
      } catch {
        // ignore
      }
    };
    pollBudget();
    const interval = setInterval(pollBudget, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch recovery suggestions from API
  useEffect(() => {
    const fetchRecoverySuggestions = async () => {
      try {
        const response = await fetch('/api/recovery/suggestions');
        if (response.ok) {
          const suggestions = await response.json();
          setRecoverySuggestions(suggestions);
        }
      } catch (err) {
        console.error('Failed to fetch recovery suggestions:', err);
      }
    };

    // Fetch immediately
    fetchRecoverySuggestions();

    // Poll every 30 seconds for updates
    const interval = setInterval(fetchRecoverySuggestions, 30000);
    return () => clearInterval(interval);
  }, []);

  // Focus Mode state
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const [pinnedWorkers, setPinnedWorkers] = useState<Set<string>>(new Set());
  const [pinnedBeads, setPinnedBeads] = useState<Set<string>>(new Set());

  // Focus Preset state
  const [presets, setPresets] = useState<FocusPreset[]>([]);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [showPresetSaveDialog, setShowPresetSaveDialog] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const presetManager = getPresetManager();

  // Load Focus Mode state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem(FOCUS_MODE_STORAGE_KEY);
    if (savedState) {
      try {
        const parsed: FocusModeState = JSON.parse(savedState);
        setFocusModeEnabled(parsed.enabled);
        setPinnedWorkers(new Set(parsed.pinnedWorkers));
        setPinnedBeads(new Set(parsed.pinnedBeads));
      } catch (error) {
        console.error('Failed to parse Focus Mode state:', error);
      }
    }
  }, []);

  // Save Focus Mode state to localStorage whenever it changes
  useEffect(() => {
    const state: FocusModeState = {
      enabled: focusModeEnabled,
      pinnedWorkers: Array.from(pinnedWorkers),
      pinnedBeads: Array.from(pinnedBeads),
    };
    localStorage.setItem(FOCUS_MODE_STORAGE_KEY, JSON.stringify(state));
  }, [focusModeEnabled, pinnedWorkers, pinnedBeads]);

  // Load presets on mount and subscribe to changes
  useEffect(() => {
    setPresets(presetManager.getPresets());
    const unsubscribe = presetManager.subscribe(() => {
      setPresets(presetManager.getPresets());
    });
    return unsubscribe;
  }, [presetManager]);

  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'init') {
      const data = message.data as { workers?: WorkerInfo[]; recentEvents?: LogEvent[]; alerts?: CollisionAlertData[] };
      if (data.workers) setWorkers(data.workers);
      if (data.recentEvents) setEvents(data.recentEvents);
      if (data.alerts) setCollisionAlerts(data.alerts);
    } else if (message.type === 'event') {
      const event = message.data as LogEvent;
      setEvents(prev => [...prev.slice(-199), event]);

      // Update worker info
      setWorkers(prev => {
        const existing = prev.find(w => w.id === event.worker);
        if (existing) {
          return prev.map(w => w.id === event.worker ? {
            ...w,
            lastSeen: event.timestamp ?? (event.ts ? new Date(event.ts).toISOString() : undefined),
            eventCount: w.eventCount + 1,
            status: 'active' as const,
            currentTool: event.tool,
            recentEvents: [...(w.recentEvents ?? []).slice(-9), event],
          } : w);
        } else {
          return [...prev, {
            id: event.worker,
            lastSeen: event.timestamp ?? (event.ts ? new Date(event.ts).toISOString() : undefined),
            eventCount: 1,
            status: 'active' as const,
            currentTool: event.tool,
            recentEvents: [event],
          }];
        }
      });
    } else if (message.type === 'collision-alert') {
      const alert = message.data as CollisionAlertData;
      setCollisionAlerts(prev => {
        // Avoid duplicates
        if (prev.some(a => a.id === alert.id)) {
          return prev.map(a => a.id === alert.id ? alert : a);
        }
        return [...prev, alert];
      });
    }
  }, []);

  // Use the auto-reconnect hook
  const { reconnectState, resetAndReconnect } = useWebSocketReconnect(handleWebSocketMessage);

  // Focus Mode callbacks
  const toggleFocusMode = useCallback(() => {
    setFocusModeEnabled(prev => !prev);
  }, []);

  const togglePinWorker = useCallback((workerId: string) => {
    setPinnedWorkers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(workerId)) {
        newSet.delete(workerId);
      } else {
        newSet.add(workerId);
      }
      return newSet;
    });
  }, []);

  const togglePinBead = useCallback((beadId: string) => {
    setPinnedBeads(prev => {
      const newSet = new Set(prev);
      if (newSet.has(beadId)) {
        newSet.delete(beadId);
      } else {
        newSet.add(beadId);
      }
      return newSet;
    });
  }, []);

  // Focus Preset callbacks
  const saveCurrentPreset = useCallback(() => {
    if (!presetNameInput.trim()) return;
    presetManager.savePreset(
      presetNameInput.trim(),
      Array.from(pinnedWorkers),
      Array.from(pinnedBeads)
    );
    setPresetNameInput('');
    setShowPresetSaveDialog(false);
  }, [presetNameInput, pinnedWorkers, pinnedBeads, presetManager]);

  const loadPreset = useCallback((preset: FocusPreset) => {
    setPinnedWorkers(new Set(preset.pinnedWorkers));
    setPinnedBeads(new Set(preset.pinnedBeads));
    setFocusModeEnabled(true);
    setShowPresetDropdown(false);
  }, []);

  const deletePreset = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    presetManager.deletePreset(name);
  }, [presetManager]);

  // Global Cmd+K / Ctrl+K handler
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Command palette command dispatcher
  const handleCommandExecute = useCallback((action: string) => {
    if (action === 'clear') {
      setSelectedWorker(null);
      setPinnedWorkers(new Set());
      setPinnedBeads(new Set());
      setFocusModeEnabled(false);
    } else if (action === 'refresh') {
      window.location.reload();
    } else if (action === 'theme:toggle') {
      toggleTheme();
    } else if (action === 'theme:dark') {
      setTheme('dark');
    } else if (action === 'theme:light') {
      setTheme('light');
    } else if (action === 'focus:toggle') {
      setFocusModeEnabled(prev => !prev);
    } else if (action === 'focus:clear') {
      setPinnedWorkers(new Set());
      setPinnedBeads(new Set());
    } else if (action === 'preset:save') {
      setShowPresetSaveDialog(true);
    } else if (action === 'preset:list') {
      setShowPresetDropdown(true);
    } else if (action === 'show:heatmap') {
      setShowFileHeatmap(true);
    } else if (action === 'show:dag') {
      setShowDependencyDag(true);
    } else if (action === 'show:analytics') {
      setShowAnalytics(true);
    } else if (action === 'show:recovery') {
      setShowRecoveryPanel(true);
    } else if (action === 'show:filecontext') {
      setShowFileContext(true);
    } else if (action === 'show:timeline') {
      setShowTimeline(prev => !prev);
    } else if (action === 'show:replay') {
      setShowSessionReplay(true);
    } else if (action === 'show:crossref') {
      setShowCrossReference(true);
    } else if (action === 'show:cost') {
      setShowCostDashboard(true);
    } else if (action === 'show:errors') {
      setShowErrorGroups(true);
    } else if (action === 'show:budget') {
      setShowBudgetAlert(true);
    } else if (action === 'show:digest') {
      setShowSessionDigest(true);
    } else if (action === 'show:git') {
      setShowGitIntegration(true);
    } else if (action === 'show:narrative') {
      setShowNarrative(true);
    } else if (action === 'show:sessions') {
      setShowHistoricalSessions(true);
    } else if (action === 'show:worker-analytics') {
      setShowWorkerAnalytics(true);
    } else if (action === 'show:memory') {
      setShowSystemMemory(true);
    } else if (action.startsWith('worker:')) {
      const workerId = action.slice('worker:'.length);
      setSelectedWorker(workerId);
    } else if (action.startsWith('bead:')) {
      const beadId = action.slice('bead:'.length);
      togglePinBead(beadId);
      setFocusModeEnabled(true);
    } else if (action.startsWith('filter:worker:')) {
      const workerId = action.slice('filter:worker:'.length);
      if (workerId) setSelectedWorker(workerId);
    } else if (action.startsWith('filter:bead:')) {
      const beadId = action.slice('filter:bead:'.length);
      if (beadId) {
        togglePinBead(beadId);
        setFocusModeEnabled(true);
      }
    } else if (action.startsWith('log:')) {
      // log:workerId — select that worker
      const workerId = action.slice('log:'.length);
      if (workerId) setSelectedWorker(workerId);
    }
    // filter:level:X — handled by ActivityStream's own filter controls (not wired here)
  }, [toggleTheme, setTheme, togglePinBead]);

  // Timeline time selection handler
  const handleTimelineTimeSelect = useCallback((timestamp: number) => {
    setSelectedTimelineTime(timestamp);
    // Clear the selection after 5 seconds
    setTimeout(() => setSelectedTimelineTime(null), 5000);
  }, []);

  // Activity stream → conversation sync: clicking an event selects the worker
  // and highlights the corresponding turn in the conversation view
  const handleEventSelect = useCallback((event: LogEvent) => {
    setSelectedWorker(event.worker);
    if (event.sequence != null) {
      setHighlightSequence(event.sequence);
      setTimeout(() => setHighlightSequence(null), 4000);
    }
  }, []);

  // Filter workers and events based on Focus Mode
  const filteredWorkers = focusModeEnabled && pinnedWorkers.size > 0
    ? workers.filter(w => pinnedWorkers.has(w.id))
    : workers;

  const filteredEventsByFocusMode = focusModeEnabled && (pinnedWorkers.size > 0 || pinnedBeads.size > 0)
    ? events.filter(e => {
        const matchesPinnedWorker = pinnedWorkers.size === 0 || pinnedWorkers.has(e.worker);
        const matchesPinnedBead = pinnedBeads.size === 0 || (e.bead && pinnedBeads.has(e.bead));
        return matchesPinnedWorker || matchesPinnedBead;
      })
    : events;

  const filteredEvents = selectedWorker
    ? filteredEventsByFocusMode.filter(e => e.worker === selectedWorker)
    : filteredEventsByFocusMode;

  const selectedWorkerInfo = selectedWorker
    ? filteredWorkers.find(w => w.id === selectedWorker)
    : null;

  const handleAcknowledgeAlert = useCallback((alertId: string) => {
    setCollisionAlerts(prev =>
      prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)
    );
  }, []);

  const handleAcknowledgeAllAlerts = useCallback(() => {
    setCollisionAlerts(prev =>
      prev.map(a => ({ ...a, acknowledged: true }))
    );
  }, []);

  const unacknowledgedAlertCount = collisionAlerts.filter(a => !a.acknowledged).length;

  return (
    <div className="app">
      <OomAlertBanner onDismiss={() => setOomBannerDismissed(true)} />
      {budgetSummary && !budgetBannerDismissed && budgetSummary.budget.warningLevel !== 'none' && (
        <BudgetBanner
          budget={budgetSummary.budget}
          burnRate={budgetSummary.burnRate}
          onOpenPanel={() => setShowBudgetAlert(true)}
          onDismiss={() => setBudgetBannerDismissed(true)}
        />
      )}
      <header className="header">
        <h1>FABRIC</h1>
        <div className="header-actions">
          <button
            className="command-palette-toggle"
            onClick={() => setShowCommandPalette(true)}
            title="Open command palette (Cmd+K / Ctrl+K)"
          >
            <span className="command-palette-icon">⌘</span>
            <span className="command-palette-label">K</span>
          </button>
          <ThemeToggle />
          <button
            className={`focus-mode-toggle ${focusModeEnabled ? 'active' : ''}`}
            onClick={toggleFocusMode}
            title={focusModeEnabled ? 'Focus Mode: ON (showing pinned only)' : 'Focus Mode: OFF (showing all)'}
          >
            <span className="focus-mode-icon">{focusModeEnabled ? '📌' : '📍'}</span>
            <span className="focus-mode-label">Focus</span>
            {focusModeEnabled && (pinnedWorkers.size > 0 || pinnedBeads.size > 0) && (
              <span className="focus-mode-count">
                {pinnedWorkers.size + pinnedBeads.size}
              </span>
            )}
          </button>

          {/* Focus Presets Dropdown */}
          <div className="preset-dropdown-container">
            <button
              className="preset-toggle"
              onClick={() => setShowPresetDropdown(!showPresetDropdown)}
              title="Focus Presets"
            >
              <span className="preset-icon">💾</span>
              <span className="preset-label">Presets</span>
              {presets.length > 0 && (
                <span className="preset-count">{presets.length}</span>
              )}
            </button>
            {showPresetDropdown && (
              <div className="preset-dropdown">
                <button
                  className="preset-item preset-save"
                  onClick={() => {
                    setShowPresetSaveDialog(true);
                    setShowPresetDropdown(false);
                  }}
                >
                  <span className="preset-item-icon">+</span>
                  <span>Save Current...</span>
                </button>
                {presets.length > 0 && <div className="preset-divider" />}
                {presets.map(preset => (
                  <div
                    key={preset.name}
                    className="preset-item"
                    onClick={() => loadPreset(preset)}
                  >
                    <span className="preset-item-icon">▶</span>
                    <span className="preset-item-name">{preset.name}</span>
                    <button
                      className="preset-delete"
                      onClick={(e) => deletePreset(preset.name, e)}
                      title="Delete preset"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {presets.length === 0 && (
                  <div className="preset-empty">No presets saved</div>
                )}
              </div>
            )}
          </div>

          {/* Preset Save Dialog */}
          {showPresetSaveDialog && (
            <div className="preset-dialog-overlay" onClick={() => setShowPresetSaveDialog(false)}>
              <div className="preset-dialog" onClick={e => e.stopPropagation()}>
                <h3>Save Focus Preset</h3>
                <input
                  type="text"
                  placeholder="Preset name..."
                  value={presetNameInput}
                  onChange={e => setPresetNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCurrentPreset()}
                  autoFocus
                />
                <div className="preset-dialog-buttons">
                  <button onClick={() => setShowPresetSaveDialog(false)}>Cancel</button>
                  <button
                    className="primary"
                    onClick={saveCurrentPreset}
                    disabled={!presetNameInput.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
          <button
            className="dag-toggle"
            onClick={() => setShowDependencyDag(!showDependencyDag)}
            title="View task dependency graph"
          >
            <span className="dag-toggle-icon">🔗</span>
            <span className="dag-toggle-label">DAG</span>
          </button>
          <button
            className="recovery-toggle"
            onClick={() => setShowRecoveryPanel(!showRecoveryPanel)}
            title="View recovery suggestions"
          >
            <span className="recovery-toggle-icon">💊</span>
            <span className="recovery-toggle-label">Recovery</span>
          </button>
          <button
            className={`error-group-toggle ${showErrorGroups ? 'active' : ''}`}
            onClick={() => setShowErrorGroups(!showErrorGroups)}
            title="View error groups"
          >
            <span className="error-group-toggle-icon">🐛</span>
            <span className="error-group-toggle-label">Errors</span>
          </button>
          <button
            className="file-heatmap-toggle"
            onClick={() => setShowFileHeatmap(!showFileHeatmap)}
            title="View file heatmap"
          >
            <span className="file-heatmap-icon">🔥</span>
            <span className="file-heatmap-label">Heatmap</span>
          </button>
          <button
            className={`analytics-toggle ${showAnalytics ? 'active' : ''}`}
            onClick={() => setShowAnalytics(!showAnalytics)}
            title={showAnalytics ? 'Hide fleet analytics' : 'Show fleet analytics'}
          >
            <span className="analytics-toggle-icon">📈</span>
            <span className="analytics-toggle-label">Analytics</span>
          </button>
          <button
            className="file-context-toggle"
            onClick={() => setShowFileContext(!showFileContext)}
            title="Toggle file context panel"
          >
            <span className="file-context-icon">📄</span>
            <span className="file-context-label">Context</span>
          </button>
          <button
            className={`timeline-toggle ${showTimeline ? 'active' : ''}`}
            onClick={() => setShowTimeline(!showTimeline)}
            title={showTimeline ? 'Hide timeline' : 'Show timeline'}
          >
            <span className="timeline-toggle-icon">📊</span>
            <span className="timeline-toggle-label">Timeline</span>
          </button>
          <button
            className={`session-replay-toggle ${showSessionReplay ? 'active' : ''}`}
            onClick={() => setShowSessionReplay(!showSessionReplay)}
            title={showSessionReplay ? 'Hide session replay' : 'Show session replay'}
          >
            <span className="session-replay-toggle-icon">📼</span>
            <span className="session-replay-toggle-label">Replay</span>
          </button>
          <button
            className={`budget-toggle ${showBudgetAlert ? 'active' : ''}`}
            onClick={() => setShowBudgetAlert(!showBudgetAlert)}
            title="Budget alerts"
          >
            <span className="budget-toggle-icon">%</span>
            <span className="budget-toggle-label">Budget</span>
            {budgetSummary && budgetSummary.budget.warningLevel !== 'none' && (
              <span className="budget-alert-badge">!</span>
            )}
          </button>
          <button
            className={`digest-toggle ${showSessionDigest ? 'active' : ''}`}
            onClick={() => setShowSessionDigest(!showSessionDigest)}
            title="Generate session digest"
          >
            <span className="digest-toggle-icon">📋</span>
            <span className="digest-toggle-label">Digest</span>
          </button>
          <button
            className={`git-toggle ${showGitIntegration ? 'active' : ''}`}
            onClick={() => setShowGitIntegration(!showGitIntegration)}
            title="Git integration — live status for watched repo"
          >
            <span className="git-toggle-icon">&#x2335;</span>
            <span className="git-toggle-label">Git</span>
          </button>
          <button
            className={`narrative-toggle ${showNarrative ? 'active' : ''}`}
            onClick={() => setShowNarrative(!showNarrative)}
            title="Semantic narrative — natural language description of worker activity"
          >
            <span className="narrative-toggle-icon">&#x1F4DD;</span>
            <span className="narrative-toggle-label">Narrative</span>
          </button>
          <button
            className={`productivity-toggle ${showProductivity ? 'active' : ''}`}
            onClick={() => setShowProductivity(!showProductivity)}
            title="Productivity — daily throughput and worker leaderboard"
          >
            <span className="productivity-toggle-icon">&#x1F3C6;</span>
            <span className="productivity-toggle-label">Productivity</span>
          </button>
          <button
            className={`sessions-toggle ${showHistoricalSessions ? 'active' : ''}`}
            onClick={() => setShowHistoricalSessions(!showHistoricalSessions)}
            title="Historical Sessions — browse past sessions and worker performance"
          >
            <span className="sessions-toggle-icon">&#x1F4C5;</span>
            <span className="sessions-toggle-label">Sessions</span>
          </button>
          <button
            className={`worker-analytics-toggle ${showWorkerAnalytics ? 'active' : ''}`}
            onClick={() => setShowWorkerAnalytics(!showWorkerAnalytics)}
            title="Worker Analytics — comparison and performance metrics"
          >
            <span className="worker-analytics-toggle-icon">&#x2694;</span>
            <span className="worker-analytics-toggle-label">Workers</span>
          </button>
          <button
            className={`system-memory-toggle ${showSystemMemory ? 'active' : ''}`}
            onClick={() => setShowSystemMemory(!showSystemMemory)}
            title="System Memory — cgroup usage, swap, OOM risk"
          >
            <span className="system-memory-toggle-icon">💾</span>
            <span className="system-memory-toggle-label">Memory</span>
          </button>
          <button
            className={`hide-test-workers-toggle ${hideTestWorkers ? 'active' : ''}`}
            onClick={() => setHideTestWorkers(prev => !prev)}
            title={hideTestWorkers ? 'Test workers hidden — click to show' : 'Test workers visible — click to hide'}
          >
            <span className="hide-test-workers-icon">🧪</span>
            <span className="hide-test-workers-label">{hideTestWorkers ? 'Hide Tests' : 'Show Tests'}</span>
          </button>
          {unacknowledgedAlertCount > 0 && (
            <button
              className="collision-alert-toggle"
              onClick={() => setShowCollisionPanel(!showCollisionPanel)}
              title="View collision alerts"
            >
              <span className="collision-alert-icon">!</span>
              <span className="collision-alert-count">{unacknowledgedAlertCount}</span>
            </button>
          )}
          <div className={`connection-status ${reconnectState.state}`}>
            <span className={`status-dot ${reconnectState.state}`}></span>
            {reconnectState.state === 'connected' && 'Connected'}
            {reconnectState.state === 'reconnecting' && (
              <span className="reconnecting-text">
                Reconnecting...
                {reconnectState.nextRetryIn !== null && (
                  <span className="retry-countdown"> ({reconnectState.nextRetryIn}s)</span>
                )}
                <span className="attempt-count">[{reconnectState.attemptCount + 1}]</span>
              </span>
            )}
            {reconnectState.state === 'disconnected' && (
              <>
                <span>Disconnected</span>
                <button
                  className="reconnect-button"
                  onClick={resetAndReconnect}
                  title="Click to reconnect"
                >
                  Retry
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="fleet-header">
        <FleetSummaryBar workers={filteredWorkers} />
        <div className="fleet-header-separator" />
        <SystemMemoryIndicator onClick={() => setShowSystemMemory(true)} />
      </div>

      <main className="main-content">
        <WorkerGrid
          workers={filteredWorkers}
          selectedWorker={selectedWorker}
          onSelectWorker={setSelectedWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={togglePinWorker}
          focusModeEnabled={focusModeEnabled}
          hideTestWorkers={hideTestWorkers}
        />

        {showTimeline && (
          <TimelineView
            events={filteredEvents}
            workers={filteredWorkers}
            onTimeSelect={handleTimelineTimeSelect}
            selectedWorker={selectedWorker}
            focusModeEnabled={focusModeEnabled}
            pinnedWorkers={pinnedWorkers}
          />
        )}

        <ActivityStream
          events={filteredEvents}
          selectedWorker={selectedWorker}
          pinnedBeads={pinnedBeads}
          onTogglePinBead={togglePinBead}
          focusModeEnabled={focusModeEnabled}
          selectedTimelineTime={selectedTimelineTime}
          onEventSelect={handleEventSelect}
        />

        {selectedWorkerInfo && (
          <WorkerDetail
            worker={selectedWorkerInfo}
            onClose={() => setSelectedWorker(null)}
            allWorkerEvents={selectedWorker ? filteredEvents : undefined}
            highlightSequence={highlightSequence}
          />
        )}

        {showCollisionPanel && (
          <CollisionAlert
            alerts={collisionAlerts}
            onAcknowledge={handleAcknowledgeAlert}
            onAcknowledgeAll={handleAcknowledgeAllAlerts}
            visible={showCollisionPanel}
            onClose={() => setShowCollisionPanel(false)}
          />
        )}

        {showFileHeatmap && (
          <FileHeatmap
            visible={showFileHeatmap}
            onClose={() => setShowFileHeatmap(false)}
          />
        )}

        {showAnalytics && (
          <AnalyticsDashboard
            visible={showAnalytics}
            onClose={() => setShowAnalytics(false)}
          />
        )}

        {showDependencyDag && (
          <DependencyDag
            visible={showDependencyDag}
            onClose={() => setShowDependencyDag(false)}
          />
        )}

        {showRecoveryPanel && (
          <RecoveryPanel
            suggestions={recoverySuggestions}
            visible={showRecoveryPanel}
            onClose={() => setShowRecoveryPanel(false)}
          />
        )}

        {showFileContext && (
          <FileContextPanel
            visible={showFileContext}
            onClose={() => setShowFileContext(false)}
            events={filteredEvents}
            onOpenInEditor={(path, line) => {
              console.log(`Opening ${path}:${line || 1} in editor...`);
              // In a real implementation, this would trigger the editor
            }}
          />
        )}

        {showCostDashboard && (
          <CostDashboard
            visible={showCostDashboard}
            onClose={() => setShowCostDashboard(false)}
          />
        )}

        {showBudgetAlert && (
          <BudgetAlertPanel
            visible={showBudgetAlert}
            onClose={() => setShowBudgetAlert(false)}
          />
        )}

        {showErrorGroups && (
          <ErrorGroupPanel
            visible={showErrorGroups}
            onClose={() => setShowErrorGroups(false)}
          />
        )}

        {showSessionDigest && (
          <SessionDigestPanel
            visible={showSessionDigest}
            onClose={() => setShowSessionDigest(false)}
          />
        )}

        {showNarrative && (
          <SemanticNarrativePanel
            visible={showNarrative}
            onClose={() => setShowNarrative(false)}
          />
        )}

        {showGitIntegration && (
          <GitIntegrationPanel
            visible={showGitIntegration}
            onClose={() => setShowGitIntegration(false)}
          />
        )}

        {showProductivity && (
          <ProductivityPanel
            visible={showProductivity}
            onClose={() => setShowProductivity(false)}
          />
        )}

        {showHistoricalSessions && (
          <HistoricalSessionsPanel
            visible={showHistoricalSessions}
            onClose={() => setShowHistoricalSessions(false)}
          />
        )}

        {showWorkerAnalytics && (
          <WorkerAnalyticsPanel
            visible={showWorkerAnalytics}
            onClose={() => setShowWorkerAnalytics(false)}
          />
        )}

        {showSessionReplay && (
          <div className="session-replay-panel">
            <div className="session-replay-header">
              <h3>
                Session Replay
                {replayMetadata && (
                  <span className="replay-info">
                    {replayMetadata.eventCount || replayEvents.length} events | {replayMetadata.workerCount} workers
                  </span>
                )}
              </h3>
              <button
                className="close-button"
                onClick={() => {
                  setShowSessionReplay(false);
                  setReplayEvents([]);
                  setReplayMetadata(null);
                }}
              >
                ×
              </button>
            </div>
            {replayImportError && (
              <div className="replay-import-error">{replayImportError}</div>
            )}
            <SessionReplay
              events={replayEvents.length > 0 ? replayEvents : filteredEvents}
              onImport={(importedEvents, metadata) => {
                setReplayEvents(importedEvents);
                setReplayMetadata(metadata);
                setReplayImportError(null);
              }}
            />
          </div>
        )}

        {showSystemMemory && (
          <SystemMemoryPanel
            visible={showSystemMemory}
            onClose={() => setShowSystemMemory(false)}
          />
        )}
      </main>

      <CommandPalette
        visible={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onCommand={handleCommandExecute}
        workers={workers}
        events={events}
      />

      <Agentation
        onSubmit={(markdown) => {
          navigator.clipboard.writeText(markdown).catch(console.error);
        }}
      />
    </div>
  );
};

// Wrap with ThemeProvider for theme support
const AppWithTheme: React.FC = () => (
  <ThemeProvider>
    <App />
  </ThemeProvider>
);

export default AppWithTheme;

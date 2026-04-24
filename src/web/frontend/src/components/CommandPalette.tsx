import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { LogEvent, WorkerInfo } from '../types';
import { fuzzyMatch, getHighlightSegments } from '../utils/fuzzyMatch';

const MAX_RECENT = 10;
const RECENT_KEY = 'fabric-recent-commands';
const MAX_LOG_ENTRIES = 100;
const MAX_RESULTS = 50;

export interface CommandSuggestion {
  id: string;
  label: string;
  category: string;
  action: string;
  icon?: string;
  secondary?: string;
}

const DEFAULT_COMMANDS: CommandSuggestion[] = [
  // Filters
  { id: 'filter-worker', label: 'Filter by worker', category: 'Commands', action: 'filter:worker:', icon: '🔍' },
  { id: 'filter-level', label: 'Filter by level', category: 'Commands', action: 'filter:level:', icon: '🔍' },
  { id: 'filter-bead', label: 'Filter by bead', category: 'Commands', action: 'filter:bead:', icon: '🔍' },
  { id: 'filter-error', label: 'Show only errors', category: 'Commands', action: 'filter:level:error', icon: '❌' },
  { id: 'filter-warn', label: 'Show only warnings', category: 'Commands', action: 'filter:level:warn', icon: '⚠️' },
  { id: 'filter-info', label: 'Show info and above', category: 'Commands', action: 'filter:level:info', icon: 'ℹ️' },
  { id: 'clear-filters', label: 'Clear all filters', category: 'Commands', action: 'clear', icon: '✕' },
  // Views
  { id: 'show-heatmap', label: 'Show file heatmap', category: 'Commands', action: 'show:heatmap', icon: '🔥' },
  { id: 'show-dag', label: 'Show task dependency DAG', category: 'Commands', action: 'show:dag', icon: '🔗' },
  { id: 'show-analytics', label: 'Show fleet analytics', category: 'Commands', action: 'show:analytics', icon: '📈' },
  { id: 'show-recovery', label: 'Show recovery panel', category: 'Commands', action: 'show:recovery', icon: '💊' },
  { id: 'show-context', label: 'Show file context panel', category: 'Commands', action: 'show:filecontext', icon: '📄' },
  { id: 'show-timeline', label: 'Toggle timeline', category: 'Commands', action: 'show:timeline', icon: '📊' },
  { id: 'show-replay', label: 'Show session replay', category: 'Commands', action: 'show:replay', icon: '📼' },
  { id: 'show-cross-ref', label: 'Show cross-reference panel', category: 'Commands', action: 'show:crossref', icon: '🔀' },
  { id: 'show-cost', label: 'Show cost dashboard', category: 'Commands', action: 'show:cost', icon: '💰' },
  { id: 'show-budget', label: 'Show budget alerts', category: 'Commands', action: 'show:budget', icon: '%' },
  { id: 'show-errors', label: 'Show error groups', category: 'Commands', action: 'show:errors', icon: '🐛' },
  // Focus mode
  { id: 'focus-toggle', label: 'Toggle focus mode', category: 'Commands', action: 'focus:toggle', icon: '📌' },
  { id: 'focus-clear', label: 'Clear pinned items', category: 'Commands', action: 'focus:clear', icon: '📍' },
  { id: 'preset-save', label: 'Save focus preset', category: 'Commands', action: 'preset:save', icon: '💾' },
  { id: 'preset-list', label: 'List focus presets', category: 'Commands', action: 'preset:list', icon: '📋' },
  // Theme
  { id: 'theme-toggle', label: 'Toggle theme', category: 'Commands', action: 'theme:toggle', icon: '🎨' },
  { id: 'theme-dark', label: 'Dark theme', category: 'Commands', action: 'theme:dark', icon: '🌙' },
  { id: 'theme-light', label: 'Light theme', category: 'Commands', action: 'theme:light', icon: '☀️' },
  // Other
  { id: 'refresh', label: 'Refresh connection', category: 'Commands', action: 'refresh', icon: '🔄' },
];

interface ScoredEntry {
  suggestion: CommandSuggestion;
  score: number;
  labelIndices: number[];
}

/** A filtered entry carrying the label highlight indices through to render. */
interface FilteredEntry {
  suggestion: CommandSuggestion;
  labelIndices: number[];
}

export interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  onCommand: (action: string) => void;
  workers: WorkerInfo[];
  events: LogEvent[];
}

function loadRecentCommands(): string[] {
  try {
    const saved = localStorage.getItem(RECENT_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveRecentCommands(commands: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(commands));
  } catch {
    // ignore
  }
}

function formatEventTime(event: LogEvent): string {
  try {
    const ts = event.ts ?? new Date(event.timestamp).getTime();
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return event.timestamp.slice(11, 19) || '';
  }
}

function levelIcon(level: string): string {
  switch (level) {
    case 'error': return '❌';
    case 'warn': return '⚠️';
    case 'info': return 'ℹ️';
    default: return '·';
  }
}

/** Highlighted text segments rendered as React nodes */
function HighlightedText({ text, indices }: { text: string; indices: number[] }): React.ReactElement {
  const segments = getHighlightSegments(text, indices);
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight
          ? <mark key={i} className="cp-highlight">{seg.text}</mark>
          : <span key={i}>{seg.text}</span>
      )}
    </>
  );
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  visible,
  onClose,
  onCommand,
  workers,
  events,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>(loadRecentCommands);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Build dynamic suggestions from live state
  const dynamicSuggestions = useMemo<CommandSuggestion[]>(() => {
    const suggestions: CommandSuggestion[] = [];

    // Workers
    for (const w of workers) {
      suggestions.push({
        id: `worker-${w.id}`,
        label: w.id,
        category: 'Workers',
        action: `worker:${w.id}`,
        icon: w.status === 'active' ? '●' : '○',
        secondary: w.status,
      });
    }

    // Unique beads from events
    const beadsSeen = new Set<string>();
    for (const e of events) {
      if (e.bead && !beadsSeen.has(e.bead)) {
        beadsSeen.add(e.bead);
        suggestions.push({
          id: `bead-${e.bead}`,
          label: e.bead,
          category: 'Beads',
          action: `bead:${e.bead}`,
          icon: '📋',
          secondary: `${e.worker}`,
        });
      }
    }

    // Unique files from workers' activeFiles
    const filesSeen = new Set<string>();
    for (const w of workers) {
      for (const f of w.activeFiles ?? []) {
        if (!filesSeen.has(f)) {
          filesSeen.add(f);
          suggestions.push({
            id: `file-${f}`,
            label: f,
            category: 'Files',
            action: `file:${f}`,
            icon: '📄',
          });
        }
      }
    }

    return suggestions;
  }, [workers, events]);

  const allSuggestions = useMemo(
    () => [...DEFAULT_COMMANDS, ...dynamicSuggestions],
    [dynamicSuggestions],
  );

  // Returns entries with label highlight indices preserved for rendering.
  const filteredEntries = useMemo<FilteredEntry[]>(() => {
    const q = query.trim();

    if (!q) {
      // No query: recent commands first, then all — no highlight indices needed
      const recentSet = new Set(recentCommands);
      const recent = allSuggestions
        .filter(s => recentSet.has(s.action))
        .sort((a, b) => recentCommands.indexOf(a.action) - recentCommands.indexOf(b.action))
        .map(s => ({ suggestion: s, labelIndices: [] as number[] }));
      const rest = allSuggestions
        .filter(s => !recentSet.has(s.action))
        .map(s => ({ suggestion: s, labelIndices: [] as number[] }));
      return [...recent, ...rest].slice(0, MAX_RESULTS);
    }

    // Fuzzy-score commands and dynamic entries
    const scored: ScoredEntry[] = [];
    for (const s of allSuggestions) {
      const labelMatch = fuzzyMatch(s.label, q);
      const catMatch = fuzzyMatch(s.category, q);
      const actionMatch = fuzzyMatch(s.action, q);
      const secMatch = s.secondary ? fuzzyMatch(s.secondary, q) : null;

      let bestScore = -Infinity;
      let labelIndices: number[] = [];

      if (labelMatch) { bestScore = labelMatch.score; labelIndices = labelMatch.matchIndices; }
      if (catMatch && catMatch.score > bestScore) { bestScore = catMatch.score; labelIndices = []; }
      if (actionMatch && actionMatch.score > bestScore) { bestScore = actionMatch.score; labelIndices = []; }
      if (secMatch && secMatch.score > bestScore) { bestScore = secMatch.score; labelIndices = []; }

      if (bestScore > -Infinity) {
        const recentIdx = recentCommands.indexOf(s.action);
        if (recentIdx >= 0) bestScore += MAX_RECENT - recentIdx;
        scored.push({ suggestion: s, score: bestScore, labelIndices });
      }
    }

    // Also fuzzy-match recent log entries
    const recentEvents = events.slice(-MAX_LOG_ENTRIES);
    for (const e of recentEvents) {
      const msgMatch = fuzzyMatch(e.message, q);
      const workerMatch = fuzzyMatch(e.worker, q);

      let bestScore = -Infinity;
      let labelIndices: number[] = [];

      if (msgMatch) { bestScore = msgMatch.score; labelIndices = msgMatch.matchIndices; }
      if (workerMatch && workerMatch.score > bestScore) { bestScore = workerMatch.score; labelIndices = []; }

      if (bestScore > -Infinity) {
        const id = `log-${e.worker}-${e.timestamp}`;
        if (scored.some(x => x.suggestion.id === id)) continue; // dedupe
        scored.push({
          suggestion: {
            id,
            label: e.message,
            category: 'Log Entries',
            action: `log:${e.worker}`,
            icon: levelIcon(e.level),
            secondary: `${e.worker}  ${formatEventTime(e)}`,
          },
          score: bestScore - 5, // slight penalty vs commands
          labelIndices,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map(x => ({
      suggestion: x.suggestion,
      labelIndices: x.labelIndices,
    }));
  }, [query, allSuggestions, events, recentCommands]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredEntries]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Focus input when palette opens; reset query
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [visible]);

  const executeAction = useCallback((action: string) => {
    if (!action.startsWith('log:')) {
      const updated = [action, ...recentCommands.filter(c => c !== action)].slice(0, MAX_RECENT);
      setRecentCommands(updated);
      saveRecentCommands(updated);
    }
    onCommand(action);
    onClose();
  }, [recentCommands, onCommand, onClose]);

  const executeSelected = useCallback(() => {
    const item = filteredEntries[selectedIndex];
    if (item) executeAction(item.suggestion.action);
  }, [filteredEntries, selectedIndex, executeAction]);

  // Keyboard handling on the input
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredEntries.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        executeSelected();
        break;
      case 'k':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          onClose();
        }
        break;
    }
  }, [filteredEntries.length, executeSelected, onClose]);

  // Backdrop click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!visible) return null;

  // Group visible entries by category for rendering
  const grouped: { category: string; items: Array<{ entry: FilteredEntry; index: number }> }[] = [];
  let absoluteIndex = 0;
  const categorySeen = new Map<string, number>();

  for (const entry of filteredEntries) {
    const cat = entry.suggestion.category;
    let groupIdx = categorySeen.get(cat);
    if (groupIdx === undefined) {
      groupIdx = grouped.length;
      categorySeen.set(cat, groupIdx);
      grouped.push({ category: cat, items: [] });
    }
    grouped[groupIdx].items.push({ entry, index: absoluteIndex });
    absoluteIndex++;
  }

  return (
    <div className="cp-overlay" onClick={handleOverlayClick} role="dialog" aria-modal aria-label="Command Palette">
      <div className="cp-modal">
        <div className="cp-input-row">
          <span className="cp-search-icon">⌘</span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            placeholder="Search commands, workers, beads, files…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="cp-esc-hint">Esc</kbd>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="cp-empty">No results for &ldquo;{query}&rdquo;</div>
        ) : (
          <ul className="cp-list" ref={listRef} role="listbox">
            {grouped.map(group => (
              <React.Fragment key={group.category}>
                <li className="cp-category-header" role="presentation">{group.category}</li>
                {group.items.map(({ entry, index }) => {
                  const s = entry.suggestion;
                  return (
                    <li
                      key={s.id}
                      className={`cp-item${index === selectedIndex ? ' cp-item--selected' : ''}`}
                      role="option"
                      aria-selected={index === selectedIndex}
                      onClick={() => executeAction(s.action)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      {s.icon && <span className="cp-icon">{s.icon}</span>}
                      <span className="cp-label">
                        <HighlightedText text={s.label} indices={entry.labelIndices} />
                      </span>
                      {s.secondary && <span className="cp-secondary">{s.secondary}</span>}
                      <span className="cp-action-hint">{s.action}</span>
                    </li>
                  );
                })}
              </React.Fragment>
            ))}
          </ul>
        )}

        <div className="cp-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> execute</span>
          <span><kbd>Esc</kbd> close</span>
          <span className="cp-footer-hint">Cmd+K / Ctrl+K to toggle</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;

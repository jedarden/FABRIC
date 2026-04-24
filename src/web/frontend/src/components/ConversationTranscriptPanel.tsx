import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ConversationTurn } from '../types';

interface ConversationTranscriptPanelProps {
  turns: ConversationTurn[];
  onJumpToTurn?: (turnId: string) => void;
  highlightSequence?: number | null;
}

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  system:    { bg: 'var(--bg-tertiary)',    text: 'var(--text-secondary)', border: 'var(--bg-tertiary)' },
  user:      { bg: 'rgba(33,150,243,0.15)', text: 'var(--info)',           border: 'var(--info)' },
  assistant: { bg: 'rgba(0,200,83,0.12)',   text: 'var(--success)',        border: 'var(--success)' },
  tool:      { bg: 'rgba(255,193,7,0.1)',   text: 'var(--warning)',        border: 'var(--warning)' },
};

const ROLE_LABELS: Record<string, string> = {
  system: 'SYSTEM',
  user: 'USER',
  assistant: 'ASSISTANT',
  tool: 'TOOL',
};

const ConversationTranscriptPanel: React.FC<ConversationTranscriptPanelProps> = ({
  turns,
  onJumpToTurn,
  highlightSequence,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    turns.forEach(t => { if (t.isCollapsible && t.isCollapsed) initial.add(t.id); });
    return initial;
  });
  const [searchResultIndices, setSearchResultIndices] = useState<number[]>([]);
  const [currentSearchIdx, setCurrentSearchIdx] = useState(-1);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const turnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Update collapsed state when turns change
  useEffect(() => {
    setCollapsedIds(prev => {
      const next = new Set<string>();
      turns.forEach(t => {
        if (t.isCollapsible && (prev.has(t.id) || t.isCollapsed)) next.add(t.id);
      });
      return next;
    });
  }, [turns]);

  const filteredTurns = useMemo(() => {
    if (!searchQuery.trim()) return turns;
    const q = searchQuery.toLowerCase();
    return turns.filter(t =>
      t.content.toLowerCase().includes(q) ||
      t.eventType.toLowerCase().includes(q) ||
      (t.tool && t.tool.toLowerCase().includes(q))
    );
  }, [turns, searchQuery]);

  // Search result indices map into filteredTurns
  const searchHits = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const hits: number[] = [];
    filteredTurns.forEach((t, i) => {
      if (
        t.content.toLowerCase().includes(q) ||
        t.eventType.toLowerCase().includes(q) ||
        (t.tool && t.tool.toLowerCase().includes(q))
      ) {
        hits.push(i);
      }
    });
    return hits;
  }, [filteredTurns, searchQuery]);

  useEffect(() => {
    setSearchResultIndices(searchHits);
    setCurrentSearchIdx(searchHits.length > 0 ? 0 : -1);
  }, [searchHits]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedIds(new Set(turns.filter(t => t.isCollapsible).map(t => t.id)));
  }, [turns]);

  const expandAll = useCallback(() => {
    setCollapsedIds(new Set());
  }, []);

  const scrollToTurn = useCallback((index: number) => {
    if (index < 0 || index >= filteredTurns.length) return;
    const turn = filteredTurns[index];
    const el = turnRefs.current.get(turn.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (onJumpToTurn) onJumpToTurn(turn.id);
  }, [filteredTurns, onJumpToTurn]);

  const nextSearchResult = useCallback(() => {
    if (searchResultIndices.length === 0) return;
    const next = (currentSearchIdx + 1) % searchResultIndices.length;
    setCurrentSearchIdx(next);
    scrollToTurn(searchResultIndices[next]);
  }, [searchResultIndices, currentSearchIdx, scrollToTurn]);

  const prevSearchResult = useCallback(() => {
    if (searchResultIndices.length === 0) return;
    const prev = (currentSearchIdx - 1 + searchResultIndices.length) % searchResultIndices.length;
    setCurrentSearchIdx(prev);
    scrollToTurn(searchResultIndices[prev]);
  }, [searchResultIndices, currentSearchIdx, scrollToTurn]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (searchActive) {
        if (e.key === 'Escape') {
          setSearchActive(false);
          setSearchQuery('');
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) prevSearchResult();
          else nextSearchResult();
        }
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setSearchActive(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) nextSearchResult();
      if (e.key === 'N' && e.shiftKey) prevSearchResult();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchActive, nextSearchResult, prevSearchResult]);

  // Scroll to first search result
  useEffect(() => {
    if (searchResultIndices.length > 0 && currentSearchIdx >= 0) {
      scrollToTurn(searchResultIndices[currentSearchIdx]);
    }
  }, [searchResultIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to turn highlighted from activity stream
  useEffect(() => {
    if (highlightSequence == null) {
      setHighlightedTurnId(null);
      return;
    }
    const turn = turns.find(t => t.sequence === highlightSequence);
    if (turn) {
      setHighlightedTurnId(turn.id);
      const el = turnRefs.current.get(turn.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      // Clear highlight after 3s
      const timer = setTimeout(() => setHighlightedTurnId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightSequence, turns]);

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="conversation-transcript">
      {/* Toolbar */}
      <div className="conversation-toolbar">
        <span className="conversation-turn-count">
          {filteredTurns.length} turn{filteredTurns.length !== 1 ? 's' : ''}
        </span>
        <div className="conversation-toolbar-actions">
          <button
            className="conversation-toolbar-btn"
            onClick={() => { setSearchActive(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
            title="Search ( / )"
          >
            Search
          </button>
          <button className="conversation-toolbar-btn" onClick={collapseAll} title="Collapse all tool calls">
            Collapse
          </button>
          <button className="conversation-toolbar-btn" onClick={expandAll} title="Expand all tool calls">
            Expand
          </button>
        </div>
      </div>

      {/* Search bar */}
      {searchActive && (
        <div className="conversation-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="conversation-search-input"
            placeholder="Search turns..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <span className="conversation-search-results">
              {searchResultIndices.length === 0
                ? 'No results'
                : `${currentSearchIdx + 1}/${searchResultIndices.length}`}
            </span>
          )}
          <button className="conversation-search-nav" onClick={prevSearchResult} title="Previous (Shift+Enter)">&#8593;</button>
          <button className="conversation-search-nav" onClick={nextSearchResult} title="Next (Enter)">&#8595;</button>
          <button
            className="conversation-search-close"
            onClick={() => { setSearchActive(false); setSearchQuery(''); }}
            title="Close (Esc)"
          >
            Esc
          </button>
        </div>
      )}

      {/* Turn list */}
      <div className="conversation-turn-list">
        {filteredTurns.length === 0 ? (
          <div className="conversation-empty">
            {turns.length === 0 ? 'No conversation events' : 'No matching turns'}
          </div>
        ) : (
          filteredTurns.map((turn, idx) => {
            const isCollapsed = collapsedIds.has(turn.id);
            const isSearchHit = searchResultIndices.includes(idx);
            const isCurrentHit = searchResultIndices[currentSearchIdx] === idx;
            const colors = ROLE_COLORS[turn.role] || ROLE_COLORS.system;

            return (
              <div
                key={turn.id}
                ref={el => { if (el) turnRefs.current.set(turn.id, el); }}
                className={[
                  'conversation-turn',
                  `conversation-turn-${turn.role}`,
                  isSearchHit ? 'conversation-turn-search-hit' : '',
                  isCurrentHit ? 'conversation-turn-current-hit' : '',
                  highlightedTurnId === turn.id ? 'conversation-turn-activity-highlight' : '',
                ].filter(Boolean).join(' ')}
                style={{ borderLeftColor: colors.border }}
              >
                {/* Turn header */}
                <div
                  className="conversation-turn-header"
                  onClick={turn.isCollapsible ? () => toggleCollapse(turn.id) : undefined}
                  style={{ cursor: turn.isCollapsible ? 'pointer' : 'default' }}
                >
                  <span className="conversation-turn-role" style={{ color: colors.text }}>
                    {ROLE_LABELS[turn.role]}
                  </span>
                  {turn.tool && (
                    <span className="conversation-turn-tool">{turn.tool}</span>
                  )}
                  <span className="conversation-turn-event">{turn.eventType}</span>
                  <span className="conversation-turn-time">{formatTime(turn.timestamp)}</span>
                  {turn.durationMs != null && (
                    <span className="conversation-turn-duration">{formatDuration(turn.durationMs)}</span>
                  )}
                  {turn.error && (
                    <span className="conversation-turn-error-badge">ERROR</span>
                  )}
                  {turn.isCollapsible && (
                    <span className="conversation-turn-collapse-icon">
                      {isCollapsed ? '[+]' : '[-]'}
                    </span>
                  )}
                </div>

                {/* Turn content */}
                {(!turn.isCollapsible || !isCollapsed) && (
                  <div className="conversation-turn-content">
                    {turn.role === 'tool' && !isCollapsed ? (
                      <pre className="conversation-turn-code">
                        {highlightText(turn.content, searchQuery)}
                      </pre>
                    ) : (
                      <div className="conversation-turn-text">
                        {highlightText(turn.content, searchQuery)}
                      </div>
                    )}
                    {turn.error && (
                      <div className="conversation-turn-error">{turn.error}</div>
                    )}
                    {turn.meta && Object.keys(turn.meta).length > 0 && (
                      <div className="conversation-turn-meta">
                        {turn.meta.bead && <span>bead: {String(turn.meta.bead)}</span>}
                        {turn.meta.path && <span>path: {String(turn.meta.path)}</span>}
                        {turn.meta.model && <span>model: {String(turn.meta.model)}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ConversationTranscriptPanel;

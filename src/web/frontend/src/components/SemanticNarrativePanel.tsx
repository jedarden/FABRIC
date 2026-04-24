import React, { useState, useEffect, useCallback } from 'react';
import {
  SemanticNarrativeView,
  NarrativeSegmentView,
  EventPattern,
  NarrativeSentiment,
} from '../types';

// ── Phase mapping ──────────────────────────────────────────

const PATTERN_TO_PHASE: Record<EventPattern, string> = {
  investigation: 'Research',
  research: 'Research',
  exploration: 'Research',
  planning: 'Planning',
  file_editing: 'Implementation',
  file_created: 'Implementation',
  iteration: 'Implementation',
  tool_usage: 'Implementation',
  testing: 'Testing',
  debugging: 'Debugging',
  error_handling: 'Debugging',
  error_recovery: 'Debugging',
  bead_completed: 'Finalizing',
  task_completion: 'Finalizing',
  git_operations: 'Finalizing',
  dependency_install: 'Implementation',
  bead_started: 'Implementation',
  collision_detected: 'Debugging',
};

const PHASE_COLORS: Record<string, string> = {
  Research: '#2196f3',
  Planning: '#ffc107',
  Implementation: '#00c853',
  Testing: '#9c27b0',
  Debugging: '#f44336',
  Finalizing: '#00bcd4',
};

const SENTIMENT_ICONS: Record<NarrativeSentiment, string> = {
  productive: '✓',
  struggling: '!',
  mixed: '~',
  idle: '○',
};

const SENTIMENT_COLORS: Record<NarrativeSentiment, string> = {
  productive: 'var(--success)',
  struggling: 'var(--error)',
  mixed: 'var(--warning)',
  idle: 'var(--text-secondary)',
};

// ── Helpers ────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rm = minutes % 60;
  return rm > 0 ? `${hours}h ${rm}m` : `${hours}h`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function detectPhase(segments: NarrativeSegmentView[]): string | null {
  const active = segments.filter(s => s.isActive);
  if (active.length > 0) {
    return PATTERN_TO_PHASE[active[active.length - 1].pattern] || 'Implementation';
  }
  if (segments.length > 0) {
    return PATTERN_TO_PHASE[segments[segments.length - 1].pattern] || 'Implementation';
  }
  return null;
}

interface PhaseSlice {
  phase: string;
  percent: number;
}

function getPhaseProgress(segments: NarrativeSegmentView[]): PhaseSlice[] {
  const phases = ['Research', 'Planning', 'Implementation', 'Testing', 'Debugging', 'Finalizing'];
  const total = segments.reduce((sum, s) => sum + s.durationMs, 0);
  if (total === 0) return phases.map(phase => ({ phase, percent: 0 }));

  const durations: Record<string, number> = {};
  for (const p of phases) durations[p] = 0;
  for (const seg of segments) {
    const p = PATTERN_TO_PHASE[seg.pattern] || 'Implementation';
    durations[p] = (durations[p] || 0) + seg.durationMs;
  }

  return phases.map(phase => ({
    phase,
    percent: Math.round((durations[phase] / total) * 100),
  }));
}

// ── Inline worker narrative (used in WorkerDetail tab) ─────

interface WorkerNarrativeInlineProps {
  workerId: string;
}

const WorkerNarrativeInline: React.FC<WorkerNarrativeInlineProps> = ({ workerId }) => {
  const [narrative, setNarrative] = useState<SemanticNarrativeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);

  const fetchNarrative = useCallback(async () => {
    try {
      const res = await fetch(`/api/narrative/${encodeURIComponent(workerId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SemanticNarrativeView = await res.json();
      setNarrative(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    setLoading(true);
    fetchNarrative();
    const interval = setInterval(fetchNarrative, 10000);
    return () => clearInterval(interval);
  }, [fetchNarrative]);

  if (loading) return <div className="narrative-inline-loading">Loading narrative...</div>;
  if (error) return <div className="narrative-inline-error">{error}</div>;
  if (!narrative || narrative.segments.length === 0) {
    return <div className="narrative-inline-empty">Not enough events to generate a narrative.</div>;
  }

  const currentPhase = detectPhase(narrative.segments);
  const phaseProgress = getPhaseProgress(narrative.segments);

  return (
    <div className="narrative-inline">
      {/* Phase badge + sentiment */}
      <div className="narrative-inline-header">
        {currentPhase && (
          <span
            className="narrative-phase-badge"
            style={{ backgroundColor: PHASE_COLORS[currentPhase] }}
          >
            {currentPhase}
          </span>
        )}
        <span
          className="narrative-sentiment"
          style={{ color: SENTIMENT_COLORS[narrative.sentiment] }}
        >
          {SENTIMENT_ICONS[narrative.sentiment]}
        </span>
        <span className="narrative-inline-stats">
          {formatDuration(narrative.durationMs)} &middot; {narrative.stats.totalEvents} events
        </span>
      </div>

      {/* Phase progress bar */}
      <div className="narrative-phase-progress">
        {phaseProgress.map(({ phase, percent }) =>
          percent > 0 ? (
            <div
              key={phase}
              className="narrative-phase-segment"
              style={{ width: `${percent}%`, backgroundColor: PHASE_COLORS[phase] }}
              title={`${phase}: ${percent}%`}
            />
          ) : null,
        )}
      </div>

      {/* Summary */}
      <p className="narrative-inline-summary">{narrative.summary}</p>

      {/* Accomplishments & Challenges */}
      {narrative.accomplishments.length > 0 && (
        <div className="narrative-inline-section">
          <h4>Accomplishments</h4>
          <ul>
            {narrative.accomplishments.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {narrative.challenges.length > 0 && (
        <div className="narrative-inline-section">
          <h4>Challenges</h4>
          <ul>
            {narrative.challenges.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* Segments */}
      <div className="narrative-inline-section">
        <h4>Activity Segments</h4>
        <div className="narrative-segments">
          {narrative.segments.map(seg => {
            const isOpen = expandedSegment === seg.id;
            const phase = PATTERN_TO_PHASE[seg.pattern] || 'Implementation';
            return (
              <div key={seg.id} className={`narrative-segment ${seg.isActive ? 'active' : ''} ${isOpen ? 'expanded' : ''}`}>
                <div
                  className="narrative-segment-header"
                  onClick={() => setExpandedSegment(isOpen ? null : seg.id)}
                >
                  <span className="narrative-segment-icon" style={{ color: PHASE_COLORS[phase] }}>
                    {phase.charAt(0)}
                  </span>
                  <span className="narrative-segment-summary">{seg.summary}</span>
                  <span className="narrative-segment-duration">{formatDuration(seg.durationMs)}</span>
                  {seg.isActive && <span className="narrative-active-dot" />}
                </div>
                {isOpen && (
                  <div className="narrative-segment-detail">
                    <div className="narrative-segment-meta">
                      <span>{formatTime(seg.startTime)} &mdash; {formatTime(seg.endTime)}</span>
                      <span>{seg.eventCount} events</span>
                    </div>
                    {seg.entities.files && seg.entities.files.length > 0 && (
                      <div className="narrative-entities">
                        <span className="narrative-entity-label">Files:</span>
                        {seg.entities.files.slice(0, 5).map((f, i) => (
                          <span key={i} className="narrative-entity-tag">{f.split('/').pop()}</span>
                        ))}
                        {seg.entities.files.length > 5 && (
                          <span className="narrative-entity-more">+{seg.entities.files.length - 5}</span>
                        )}
                      </div>
                    )}
                    {seg.entities.tools && seg.entities.tools.length > 0 && (
                      <div className="narrative-entities">
                        <span className="narrative-entity-label">Tools:</span>
                        {seg.entities.tools.map((t, i) => (
                          <span key={i} className="narrative-entity-tag">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Full narrative text */}
      {narrative.fullNarrative && (
        <div className="narrative-inline-section">
          <h4>Narrative</h4>
          <p className="narrative-full-text">{narrative.fullNarrative}</p>
        </div>
      )}
    </div>
  );
};

export { WorkerNarrativeInline };

// ── Standalone panel (toggled from header) ─────────────────

interface SemanticNarrativePanelProps {
  visible: boolean;
  onClose: () => void;
}

const SemanticNarrativePanel: React.FC<SemanticNarrativePanelProps> = ({ visible, onClose }) => {
  const [narratives, setNarratives] = useState<SemanticNarrativeView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);

  const fetchNarratives = useCallback(async () => {
    if (!visible) return;
    try {
      const res = await fetch('/api/narrative');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNarratives(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch narratives');
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchNarratives();
    const interval = setInterval(fetchNarratives, 10000);
    return () => clearInterval(interval);
  }, [visible, fetchNarratives]);

  if (!visible) return null;

  return (
    <div className="narrative-panel">
      <div className="narrative-panel-header">
        <h3>Semantic Narrative</h3>
        <div className="narrative-panel-actions">
          <button className="narrative-refresh-btn" onClick={fetchNarratives} title="Refresh">
            ↻
          </button>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="narrative-panel-content">
        {loading && narratives.length === 0 && (
          <div className="narrative-loading">Loading narratives...</div>
        )}
        {error && <div className="narrative-error">{error}</div>}
        {!loading && !error && narratives.length === 0 && (
          <div className="narrative-empty">No active workers to narrate.</div>
        )}

        {narratives.map(narrative => {
          const currentPhase = detectPhase(narrative.segments);
          const phaseProgress = getPhaseProgress(narrative.segments);
          const isExpanded = expandedWorker === narrative.workerId;

          return (
            <div key={narrative.id} className={`narrative-card ${isExpanded ? 'expanded' : ''}`}>
              <div
                className="narrative-card-header"
                onClick={() => setExpandedWorker(isExpanded ? null : narrative.workerId)}
              >
                <div className="narrative-card-title-row">
                  <span className="narrative-worker-id">{narrative.workerId}</span>
                  {currentPhase && (
                    <span
                      className="narrative-phase-badge"
                      style={{ backgroundColor: PHASE_COLORS[currentPhase] }}
                    >
                      {currentPhase}
                    </span>
                  )}
                  <span
                    className="narrative-sentiment"
                    style={{ color: SENTIMENT_COLORS[narrative.sentiment] }}
                    title={`Sentiment: ${narrative.sentiment}`}
                  >
                    {SENTIMENT_ICONS[narrative.sentiment]}
                  </span>
                </div>
                <p className="narrative-summary">{narrative.summary}</p>
                <div className="narrative-stats-row">
                  <span>{formatDuration(narrative.durationMs)}</span>
                  <span>{narrative.stats.totalEvents} events</span>
                  <span>{narrative.stats.segmentCount} segments</span>
                  {narrative.stats.errorsEncountered > 0 && (
                    <span className="narrative-error-count">
                      {narrative.stats.errorsEncountered} errors
                    </span>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="narrative-card-body">
                  {/* Phase progress bar */}
                  <div className="narrative-phase-progress">
                    {phaseProgress.map(({ phase, percent }) =>
                      percent > 0 ? (
                        <div
                          key={phase}
                          className="narrative-phase-segment"
                          style={{ width: `${percent}%`, backgroundColor: PHASE_COLORS[phase] }}
                          title={`${phase}: ${percent}%`}
                        />
                      ) : null,
                    )}
                  </div>
                  <div className="narrative-phase-labels">
                    {phaseProgress
                      .filter(p => p.percent > 0)
                      .map(({ phase, percent }) => (
                        <span key={phase} style={{ color: PHASE_COLORS[phase] }}>
                          {phase} {percent}%
                        </span>
                      ))}
                  </div>

                  {/* Accomplishments */}
                  {narrative.accomplishments.length > 0 && (
                    <div className="narrative-section">
                      <h4>Accomplishments</h4>
                      <ul>
                        {narrative.accomplishments.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Challenges */}
                  {narrative.challenges.length > 0 && (
                    <div className="narrative-section">
                      <h4>Challenges</h4>
                      <ul>
                        {narrative.challenges.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Segments timeline */}
                  <div className="narrative-section">
                    <h4>Activity Segments</h4>
                    <div className="narrative-segments">
                      {narrative.segments.map(seg => {
                        const isOpen = expandedSegment === seg.id;
                        const phase = PATTERN_TO_PHASE[seg.pattern] || 'Implementation';
                        return (
                          <div
                            key={seg.id}
                            className={`narrative-segment ${seg.isActive ? 'active' : ''} ${isOpen ? 'expanded' : ''}`}
                          >
                            <div
                              className="narrative-segment-header"
                              onClick={() => setExpandedSegment(isOpen ? null : seg.id)}
                            >
                              <span
                                className="narrative-segment-icon"
                                style={{ color: PHASE_COLORS[phase] }}
                              >
                                {phase.charAt(0)}
                              </span>
                              <span className="narrative-segment-summary">{seg.summary}</span>
                              <span className="narrative-segment-duration">
                                {formatDuration(seg.durationMs)}
                              </span>
                              <span className="narrative-segment-confidence">
                                {Math.round(seg.confidence * 100)}%
                              </span>
                              {seg.isActive && <span className="narrative-active-dot" />}
                            </div>

                            {isOpen && (
                              <div className="narrative-segment-detail">
                                <div className="narrative-segment-meta">
                                  <span>
                                    {formatTime(seg.startTime)} &mdash; {formatTime(seg.endTime)}
                                  </span>
                                  <span>{seg.eventCount} events</span>
                                </div>
                                {seg.details && (
                                  <p className="narrative-segment-details-text">{seg.details}</p>
                                )}
                                {seg.entities.files && seg.entities.files.length > 0 && (
                                  <div className="narrative-entities">
                                    <span className="narrative-entity-label">Files:</span>
                                    {seg.entities.files.slice(0, 5).map((f, i) => (
                                      <span key={i} className="narrative-entity-tag">
                                        {f.split('/').pop()}
                                      </span>
                                    ))}
                                    {seg.entities.files.length > 5 && (
                                      <span className="narrative-entity-more">
                                        +{seg.entities.files.length - 5}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {seg.entities.tools && seg.entities.tools.length > 0 && (
                                  <div className="narrative-entities">
                                    <span className="narrative-entity-label">Tools:</span>
                                    {seg.entities.tools.map((t, i) => (
                                      <span key={i} className="narrative-entity-tag">{t}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Full narrative */}
                  {narrative.fullNarrative && (
                    <div className="narrative-section">
                      <h4>Narrative</h4>
                      <p className="narrative-full-text">{narrative.fullNarrative}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SemanticNarrativePanel;

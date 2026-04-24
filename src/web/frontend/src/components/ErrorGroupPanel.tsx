import React, { useState, useEffect, useCallback } from 'react';
import {
  ErrorGroupCard,
  ErrorGroupStats,
  ErrorCategory,
  SimilarError,
} from '../types';

interface ErrorGroupPanelProps {
  visible: boolean;
  onClose: () => void;
}

type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

const SEVERITY_ORDER: SeverityLevel[] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_LABELS: Record<SeverityLevel, { icon: string; label: string }> = {
  critical: { icon: '!!!', label: 'CRITICAL' },
  high: { icon: '!!', label: 'HIGH' },
  medium: { icon: '!', label: 'MEDIUM' },
  low: { icon: 'i', label: 'LOW' },
};

const CATEGORY_ICONS: Record<ErrorCategory, string> = {
  network: '⚡',
  permission: '🔒',
  validation: '✗',
  resource: '💾',
  not_found: '?',
  timeout: '⏱',
  syntax: '⚠',
  tool: '🔧',
  unknown: '•',
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function formatTimeSpan(firstSeen: number, lastSeen: number): string {
  const diff = lastSeen - firstSeen;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

const ErrorGroupPanel: React.FC<ErrorGroupPanelProps> = ({ visible, onClose }) => {
  const [groups, setGroups] = useState<ErrorGroupCard[]>([]);
  const [stats, setStats] = useState<ErrorGroupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [similarErrors, setSimilarErrors] = useState<SimilarError[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ activeOnly: String(activeOnly) });
      const [groupsRes, statsRes] = await Promise.all([
        fetch(`/api/errors/groups?${params}`),
        fetch('/api/errors/stats'),
      ]);
      if (!groupsRes.ok || !statsRes.ok) {
        throw new Error('Failed to fetch error group data');
      }
      setGroups(await groupsRes.json());
      setStats(await statsRes.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    if (visible) {
      fetchGroups();
      const interval = setInterval(fetchGroups, 10000);
      return () => clearInterval(interval);
    }
  }, [visible, fetchGroups]);

  const fetchSimilar = useCallback(async (message: string) => {
    try {
      setLoadingSimilar(true);
      const res = await fetch(`/api/errors/history/similar?message=${encodeURIComponent(message)}&limit=5`);
      if (res.ok) {
        setSimilarErrors(await res.json());
      }
    } catch {
      setSimilarErrors([]);
    } finally {
      setLoadingSimilar(false);
    }
  }, []);

  const toggleExpand = useCallback((groupId: string, group: ErrorGroupCard) => {
    if (expandedId === groupId) {
      setExpandedId(null);
      setSimilarErrors([]);
    } else {
      setExpandedId(groupId);
      fetchSimilar(group.fingerprint.sampleMessage);
    }
  }, [expandedId, fetchSimilar]);

  if (!visible) return null;

  const groupedBySeverity: Record<SeverityLevel, ErrorGroupCard[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const g of groups) {
    groupedBySeverity[g.severity].push(g);
  }

  return (
    <div className="error-group-panel">
      <div className="error-group-header">
        <h3>
          Error Groups
          {stats && (
            <span className="error-group-stats">
              {stats.totalGroups} groups | {stats.activeGroups} active | {stats.totalErrors} total
            </span>
          )}
        </h3>
        <div className="error-group-actions">
          <button
            className={`error-group-filter-btn ${activeOnly ? 'active' : ''}`}
            onClick={() => setActiveOnly(v => !v)}
            title="Show active errors only"
          >
            Active only
          </button>
          <button className="error-group-refresh" onClick={fetchGroups} title="Refresh">
            Refresh
          </button>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
      </div>

      {loading && groups.length === 0 && (
        <div className="error-group-loading">Loading error groups...</div>
      )}
      {error && (
        <div className="error-group-error">Failed to load: {error}</div>
      )}
      {!loading && groups.length === 0 && (
        <div className="error-group-empty">No errors detected</div>
      )}

      <div className="error-group-list">
        {SEVERITY_ORDER.map(sev => {
          const items = groupedBySeverity[sev];
          if (items.length === 0) return null;
          const meta = SEVERITY_LABELS[sev];
          return (
            <div key={sev} className={`error-group-severity severity-${sev}`}>
              <div className={`severity-header severity-${sev}-header`}>
                {meta.icon} {meta.label} ({items.length})
              </div>
              {items.map(group => {
                const isExpanded = expandedId === group.id;
                const workers = group.affectedWorkers.length > 2
                  ? `${group.affectedWorkers.length}w`
                  : group.affectedWorkers.join(', ');
                return (
                  <div
                    key={group.id}
                    className={`error-group-card ${isExpanded ? 'expanded' : ''} ${group.isActive ? 'active' : 'inactive'}`}
                  >
                    <div
                      className="error-group-summary"
                      onClick={() => toggleExpand(group.id, group)}
                    >
                      <span className="expand-marker">{isExpanded ? '▼' : '▶'}</span>
                      <span className={`active-marker ${group.isActive ? 'is-active' : ''}`}>
                        {group.isActive ? '●' : '○'}
                      </span>
                      <span className={`severity-badge severity-${sev}`}>{meta.icon}</span>
                      <span className="category-icon">{CATEGORY_ICONS[group.fingerprint.category]}</span>
                      <span className="error-count">x{group.count}</span>
                      <span className="error-last-seen">{formatRelativeTime(group.lastSeen)}</span>
                      <span className="error-workers">{workers}</span>
                      <span className="error-signature" title={group.fingerprint.signature}>
                        {group.fingerprint.signature.slice(0, 60)}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="error-group-details">
                        <div className="detail-grid">
                          <div className="detail-item">
                            <span className="detail-label">Category</span>
                            <span className="detail-value">{group.fingerprint.category}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Severity</span>
                            <span className={`detail-value severity-${sev}`}>{group.severity}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Occurrences</span>
                            <span className="detail-value">{group.count}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Status</span>
                            <span className={`detail-value ${group.isActive ? 'active-text' : 'inactive-text'}`}>
                              {group.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">First Seen</span>
                            <span className="detail-value">{new Date(group.firstSeen).toISOString()}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Last Seen</span>
                            <span className="detail-value">{new Date(group.lastSeen).toISOString()} ({formatRelativeTime(group.lastSeen)})</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Time Span</span>
                            <span className="detail-value">{formatTimeSpan(group.firstSeen, group.lastSeen)}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Workers</span>
                            <span className="detail-value">{group.affectedWorkers.join(', ')}</span>
                          </div>
                        </div>

                        <div className="detail-section">
                          <h4>Signature</h4>
                          <code className="error-signature-full">{group.fingerprint.signature}</code>
                        </div>

                        <div className="detail-section">
                          <h4>Sample Message</h4>
                          <pre className="error-sample-message">{group.fingerprint.sampleMessage.split('\n')[0]}</pre>
                        </div>

                        {group.recentEvents.length > 0 && (
                          <div className="detail-section">
                            <h4>Recent Events ({group.recentEvents.length})</h4>
                            <div className="error-recent-events">
                              {group.recentEvents.map((evt, i) => {
                                const ts = evt.ts
                                  ? new Date(evt.ts).toISOString().substring(11, 19)
                                  : evt.timestamp.substring(11, 19);
                                const msg = (evt.error || evt.message).split('\n')[0].slice(0, 100);
                                return (
                                  <div key={i} className="error-recent-event">
                                    <span className="evt-time">{ts}</span>
                                    <span className="evt-worker">[{evt.worker}]</span>
                                    <span className="evt-msg">{msg}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {group.sampleStack && (
                          <div className="detail-section">
                            <h4>Stack Trace</h4>
                            <pre className="error-stack-trace">
                              {group.sampleStack.split('\n').slice(0, 15).join('\n')}
                              {group.sampleStack.split('\n').length > 15 && (
                                <span className="stack-truncated">
                                  {'\n'}... ({group.sampleStack.split('\n').length - 15} more lines)
                                </span>
                              )}
                            </pre>
                          </div>
                        )}

                        {/* Similar Past Errors */}
                        <div className="detail-section">
                          <h4>
                            Similar Past Errors
                            {loadingSimilar && <span className="loading-spinner">...</span>}
                          </h4>
                          {similarErrors.length === 0 && !loadingSimilar && (
                            <div className="no-similar">No similar past errors found</div>
                          )}
                          {similarErrors.length > 0 && (
                            <div className="similar-errors-list">
                              {similarErrors.map(se => (
                                <div key={se.id} className="similar-error-card">
                                  <div className="similar-error-header">
                                    <span className={`similar-error-type cat-${se.error_type}`}>
                                      {CATEGORY_ICONS[se.error_type as ErrorCategory] || '•'} {se.error_type}
                                    </span>
                                    <span className="similar-error-time">
                                      {new Date(se.timestamp).toLocaleDateString()}
                                    </span>
                                    <span className="similar-error-similarity">
                                      {(se.similarity * 100).toFixed(0)}% match
                                    </span>
                                    {se.resolution_successful !== null && (
                                      <span className={`similar-error-resolution ${se.resolution_successful ? 'resolved' : 'failed'}`}>
                                        {se.resolution_successful ? 'Resolved' : 'Unresolved'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="similar-error-message" title={se.error_message}>
                                    {se.error_message.split('\n')[0].slice(0, 120)}
                                  </div>
                                  {se.resolution && (
                                    <div className="similar-error-resolution-text">
                                      Resolution: {se.resolution}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ErrorGroupPanel;

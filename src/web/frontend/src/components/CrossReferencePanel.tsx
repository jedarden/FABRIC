import React, { useState, useEffect, useCallback } from 'react';
import {
  CrossReferenceLink,
  CrossReferenceEntity,
  CrossReferenceStats,
  CrossReferenceEntityType,
  CrossReferenceRelationship,
  CrossReferencePath,
} from '../types';

interface CrossReferencePanelProps {
  selectedWorker?: string | null;
  selectedBead?: string | null;
  selectedFile?: string | null;
  onNavigate?: (type: CrossReferenceEntityType, id: string) => void;
}

const RELATIONSHIP_CONFIG: Record<CrossReferenceRelationship, { label: string; color: string }> = {
  same_bead: { label: 'Same Task', color: '#9333ea' },
  same_file: { label: 'Same File', color: '#0891b2' },
  same_worker: { label: 'Same Worker', color: '#16a34a' },
  temporal_proximity: { label: 'Time Proximity', color: '#ca8a04' },
  same_session: { label: 'Same Session', color: '#2563eb' },
  dependency: { label: 'Dependency', color: '#ea580c' },
  collision: { label: 'Collision', color: '#dc2626' },
  parent_child: { label: 'Parent/Child', color: '#7c3aed' },
  error_related: { label: 'Error Related', color: '#dc2626' },
  tool_sequence: { label: 'Tool Sequence', color: '#0d9488' },
};

const ENTITY_COLORS: Record<CrossReferenceEntityType, string> = {
  event: '#fbbf24',
  worker: '#16a34a',
  file: '#0891b2',
  bead: '#9333ea',
  session: '#2563eb',
};

const CrossReferencePanel: React.FC<CrossReferencePanelProps> = ({
  selectedWorker,
  selectedBead,
  selectedFile,
  onNavigate,
}) => {
  const [stats, setStats] = useState<CrossReferenceStats | null>(null);
  const [links, setLinks] = useState<CrossReferenceLink[]>([]);
  const [currentEntity, setCurrentEntity] = useState<CrossReferenceEntity | null>(null);
  const [viewMode, setViewMode] = useState<'stats' | 'links' | 'entity'>('stats');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathResult, setPathResult] = useState<CrossReferencePath | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/xref/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    }
  }, []);

  const fetchLinks = useCallback(async (
    sourceType?: CrossReferenceEntityType,
    sourceId?: string
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sourceType) params.set('sourceType', sourceType);
      if (sourceId) params.set('sourceId', sourceId);
      params.set('limit', '50');

      const response = await fetch(`/api/xref/links?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch links');
      const data = await response.json();
      setLinks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch links');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEntity = useCallback(async (type: CrossReferenceEntityType, id: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/xref/entities/${type}/${encodeURIComponent(id)}`);
      if (!response.ok) {
        if (response.status === 404) {
          setCurrentEntity(null);
          return;
        }
        throw new Error('Failed to fetch entity');
      }
      const data = await response.json();
      setCurrentEntity(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch entity');
    } finally {
      setLoading(false);
    }
  }, []);

  const findPath = useCallback(async (
    sourceType: CrossReferenceEntityType,
    sourceId: string,
    targetType: CrossReferenceEntityType,
    targetId: string
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sourceType,
        sourceId,
        targetType,
        targetId,
      });
      const response = await fetch(`/api/xref/path?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 404) {
          setPathResult(null);
          return;
        }
        throw new Error('Failed to find path');
      }
      const data = await response.json();
      setPathResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to find path');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (selectedWorker) {
      fetchEntity('worker', selectedWorker);
      setViewMode('entity');
    } else if (selectedBead) {
      fetchEntity('bead', selectedBead);
      setViewMode('entity');
    } else if (selectedFile) {
      fetchEntity('file', selectedFile);
      setViewMode('entity');
    }
  }, [selectedWorker, selectedBead, selectedFile, fetchEntity]);

  const handleNavigate = (type: CrossReferenceEntityType, id: string) => {
    fetchEntity(type, id);
    onNavigate?.(type, id);
  };

  const renderStrengthBar = (strength: number) => {
    const filled = Math.round(strength * 5);
    const empty = 5 - filled;
    return (
      <span className="strength-bar">
        {'█'.repeat(filled)}{'░'.repeat(empty)}
      </span>
    );
  };

  const renderRelationshipBadge = (relationship: CrossReferenceRelationship) => {
    const config = RELATIONSHIP_CONFIG[relationship] || {
      label: relationship,
      color: '#6b7280',
    };
    return (
      <span
        className="relationship-badge"
        style={{ backgroundColor: config.color }}
      >
        {config.label}
      </span>
    );
  };

  const renderEntityBadge = (type: CrossReferenceEntityType, id: string) => {
    const color = ENTITY_COLORS[type] || '#6b7280';
    const displayId = type === 'file'
      ? id.split('/').pop()
      : type === 'worker'
        ? id.slice(0, 8)
        : id.slice(0, 12);

    return (
      <span
        className="entity-badge"
        style={{ borderColor: color, color }}
        onClick={() => handleNavigate(type, id)}
      >
        {type}: {displayId}
      </span>
    );
  };

  const renderStatsView = () => (
    <div className="xref-stats">
      <div className="stats-header">
        <h3>Cross-Reference Statistics</h3>
        <button onClick={() => setViewMode('links')}>View All Links</button>
      </div>

      <div className="stats-overview">
        <div className="stat-card">
          <div className="stat-value">{stats?.totalLinks || 0}</div>
          <div className="stat-label">Total Links</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats?.totalEntities || 0}</div>
          <div className="stat-label">Entities Tracked</div>
        </div>
      </div>

      <div className="stats-section">
        <h4>By Relationship Type</h4>
        <div className="relationship-bars">
          {stats && Object.entries(stats.byRelationship)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([rel, count]) => {
              const config = RELATIONSHIP_CONFIG[rel as CrossReferenceRelationship];
              const percent = stats.totalLinks > 0
                ? (count / stats.totalLinks) * 100
                : 0;
              return (
                <div key={rel} className="relationship-bar-row">
                  <span
                    className="relationship-bar-label"
                    style={{ color: config?.color }}
                  >
                    {config?.label || rel}
                  </span>
                  <div className="relationship-bar-container">
                    <div
                      className="relationship-bar-fill"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: config?.color,
                      }}
                    />
                  </div>
                  <span className="relationship-bar-count">{count}</span>
                </div>
              );
            })}
        </div>
      </div>

      <div className="stats-section">
        <h4>Most Linked Entities</h4>
        <div className="most-linked-list">
          {stats?.mostLinked.slice(5).map((entity, i) => (
            <div
              key={i}
              className="most-linked-item"
              onClick={() => handleNavigate(entity.type, entity.id)}
            >
              {renderEntityBadge(entity.type, entity.id)}
              <span className="link-count">{entity.linkCount} links</span>
            </div>
          ))}
        </div>
      </div>

      <div className="stats-section">
        <h4>Recent Links</h4>
        <div className="recent-links-list">
          {stats?.recentLinks.slice(10).map((link) => (
            <div key={link.id} className="recent-link-item">
              {renderRelationshipBadge(link.relationship)}
              {renderEntityBadge(link.sourceType, link.sourceId)}
              <span className="arrow">→</span>
              {renderEntityBadge(link.targetType, link.targetId)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderEntityView = () => (
    <div className="xref-entity">
      <div className="entity-header">
        <button onClick={() => setViewMode('stats')}>← Back to Stats</button>
        {currentEntity && (
          <h3>
            {renderEntityBadge(currentEntity.type, currentEntity.id)}
            <span className="entity-stats">
              {currentEntity.linkCount} links · {currentEntity.occurrenceCount} occurrences
            </span>
          </h3>
        )}
      </div>

      {currentEntity ? (
        <div className="entity-links">
          <h4>Related Entities</h4>
          <div className="links-list">
            {links.filter(l =>
              l.sourceId === currentEntity.id || l.targetId === currentEntity.id
            ).map((link) => {
              const isSource = link.sourceId === currentEntity.id;
              const targetType = isSource ? link.targetType : link.sourceType;
              const targetId = isSource ? link.targetId : link.sourceId;

              return (
                <div key={link.id} className="link-item">
                  <div className="link-relationship">
                    {renderRelationshipBadge(link.relationship)}
                    {renderStrengthBar(link.strength)}
                  </div>
                  <div className="link-target">
                    <span className="arrow">{isSource ? '→' : '←'}</span>
                    {renderEntityBadge(targetType, targetId)}
                  </div>
                  {link.context && (
                    <div className="link-context">{link.context}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="entity-not-found">
          Entity not found. It may not have been tracked yet.
        </div>
      )}

      {pathResult && (
        <div className="path-result">
          <h4>Navigation Path</h4>
          <div className="path-steps">
            {pathResult.steps.map((step, i) => (
              <div key={i} className="path-step">
                <span className="step-number">{i + 1}</span>
                {renderRelationshipBadge(step.relationship)}
                {renderEntityBadge(step.targetType, step.targetId)}
              </div>
            ))}
          </div>
          <div className="path-description">{pathResult.description}</div>
        </div>
      )}
    </div>
  );

  const renderLinksView = () => (
    <div className="xref-links">
      <div className="links-header">
        <button onClick={() => setViewMode('stats')}>← Back to Stats</button>
        <h3>All Cross-Reference Links</h3>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="links-list">
          {links.map((link) => (
            <div key={link.id} className="link-item">
              <div className="link-relationship">
                {renderRelationshipBadge(link.relationship)}
                {renderStrengthBar(link.strength)}
              </div>
              <div className="link-entities">
                {renderEntityBadge(link.sourceType, link.sourceId)}
                <span className="arrow">→</span>
                {renderEntityBadge(link.targetType, link.targetId)}
              </div>
              {link.context && (
                <div className="link-context">{link.context}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="cross-reference-panel">
      {error && <div className="error-message">{error}</div>}
      {loading && <div className="loading-overlay">Loading...</div>}

      {viewMode === 'stats' && renderStatsView()}
      {viewMode === 'entity' && renderEntityView()}
      {viewMode === 'links' && renderLinksView()}
    </div>
  );
};

export default CrossReferencePanel;

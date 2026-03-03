import React, { useState, useMemo } from 'react';
import {
  RecoverySuggestion,
  RecoveryAction,
  RecoveryPriority,
  RecoveryActionType,
  ErrorCategory,
} from '../types';

interface RecoveryPanelProps {
  /** Array of recovery suggestions to display */
  suggestions: RecoverySuggestion[];

  /** Callback when an action is executed */
  onExecuteAction?: (suggestionId: string, actionId: string) => void;

  /** Callback when a suggestion is dismissed */
  onDismissSuggestion?: (suggestionId: string) => void;

  /** Whether the panel is visible */
  visible?: boolean;

  /** Callback to close the panel */
  onClose?: () => void;

  /** Show only active suggestions */
  activeOnly?: boolean;

  /** Show only automated actions */
  automatedOnly?: boolean;

  /** Maximum suggestions to show */
  maxSuggestions?: number;
}

// Priority colors
const PRIORITY_COLORS: Record<RecoveryPriority, string> = {
  immediate: 'var(--error)',
  high: 'var(--warning)',
  normal: 'var(--info)',
  low: 'var(--text-secondary)',
};

// Priority badges
const PRIORITY_BADGES: Record<RecoveryPriority, string> = {
  immediate: '!!!',
  high: '!!',
  normal: '!',
  low: '.',
};

// Action type icons
const ACTION_TYPE_ICONS: Record<RecoveryActionType, string> = {
  retry: '🔄',
  backoff: '⏳',
  alternative: '🔀',
  escalate: '👤',
  skip: '⏭️',
  fix_config: '⚙️',
  install_dep: '📦',
  fix_permissions: '🔐',
  cleanup: '🧹',
  restart: '🔁',
  investigate: '🔍',
};

// Category icons
const CATEGORY_ICONS: Record<ErrorCategory, string> = {
  network: '🌐',
  permission: '🔐',
  validation: '✓',
  resource: '💾',
  not_found: '❓',
  timeout: '⏱️',
  syntax: '📝',
  tool: '🔧',
  unknown: '❗',
};

// Category labels
const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  network: 'Network Error',
  permission: 'Permission Denied',
  validation: 'Validation Error',
  resource: 'Resource Limit',
  not_found: 'Not Found',
  timeout: 'Timeout',
  syntax: 'Syntax Error',
  tool: 'Tool Error',
  unknown: 'Unknown Error',
};

/**
 * Format confidence as percentage
 */
function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Format estimated time
 */
function formatEstimatedTime(seconds?: number): string {
  if (!seconds) return '';
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${minutes}m ${secs}s` : `~${minutes}m`;
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * RecoveryPanel Component
 *
 * Displays recovery suggestions when workers encounter errors.
 * Shows actionable steps based on error patterns.
 * Ported from TUI RecoveryPanel.ts
 */
const RecoveryPanel: React.FC<RecoveryPanelProps> = ({
  suggestions,
  onExecuteAction,
  onDismissSuggestion,
  visible = true,
  onClose,
  activeOnly = true,
  automatedOnly = false,
  maxSuggestions = 10,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Filter suggestions
  const filteredSuggestions = useMemo(() => {
    let filtered = suggestions;

    if (activeOnly) {
      filtered = filtered.filter((s) => s.isActive);
    }

    if (automatedOnly) {
      filtered = filtered.filter((s) => s.actions.some((a) => a.automated));
    }

    return filtered.slice(0, maxSuggestions);
  }, [suggestions, activeOnly, automatedOnly, maxSuggestions]);

  // Stats
  const stats = useMemo(() => {
    const active = filteredSuggestions.filter((s) => s.isActive).length;
    const automated = filteredSuggestions.filter((s) =>
      s.actions.some((a) => a.automated)
    ).length;

    return {
      total: filteredSuggestions.length,
      active,
      automated,
    };
  }, [filteredSuggestions]);

  const handleSelectSuggestion = (index: number) => {
    setSelectedIndex(index);
  };

  const handleToggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const handleExecuteAction = (suggestionId: string, action: RecoveryAction) => {
    onExecuteAction?.(suggestionId, action.id);
  };

  const handleDismiss = (suggestionId: string) => {
    onDismissSuggestion?.(suggestionId);
  };

  const getPriorityClass = (priority: RecoveryPriority): string => {
    return `recovery-priority-${priority}`;
  };

  const getAutomatedClass = (automated: boolean): string => {
    return automated ? 'recovery-action-automated' : 'recovery-action-manual';
  };

  if (!visible) {
    return null;
  }

  const selectedSuggestion = filteredSuggestions[selectedIndex];

  return (
    <div className="recovery-panel">
      {/* Header */}
      <div className="recovery-header">
        <h2>
          <span className="recovery-header-icon">💊</span>
          Recovery Playbook
          {stats.active > 0 && (
            <span className="recovery-badge">{stats.active}</span>
          )}
        </h2>
        {onClose && (
          <button
            className="recovery-close"
            onClick={onClose}
            title="Close panel"
          >
            x
          </button>
        )}
      </div>

      {/* Content */}
      <div className="recovery-content">
        {filteredSuggestions.length === 0 ? (
          <div className="recovery-empty">
            <span className="recovery-empty-icon">✓</span>
            <span>No recovery suggestions available</span>
            <span className="recovery-empty-hint">
              Errors will appear here when workers encounter issues.
            </span>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="recovery-summary">
              <span className="recovery-count">
                Suggestions: {stats.total} ({stats.active} active, {stats.automated} automated)
              </span>
            </div>

            {/* Suggestions List */}
            <div className="recovery-suggestions-list">
              {filteredSuggestions.map((suggestion, index) => {
                const isExpanded = expandedIndex === index;
                const isSelected = selectedIndex === index;
                const icon = CATEGORY_ICONS[suggestion.category];
                const confidence = formatConfidence(suggestion.confidence);
                const workersCount = suggestion.affectedWorkers.length;

                return (
                  <div
                    key={suggestion.id}
                    className={`recovery-suggestion ${isSelected ? 'selected' : ''} ${
                      suggestion.isActive ? 'active' : 'resolved'
                    }`}
                    onClick={() => handleSelectSuggestion(index)}
                  >
                    {/* Suggestion Header */}
                    <div className="recovery-suggestion-header">
                      <span
                        className="recovery-expand-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleExpand(index);
                        }}
                      >
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <span className="recovery-category-icon">{icon}</span>
                      <span className="recovery-suggestion-title">
                        {truncate(suggestion.title, 40)}
                      </span>
                      <span className={`recovery-status-badge ${suggestion.isActive ? 'active' : ''}`}>
                        {suggestion.isActive ? 'ACTIVE' : 'RESOLVED'}
                      </span>
                    </div>

                    {/* Suggestion Meta */}
                    <div className="recovery-suggestion-meta">
                      <span className="recovery-error-summary">
                        {truncate(suggestion.errorSummary, 60)}
                      </span>
                      <span className="recovery-confidence">
                        Confidence: {confidence}
                      </span>
                      <span className="recovery-workers-count">
                        Workers: {workersCount}
                      </span>
                    </div>

                    {/* Expanded Actions */}
                    {isExpanded && (
                      <div className="recovery-actions">
                        <div className="recovery-actions-header">
                          Recovery Actions:
                        </div>
                        {suggestion.actions.slice(0, 5).map((action) => {
                          const actionIcon = ACTION_TYPE_ICONS[action.type];
                          const priorityBadge = PRIORITY_BADGES[action.priority];

                          return (
                            <div key={action.id} className="recovery-action">
                              <div className="recovery-action-header">
                                <span
                                  className="recovery-priority-badge"
                                  style={{ color: PRIORITY_COLORS[action.priority] }}
                                >
                                  [{priorityBadge}]
                                </span>
                                <span className="recovery-action-icon">{actionIcon}</span>
                                <span className={getAutomatedClass(action.automated)}>
                                  [{action.automated ? 'AUTO' : 'MANUAL'}]
                                </span>
                                <span className="recovery-action-title">{action.title}</span>
                              </div>

                              {action.description && (
                                <div className="recovery-action-description">
                                  {truncate(action.description, 70)}
                                </div>
                              )}

                              {action.command && (
                                <div className="recovery-action-command">
                                  $ {truncate(action.command, 60)}
                                </div>
                              )}

                              {action.estimatedTime && (
                                <div className="recovery-action-time">
                                  Est. time: {formatEstimatedTime(action.estimatedTime)}
                                </div>
                              )}

                              {action.automated && onExecuteAction && (
                                <button
                                  className="recovery-execute-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleExecuteAction(suggestion.id, action);
                                  }}
                                >
                                  [Enter] Execute
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* Dismiss Button */}
                        {onDismissSuggestion && (
                          <div className="recovery-action-footer">
                            <button
                              className="recovery-dismiss-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDismiss(suggestion.id);
                              }}
                            >
                              [d] Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Selected Detail */}
            {selectedSuggestion && expandedIndex === null && (
              <div className="recovery-detail">
                <div className="recovery-detail-divider">
                  ------------------------------------------
                </div>
                <div className="recovery-detail-header">
                  Selected: {CATEGORY_ICONS[selectedSuggestion.category]}{' '}
                  {CATEGORY_LABELS[selectedSuggestion.category]}
                </div>
                <div className="recovery-detail-row">
                  <span className="recovery-detail-label">Title:</span>
                  <span className="recovery-detail-value">{selectedSuggestion.title}</span>
                </div>
                <div className="recovery-detail-row">
                  <span className="recovery-detail-value">
                    {selectedSuggestion.errorSummary}
                  </span>
                </div>
                <div className="recovery-detail-row">
                  <span className="recovery-detail-label">Confidence:</span>
                  <span className="recovery-detail-value">
                    {formatConfidence(selectedSuggestion.confidence)}
                  </span>
                </div>
                <div className="recovery-detail-row">
                  <span className="recovery-detail-label">Workers:</span>
                  <span className="recovery-detail-value">
                    {selectedSuggestion.affectedWorkers.join(', ')}
                  </span>
                </div>
                {selectedSuggestion.actions.length > 0 && (
                  <div className="recovery-detail-suggestion">
                    Top action: {ACTION_TYPE_ICONS[selectedSuggestion.actions[0].type]}{' '}
                    {selectedSuggestion.actions[0].title}
                  </div>
                )}
                <div className="recovery-detail-actions">
                  <button
                    className="recovery-action-btn"
                    onClick={() => handleToggleExpand(selectedIndex)}
                  >
                    [Enter] Expand
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="recovery-footer">
        <span className="recovery-help">↑↓ Navigate | Enter Expand | Esc Collapse</span>
      </div>
    </div>
  );
};

export default RecoveryPanel;

import React, { useState, useMemo } from 'react';
import { CollisionAlert as CollisionAlertData } from '../types';

interface CollisionAlertProps {
  /** Array of collision alerts to display */
  alerts: CollisionAlertData[];

  /** Callback when an alert is acknowledged */
  onAcknowledge?: (alertId: string) => void;

  /** Callback when all alerts are acknowledged */
  onAcknowledgeAll?: () => void;

  /** Whether the panel is visible */
  visible?: boolean;

  /** Callback to close the panel */
  onClose?: () => void;
}

/**
 * CollisionAlert Component
 *
 * Displays collision alerts to users, warning about potential duplicate work
 * or conflicting operations between workers. Ported from TUI CollisionAlert.ts
 */
const CollisionAlert: React.FC<CollisionAlertProps> = ({
  alerts,
  onAcknowledge,
  onAcknowledgeAll,
  visible = true,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Group alerts by severity
  const groupedAlerts = useMemo(() => {
    const critical = alerts.filter(a => a.severity === 'critical' || a.severity === 'error');
    const warnings = alerts.filter(a => a.severity === 'warning');
    const info = alerts.filter(a => a.severity === 'info');
    return { critical, warnings, info };
  }, [alerts]);

  const unacknowledgedCount = useMemo(() => {
    return alerts.filter(a => !a.acknowledged).length;
  }, [alerts]);

  const getSeverityIcon = (severity: CollisionAlertData['severity']): string => {
    switch (severity) {
      case 'critical':
        return '!!!';
      case 'error':
        return '!!';
      case 'warning':
        return '!';
      case 'info':
        return 'i';
    }
  };

  const getSeverityClass = (severity: CollisionAlertData['severity']): string => {
    return `collision-severity-${severity}`;
  };

  const getTypeIcon = (type: CollisionAlertData['type']): string => {
    switch (type) {
      case 'file':
        return 'F';
      case 'bead':
        return 'B';
      case 'task':
        return 'T';
    }
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const handleAcknowledge = (alertId: string) => {
    onAcknowledge?.(alertId);
  };

  const handleAcknowledgeAll = () => {
    onAcknowledgeAll?.();
  };

  const handleSelectAlert = (index: number) => {
    setSelectedIndex(index);
  };

  const selectedAlert = alerts[selectedIndex];

  if (!visible) {
    return null;
  }

  return (
    <div className="collision-alert-panel">
      {/* Header */}
      <div className="collision-alert-header">
        <h2>
          <span className="collision-alert-icon">!</span>
          Collision Alerts
          {unacknowledgedCount > 0 && (
            <span className="collision-badge">{unacknowledgedCount}</span>
          )}
        </h2>
        {onClose && (
          <button
            className="collision-alert-close"
            onClick={onClose}
            title="Close panel"
          >
            x
          </button>
        )}
      </div>

      {/* Content */}
      <div className="collision-alert-content">
        {alerts.length === 0 ? (
          <div className="collision-empty">
            <span className="collision-empty-icon">OK</span>
            <span>No active collisions detected</span>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="collision-summary">
              <span className="collision-count">
                Alerts: {alerts.length} ({unacknowledgedCount} unacknowledged)
              </span>
            </div>

            {/* Critical/Error Alerts */}
            {groupedAlerts.critical.length > 0 && (
              <div className="collision-group collision-group-critical">
                <div className="collision-group-header">
                  <span className="collision-group-icon">!!!</span>
                  CRITICAL/ERROR ({groupedAlerts.critical.length})
                </div>
                <div className="collision-group-items">
                  {groupedAlerts.critical.map((alert, idx) => {
                    const globalIdx = alerts.indexOf(alert);
                    return (
                      <div
                        key={alert.id}
                        className={`collision-item ${getSeverityClass(alert.severity)} ${
                          globalIdx === selectedIndex ? 'selected' : ''
                        } ${alert.acknowledged ? 'acknowledged' : ''}`}
                        onClick={() => handleSelectAlert(globalIdx)}
                      >
                        <span className="collision-item-icon">
                          {getSeverityIcon(alert.severity)}
                        </span>
                        <span className="collision-item-type">
                          [{getTypeIcon(alert.type)}]
                        </span>
                        <span className="collision-item-title">
                          {alert.title.length > 40 ? alert.title.slice(0, 40) + '...' : alert.title}
                        </span>
                        <span className="collision-item-workers">
                          {alert.workers.length > 2
                            ? `${alert.workers.length} workers`
                            : alert.workers.slice(0, 2).join(', ')}
                        </span>
                        {alert.acknowledged && (
                          <span className="collision-item-ack">[ACK]</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Warning Alerts */}
            {groupedAlerts.warnings.length > 0 && (
              <div className="collision-group collision-group-warning">
                <div className="collision-group-header">
                  <span className="collision-group-icon">!</span>
                  WARNINGS ({groupedAlerts.warnings.length})
                </div>
                <div className="collision-group-items">
                  {groupedAlerts.warnings.map((alert, idx) => {
                    const globalIdx = alerts.indexOf(alert);
                    return (
                      <div
                        key={alert.id}
                        className={`collision-item ${getSeverityClass(alert.severity)} ${
                          globalIdx === selectedIndex ? 'selected' : ''
                        } ${alert.acknowledged ? 'acknowledged' : ''}`}
                        onClick={() => handleSelectAlert(globalIdx)}
                      >
                        <span className="collision-item-icon">
                          {getSeverityIcon(alert.severity)}
                        </span>
                        <span className="collision-item-type">
                          [{getTypeIcon(alert.type)}]
                        </span>
                        <span className="collision-item-title">
                          {alert.title.length > 40 ? alert.title.slice(0, 40) + '...' : alert.title}
                        </span>
                        <span className="collision-item-workers">
                          {alert.workers.length > 2
                            ? `${alert.workers.length} workers`
                            : alert.workers.slice(0, 2).join(', ')}
                        </span>
                        {alert.acknowledged && (
                          <span className="collision-item-ack">[ACK]</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Info Alerts */}
            {groupedAlerts.info.length > 0 && (
              <div className="collision-group collision-group-info">
                <div className="collision-group-header">
                  <span className="collision-group-icon">i</span>
                  INFO ({groupedAlerts.info.length})
                </div>
                <div className="collision-group-items">
                  {groupedAlerts.info.map((alert, idx) => {
                    const globalIdx = alerts.indexOf(alert);
                    return (
                      <div
                        key={alert.id}
                        className={`collision-item ${getSeverityClass(alert.severity)} ${
                          globalIdx === selectedIndex ? 'selected' : ''
                        } ${alert.acknowledged ? 'acknowledged' : ''}`}
                        onClick={() => handleSelectAlert(globalIdx)}
                      >
                        <span className="collision-item-icon">
                          {getSeverityIcon(alert.severity)}
                        </span>
                        <span className="collision-item-type">
                          [{getTypeIcon(alert.type)}]
                        </span>
                        <span className="collision-item-title">
                          {alert.title.length > 40 ? alert.title.slice(0, 40) + '...' : alert.title}
                        </span>
                        <span className="collision-item-workers">
                          {alert.workers.length > 2
                            ? `${alert.workers.length} workers`
                            : alert.workers.slice(0, 2).join(', ')}
                        </span>
                        {alert.acknowledged && (
                          <span className="collision-item-ack">[ACK]</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected Alert Details */}
            {selectedAlert && (
              <div className="collision-detail">
                <div className="collision-detail-divider">
                  ------------------------------------------
                </div>
                <div className="collision-detail-header">Selected Alert Details:</div>
                <div className="collision-detail-row">
                  <span className="collision-detail-label">Title:</span>
                  <span className="collision-detail-value">{selectedAlert.title}</span>
                </div>
                <div className="collision-detail-row">
                  <span className="collision-detail-value">
                    {selectedAlert.description}
                  </span>
                </div>
                <div className="collision-detail-row">
                  <span className="collision-detail-label">Workers:</span>
                  <span className="collision-detail-value">
                    {selectedAlert.workers.join(', ')}
                  </span>
                </div>
                {selectedAlert.suggestion && (
                  <div className="collision-detail-suggestion">
                    Suggestion: {selectedAlert.suggestion}
                  </div>
                )}
                <div className="collision-detail-actions">
                  <button
                    className="collision-action-btn"
                    onClick={() => handleAcknowledge(selectedAlert.id)}
                    disabled={selectedAlert.acknowledged}
                  >
                    [Enter] Acknowledge
                  </button>
                  <button
                    className="collision-action-btn"
                    onClick={handleAcknowledgeAll}
                  >
                    [a] Acknowledge All
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CollisionAlert;

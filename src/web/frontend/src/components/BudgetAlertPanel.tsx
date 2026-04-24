import React, { useState, useEffect, useCallback } from 'react';

interface BudgetStatus {
  limit: number;
  spent: number;
  percentUsed: number;
  isOverBudget: boolean;
  warningLevel: 'none' | 'warning' | 'critical';
  remaining: number;
}

interface BurnRate {
  costPerMinute: number;
  minutesToExhaustion: number | null;
  timeToExhaustion: string | null;
  projectedTotalCost: number;
  windowMinutes: number;
  isHighBurnRate: boolean;
}

interface CostSummary {
  totalCostUsd: number;
  budget: BudgetStatus;
  burnRate: BurnRate;
  workerCount: number;
}

interface WorkerCostEntry {
  workerId: string;
  costUsd: number;
  totalTokens: number;
  apiCalls: number;
  currentBead?: string;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}c`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

function formatBurnRate(rate: number): string {
  if (rate < 0.01) return `$${(rate * 100).toFixed(2)}c/min`;
  return `$${rate.toFixed(2)}/min`;
}

// ── Banner: shown at top of page when budget >= 80% ──

interface BudgetBannerProps {
  budget: BudgetStatus;
  burnRate: BurnRate;
  onOpenPanel: () => void;
  onDismiss: () => void;
}

export const BudgetBanner: React.FC<BudgetBannerProps> = ({ budget, burnRate, onOpenPanel, onDismiss }) => {
  if (budget.warningLevel === 'none') return null;

  const isCritical = budget.warningLevel === 'critical' || budget.isOverBudget;

  return (
    <div className={`budget-banner ${isCritical ? 'budget-banner--critical' : 'budget-banner--warning'}`}>
      <div className="budget-banner-content">
        <span className="budget-banner-icon">{isCritical ? '!!' : '!'}</span>
        <span className="budget-banner-text">
          {budget.isOverBudget
            ? `Budget exceeded: ${formatCost(budget.spent)} / ${formatCost(budget.limit)} (${Math.round(budget.percentUsed)}%)`
            : `${isCritical ? 'Critical' : 'Warning'}: ${formatCost(budget.spent)} / ${formatCost(budget.limit)} (${Math.round(budget.percentUsed)}% used)`}
        </span>
        <span className="budget-banner-burn">
          {formatBurnRate(burnRate.costPerMinute)}
          {burnRate.timeToExhaustion && ` | ETA: ${burnRate.timeToExhaustion}`}
        </span>
        <button className="budget-banner-action" onClick={onOpenPanel}>Details</button>
        <button className="budget-banner-dismiss" onClick={onDismiss} title="Dismiss for this session">&times;</button>
      </div>
      <div className="budget-banner-bar">
        <div
          className="budget-banner-bar-fill"
          style={{ width: `${Math.min(100, budget.percentUsed)}%` }}
        />
      </div>
    </div>
  );
};

// ── Full panel: detailed budget alert view ──

interface BudgetAlertPanelProps {
  visible: boolean;
  onClose: () => void;
}

const BudgetAlertPanel: React.FC<BudgetAlertPanelProps> = ({ visible, onClose }) => {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [workers, setWorkers] = useState<WorkerCostEntry[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, workersRes] = await Promise.all([
        fetch('/api/cost/summary'),
        fetch('/api/cost/workers'),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (workersRes.ok) {
        const data = await workersRes.json();
        setWorkers((data.workers || []).slice(0, 10));
      }
    } catch (err) {
      console.error('Failed to fetch budget data:', err);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      fetchData();
      const interval = setInterval(fetchData, 10000);
      return () => clearInterval(interval);
    }
  }, [visible, fetchData]);

  if (!visible || !summary) return null;

  const { budget, burnRate, totalCostUsd, workerCount } = summary;
  const maxWorkerCost = Math.max(...workers.map(w => w.costUsd), 0.001);

  return (
    <div className="cost-dashboard-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cost-dashboard budget-alert-panel">
        <div className="cost-dashboard-header">
          <h3>Budget Alerts</h3>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>

        <div className="cost-dashboard-content">
          {/* Budget Status */}
          <div className="cost-card">
            <div className="cost-card-title">Budget Status</div>
            <div className="budget-alert-summary-row">
              <div className="budget-alert-stat">
                <span className="budget-alert-stat-label">Spent</span>
                <span className={`budget-alert-stat-value ${budget.warningLevel === 'critical' || budget.isOverBudget ? 'cost-high' : budget.warningLevel === 'warning' ? 'cost-warn' : ''}`}>
                  {formatCost(budget.spent)}
                </span>
              </div>
              <div className="budget-alert-stat">
                <span className="budget-alert-stat-label">Limit</span>
                <span className="budget-alert-stat-value">{formatCost(budget.limit)}</span>
              </div>
              <div className="budget-alert-stat">
                <span className="budget-alert-stat-label">Remaining</span>
                <span className="budget-alert-stat-value">{formatCost(Math.max(0, budget.remaining))}</span>
              </div>
              <div className="budget-alert-stat">
                <span className="budget-alert-stat-label">Usage</span>
                <span className={`budget-alert-stat-value ${budget.warningLevel === 'critical' || budget.isOverBudget ? 'cost-high' : budget.warningLevel === 'warning' ? 'cost-warn' : ''}`}>
                  {Math.round(budget.percentUsed)}%
                </span>
              </div>
            </div>
            <div className="budget-progress-container">
              <div className="budget-progress-bar">
                <div
                  className="budget-progress-fill"
                  style={{
                    width: `${Math.min(100, budget.percentUsed)}%`,
                    backgroundColor: budget.warningLevel === 'critical' || budget.isOverBudget
                      ? 'var(--error)'
                      : budget.warningLevel === 'warning'
                        ? 'var(--warning)'
                        : 'var(--success)',
                  }}
                />
              </div>
              <div className="budget-progress-markers">
                <span className="budget-marker" style={{ left: '80%' }}>80%</span>
                <span className="budget-marker" style={{ left: '95%' }}>95%</span>
              </div>
            </div>
          </div>

          {/* Burn Rate & ETA */}
          <div className="cost-card">
            <div className="cost-card-title">Burn Rate &amp; ETA</div>
            <div className="budget-alert-summary-row">
              <div className="budget-alert-stat">
                <span className="budget-alert-stat-label">Rate</span>
                <span className={`budget-alert-stat-value ${burnRate.isHighBurnRate ? 'cost-high' : ''}`}>
                  {formatBurnRate(burnRate.costPerMinute)}
                </span>
              </div>
              <div className="budget-alert-stat">
                <span className="budget-alert-stat-label">ETA to Exhaust</span>
                <span className="budget-alert-stat-value">
                  {burnRate.timeToExhaustion || 'N/A'}
                </span>
              </div>
              <div className="budget-alert-stat">
                <span className="budget-alert-stat-label">Projected Total</span>
                <span className="budget-alert-stat-value">{formatCost(burnRate.projectedTotalCost)}</span>
              </div>
            </div>
            {burnRate.isHighBurnRate && (
              <div className="budget-burn-warning">High burn rate detected</div>
            )}
          </div>

          {/* Top Consumers */}
          <div className="cost-card">
            <div className="cost-card-title">Top Consumers ({workerCount} workers)</div>
            <div className="budget-consumers-list">
              {workers.length === 0 && (
                <div className="cost-empty">No cost data yet</div>
              )}
              {workers.map(w => (
                <div key={w.workerId} className="budget-consumer-row">
                  <div className="budget-consumer-info">
                    <span className="budget-consumer-id">{w.workerId}</span>
                    {w.currentBead && <span className="budget-consumer-bead">{w.currentBead}</span>}
                  </div>
                  <div className="budget-consumer-bar-container">
                    <div
                      className="budget-consumer-bar"
                      style={{ width: `${(w.costUsd / maxWorkerCost) * 100}%` }}
                    />
                  </div>
                  <span className="budget-consumer-cost">{formatCost(w.costUsd)}</span>
                  <span className="budget-consumer-tokens">{formatTokens(w.totalTokens)} tok | {w.apiCalls} calls</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetAlertPanel;

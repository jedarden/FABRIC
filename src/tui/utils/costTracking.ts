/**
 * Cost Tracking Utilities
 *
 * Tracks token usage from log events and calculates estimated costs.
 * Displays total tokens, estimated cost, and per-worker breakdown.
 * Includes burn rate calculations, budget alerts, and projections.
 */

import { LogEvent } from '../../types.js';

export interface TokenUsage {
  /** Input tokens */
  input: number;

  /** Output tokens */
  output: number;

  /** Total tokens */
  total: number;
}

export interface WorkerCost extends TokenUsage {
  /** Worker ID */
  workerId: string;

  /** Estimated cost in USD */
  costUsd: number;

  /** Number of API calls */
  apiCalls: number;

  /** Current bead being worked on (if any) */
  currentBead?: string;

  /** Last activity timestamp */
  lastActivityTs?: number;
}

export interface CostSummary {
  /** Total usage across all workers */
  total: TokenUsage;

  /** Estimated total cost in USD */
  totalCostUsd: number;

  /** Per-worker breakdown */
  byWorker: Map<string, WorkerCost>;

  /** Budget status */
  budget: BudgetStatus;

  /** Burn rate information */
  burnRate: BurnRate;

  /** Time range of data */
  timeRange: {
    start: number;
    end: number;
  };
}

export interface BudgetStatus {
  /** Budget limit in USD (0 = no limit) */
  limit: number;

  /** Current spend */
  spent: number;

  /** Percentage of budget used (0-100) */
  percentUsed: number;

  /** Whether over budget */
  isOverBudget: boolean;

  /** Warning level (none, warning, critical) */
  warningLevel: 'none' | 'warning' | 'critical';

  /** Remaining budget in USD */
  remaining: number;
}

export interface BurnRate {
  /** Cost per minute in USD */
  costPerMinute: number;

  /** Time in minutes until budget exhausted (null if no budget or zero burn rate) */
  minutesToExhaustion: number | null;

  /** Formatted time to exhaustion (e.g., "2h 30m", "45m", "< 1m") */
  timeToExhaustion: string | null;

  /** Projected total cost at current burn rate (if session continues) */
  projectedTotalCost: number;

  /** Window size used for burn rate calculation in minutes */
  windowMinutes: number;

  /** Whether burn rate is high (> 0.50/min) */
  isHighBurnRate: boolean;
}

export interface BudgetAlert {
  /** Unique alert ID */
  id: string;

  /** Alert type */
  type: 'warning' | 'critical' | 'exhausted';

  /** Alert message */
  message: string;

  /** Timestamp when alert was generated */
  timestamp: number;

  /** Current spend at time of alert */
  spent: number;

  /** Budget limit */
  limit: number;

  /** Burn rate at time of alert */
  burnRate: number;

  /** Top consumers at time of alert */
  topConsumers: TopConsumer[];

  /** Whether alert has been acknowledged */
  acknowledged: boolean;
}

export interface TopConsumer {
  /** Worker ID */
  workerId: string;

  /** Cost in USD */
  costUsd: number;

  /** Percentage of total cost */
  percentOfTotal: number;

  /** Current bead (if known) */
  currentBead?: string;

  /** Reason for high consumption (optional insight) */
  insight?: string;
}

export interface CostTrackingOptions {
  /** Budget limit in USD (0 = no limit) */
  budgetLimit?: number;

  /** Warning threshold (percent, default 80 per plan.md) */
  warningThreshold?: number;

  /** Critical threshold (percent, default 95 per plan.md) */
  criticalThreshold?: number;

  /** Input cost per 1M tokens (default: $3 for Claude) */
  inputCostPerMillion?: number;

  /** Output cost per 1M tokens (default: $15 for Claude) */
  outputCostPerMillion?: number;

  /** Burn rate window in minutes (default: 5) */
  burnRateWindowMinutes?: number;

  /** High burn rate threshold in USD/min (default: 0.50) */
  highBurnRateThreshold?: number;
}

const DEFAULT_OPTIONS: Required<CostTrackingOptions> = {
  budgetLimit: 0,
  warningThreshold: 80,  // Per plan.md: warning at 80%
  criticalThreshold: 95, // Per plan.md: critical at 95%
  inputCostPerMillion: 3.00,   // Claude Sonnet input
  outputCostPerMillion: 15.00, // Claude Sonnet output
  burnRateWindowMinutes: 5,    // Calculate burn rate over last 5 minutes
  highBurnRateThreshold: 0.50, // High burn rate if > $0.50/min
};

// Model pricing (per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'glm-5': { input: 0.50, output: 0.50 }, // Estimated
};

/**
 * Cost Tracker class for managing token usage and costs
 */
export class CostTracker {
  private options: Required<CostTrackingOptions>;
  private workerCosts: Map<string, WorkerCost> = new Map();
  private firstEventTs: number | null = null;
  private lastEventTs: number | null = null;

  // Burn rate tracking
  private costHistory: Array<{ ts: number; cost: number; worker: string }> = [];

  // Alert tracking
  private alerts: BudgetAlert[] = [];
  private lastWarningLevel: 'none' | 'warning' | 'critical' = 'none';

  constructor(options: CostTrackingOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Process a log event and extract token usage
   */
  processEvent(event: LogEvent): void {
    // Track time range
    if (this.firstEventTs === null || event.ts < this.firstEventTs) {
      this.firstEventTs = event.ts;
    }
    if (this.lastEventTs === null || event.ts > this.lastEventTs) {
      this.lastEventTs = event.ts;
    }

    // Extract token info from event
    const tokens = this.extractTokens(event);
    if (!tokens) return;

    // Get or create worker cost entry
    let workerCost = this.workerCosts.get(event.worker);
    if (!workerCost) {
      workerCost = {
        workerId: event.worker,
        input: 0,
        output: 0,
        total: 0,
        costUsd: 0,
        apiCalls: 0,
        currentBead: event.bead,
        lastActivityTs: event.ts,
      };
      this.workerCosts.set(event.worker, workerCost);
    }

    // Update totals
    workerCost.input += tokens.input;
    workerCost.output += tokens.output;
    workerCost.total += tokens.input + tokens.output;
    workerCost.apiCalls += 1;
    workerCost.lastActivityTs = event.ts;
    if (event.bead) {
      workerCost.currentBead = event.bead;
    }

    // Calculate cost based on model
    const model = (event.model as string) || 'claude-sonnet-4-6';
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-6'];
    const incrementalCost =
      (tokens.input * pricing.input / 1_000_000) +
      (tokens.output * pricing.output / 1_000_000);

    workerCost.costUsd += incrementalCost;

    // Track cost history for burn rate calculation
    this.costHistory.push({
      ts: event.ts,
      cost: incrementalCost,
      worker: event.worker,
    });

    // Trim old history (keep last 30 minutes)
    const cutoffTs = event.ts - (30 * 60 * 1000);
    this.costHistory = this.costHistory.filter(h => h.ts > cutoffTs);

    // Check for budget alerts
    this.checkBudgetAlerts();
  }

  /**
   * Extract token counts from event
   */
  private extractTokens(event: LogEvent): { input: number; output: number } | null {
    // Check for explicit token fields
    if (typeof event.input_tokens === 'number' || typeof event.output_tokens === 'number') {
      return {
        input: (event.input_tokens as number) || 0,
        output: (event.output_tokens as number) || 0,
      };
    }

    // Check for usage object
    const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      return {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
      };
    }

    // Check for token counts in message
    const msg = event.msg || '';
    const inputMatch = msg.match(/input[:\s]+(\d+)/i);
    const outputMatch = msg.match(/output[:\s]+(\d+)/i);

    if (inputMatch || outputMatch) {
      return {
        input: inputMatch ? parseInt(inputMatch[1], 10) : 0,
        output: outputMatch ? parseInt(outputMatch[1], 10) : 0,
      };
    }

    return null;
  }

  /**
   * Get current cost summary
   */
  getSummary(): CostSummary {
    let totalInput = 0;
    let totalOutput = 0;

    for (const worker of this.workerCosts.values()) {
      totalInput += worker.input;
      totalOutput += worker.output;
    }

    const totalPrice = MODEL_PRICING['claude-sonnet-4-6']; // Default pricing
    const totalCostUsd =
      (totalInput * totalPrice.input / 1_000_000) +
      (totalOutput * totalPrice.output / 1_000_000);

    const budget = this.calculateBudgetStatus(totalCostUsd);
    const burnRate = this.calculateBurnRate();

    return {
      total: {
        input: totalInput,
        output: totalOutput,
        total: totalInput + totalOutput,
      },
      totalCostUsd,
      byWorker: new Map(this.workerCosts),
      budget,
      burnRate,
      timeRange: {
        start: this.firstEventTs || Date.now(),
        end: this.lastEventTs || Date.now(),
      },
    };
  }

  /**
   * Calculate burn rate (cost per minute)
   */
  private calculateBurnRate(): BurnRate {
    const now = this.lastEventTs || Date.now();
    const windowMs = this.options.burnRateWindowMinutes * 60 * 1000;
    const windowStart = now - windowMs;

    // Get costs within the burn rate window
    const recentCosts = this.costHistory.filter(h => h.ts >= windowStart);
    const totalCostInWindow = recentCosts.reduce((sum, h) => sum + h.cost, 0);

    // Calculate actual window duration (may be less if we don't have enough history)
    const oldestInWindow = recentCosts.length > 0
      ? Math.min(...recentCosts.map(h => h.ts))
      : windowStart;
    const actualWindowMs = now - oldestInWindow;
    const actualWindowMinutes = actualWindowMs / 60000;

    // Cost per minute
    const costPerMinute = actualWindowMinutes > 0
      ? totalCostInWindow / actualWindowMinutes
      : 0;

    // Calculate total cost directly (avoid recursion with getSummary)
    let totalInput = 0;
    let totalOutput = 0;
    for (const worker of this.workerCosts.values()) {
      totalInput += worker.input;
      totalOutput += worker.output;
    }
    const totalPrice = MODEL_PRICING['claude-sonnet-4-6'];
    const currentTotalCost =
      (totalInput * totalPrice.input / 1_000_000) +
      (totalOutput * totalPrice.output / 1_000_000);

    // Calculate time to exhaustion
    let minutesToExhaustion: number | null = null;
    let timeToExhaustion: string | null = null;

    if (this.options.budgetLimit > 0 && costPerMinute > 0) {
      const remaining = this.options.budgetLimit - currentTotalCost;
      if (remaining > 0) {
        minutesToExhaustion = remaining / costPerMinute;
        timeToExhaustion = formatTimeToExhaustion(minutesToExhaustion);
      } else {
        minutesToExhaustion = 0;
        timeToExhaustion = 'exhausted';
      }
    }

    // Projected total cost at current burn rate for remainder of session
    // Assume 60-minute session by default if we don't have enough data
    const sessionDurationMs = (this.lastEventTs || now) - (this.firstEventTs || now);
    const sessionMinutes = sessionDurationMs / 60000;
    const projectedTotalCost = sessionMinutes > 0
      ? currentTotalCost + (costPerMinute * Math.max(0, 60 - sessionMinutes))
      : costPerMinute * 60;

    return {
      costPerMinute,
      minutesToExhaustion,
      timeToExhaustion,
      projectedTotalCost,
      windowMinutes: this.options.burnRateWindowMinutes,
      isHighBurnRate: costPerMinute > this.options.highBurnRateThreshold,
    };
  }

  /**
   * Get top consumers by cost
   */
  getTopConsumers(limit: number = 5): TopConsumer[] {
    const totalCost = Array.from(this.workerCosts.values())
      .reduce((sum, w) => sum + w.costUsd, 0);

    if (totalCost === 0) return [];

    const consumers = Array.from(this.workerCosts.values())
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, limit)
      .map(w => ({
        workerId: w.workerId,
        costUsd: w.costUsd,
        percentOfTotal: (w.costUsd / totalCost) * 100,
        currentBead: w.currentBead,
        insight: this.getWorkerInsight(w),
      }));

    return consumers;
  }

  /**
   * Get insight about worker's cost pattern
   */
  private getWorkerInsight(worker: WorkerCost): string | undefined {
    // Check for high API call count
    if (worker.apiCalls > 100) {
      return 'high API call volume';
    }

    // Check for high output ratio (expensive)
    const outputRatio = worker.total > 0 ? worker.output / worker.total : 0;
    if (outputRatio > 0.4) {
      return 'high output token ratio';
    }

    // Check for rapid recent activity
    const recentCosts = this.costHistory.filter(h => h.worker === worker.workerId);
    if (recentCosts.length > 20) {
      return 'high activity rate';
    }

    return undefined;
  }

  /**
   * Check budget thresholds and generate alerts
   */
  private checkBudgetAlerts(): void {
    if (this.options.budgetLimit === 0) return;

    const summary = this.getSummary();
    const { warningLevel, spent, limit } = summary.budget;

    // Only generate alert if warning level changed
    if (warningLevel !== this.lastWarningLevel && warningLevel !== 'none') {
      const alert: BudgetAlert = {
        id: `alert-${Date.now()}`,
        type: warningLevel === 'critical' ? 'critical' : 'warning',
        message: this.generateAlertMessage(warningLevel, spent, limit, summary.burnRate),
        timestamp: Date.now(),
        spent,
        limit,
        burnRate: summary.burnRate.costPerMinute,
        topConsumers: this.getTopConsumers(3),
        acknowledged: false,
      };

      this.alerts.push(alert);
      this.lastWarningLevel = warningLevel;
    }

    // Check for budget exhaustion
    if (summary.budget.isOverBudget && this.lastWarningLevel !== 'critical') {
      const alert: BudgetAlert = {
        id: `alert-${Date.now()}`,
        type: 'exhausted',
        message: `Budget exhausted! Spent $${spent.toFixed(2)} of $${limit.toFixed(2)} budget.`,
        timestamp: Date.now(),
        spent,
        limit,
        burnRate: summary.burnRate.costPerMinute,
        topConsumers: this.getTopConsumers(3),
        acknowledged: false,
      };

      this.alerts.push(alert);
      this.lastWarningLevel = 'critical';
    }
  }

  /**
   * Generate alert message
   */
  private generateAlertMessage(
    level: 'warning' | 'critical',
    spent: number,
    limit: number,
    burnRate: BurnRate
  ): string {
    const percent = Math.round((spent / limit) * 100);
    const icon = level === 'critical' ? '🚨' : '⚠️';
    const label = level === 'critical' ? 'CRITICAL' : 'WARNING';

    let message = `${icon} BUDGET ${label}\n\n`;
    message += `Daily budget ${percent}% consumed ($${spent.toFixed(2)} / $${limit.toFixed(2)})\n`;

    if (burnRate.costPerMinute > 0) {
      message += `Current burn rate: $${burnRate.costPerMinute.toFixed(2)}/min\n`;

      if (burnRate.timeToExhaustion) {
        message += `Time until budget exhausted: ${burnRate.timeToExhaustion}\n`;
      }
    }

    return message.trim();
  }

  /**
   * Get all active alerts
   */
  getAlerts(): BudgetAlert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  /**
   * Get all alerts including acknowledged
   */
  getAllAlerts(): BudgetAlert[] {
    return [...this.alerts];
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    this.alerts = [];
    this.lastWarningLevel = 'none';
  }

  /**
   * Calculate budget status
   */
  private calculateBudgetStatus(spent: number): BudgetStatus {
    const limit = this.options.budgetLimit;

    if (limit === 0) {
      return {
        limit: 0,
        spent,
        percentUsed: 0,
        isOverBudget: false,
        warningLevel: 'none',
        remaining: 0,
      };
    }

    const percentUsed = (spent / limit) * 100;
    const isOverBudget = spent > limit;
    const remaining = Math.max(0, limit - spent);

    let warningLevel: 'none' | 'warning' | 'critical' = 'none';
    if (percentUsed >= this.options.criticalThreshold || isOverBudget) {
      warningLevel = 'critical';
    } else if (percentUsed >= this.options.warningThreshold) {
      warningLevel = 'warning';
    }

    return {
      limit,
      spent,
      percentUsed,
      isOverBudget,
      warningLevel,
      remaining,
    };
  }

  /**
   * Reset tracking data
   */
  reset(): void {
    this.workerCosts.clear();
    this.costHistory = [];
    this.alerts = [];
    this.firstEventTs = null;
    this.lastEventTs = null;
    this.lastWarningLevel = 'none';
  }

  /**
   * Set budget limit
   */
  setBudgetLimit(limit: number): void {
    this.options.budgetLimit = limit;
    // Re-check alerts with new limit
    this.checkBudgetAlerts();
  }

  /**
   * Get cost history for the specified time window
   */
  getCostHistory(sinceMinutes: number = 30): Array<{ ts: number; cost: number; worker: string }> {
    const cutoffTs = (this.lastEventTs || Date.now()) - (sinceMinutes * 60 * 1000);
    return this.costHistory.filter(h => h.ts >= cutoffTs);
  }
}

/**
 * Format cost for display
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${(usd * 100).toFixed(2)}c`;
  }
  if (usd < 1) {
    return `$${usd.toFixed(3)}`;
  }
  if (usd < 100) {
    return `$${usd.toFixed(2)}`;
  }
  return `$${usd.toFixed(0)}`;
}

/**
 * Format token count for display
 */
export function formatTokens(count: number): string {
  if (count < 1000) {
    return count.toString();
  }
  if (count < 1_000_000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * Format time to exhaustion
 */
export function formatTimeToExhaustion(minutes: number): string {
  if (minutes < 1) {
    return '< 1m';
  }
  if (minutes < 60) {
    return `~${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) {
    return `~${hours}h`;
  }
  return `~${hours}h ${mins}m`;
}

/**
 * Format burn rate for display
 */
export function formatBurnRate(costPerMinute: number): string {
  if (costPerMinute < 0.01) {
    return `$${(costPerMinute * 100).toFixed(2)}c/min`;
  }
  return `$${costPerMinute.toFixed(2)}/min`;
}

/**
 * Get budget indicator character
 */
export function getBudgetIndicator(status: BudgetStatus): string {
  switch (status.warningLevel) {
    case 'critical':
      return status.isOverBudget ? '🚨' : '⚠️';
    case 'warning':
      return '⚡';
    case 'none':
    default:
      return '';
  }
}

/**
 * Get budget status badge text
 */
export function getBudgetBadge(status: BudgetStatus): string {
  if (status.limit === 0) {
    return '';
  }

  const percent = Math.round(status.percentUsed);
  const icon = getBudgetIndicator(status);

  if (status.isOverBudget) {
    return `${icon} OVER BUDGET`;
  }

  if (status.warningLevel === 'critical') {
    return `${icon} ${percent}% CRITICAL`;
  }

  if (status.warningLevel === 'warning') {
    return `${icon} ${percent}%`;
  }

  return `${percent}%`;
}

/**
 * Format budget alert for display
 */
export function formatBudgetAlert(alert: BudgetAlert): string {
  const lines: string[] = [];

  const icon = alert.type === 'exhausted' ? '🚨' :
               alert.type === 'critical' ? '⚠️' : '⚡';

  lines.push(`${icon} BUDGET ${alert.type.toUpperCase()}`);
  lines.push('');
  lines.push(`Spent: $${alert.spent.toFixed(2)} / $${alert.limit.toFixed(2)}`);
  lines.push(`Burn rate: ${formatBurnRate(alert.burnRate)}`);
  lines.push('');

  if (alert.topConsumers.length > 0) {
    lines.push('Top consumers:');
    for (const consumer of alert.topConsumers) {
      const beadInfo = consumer.currentBead ? ` (${consumer.currentBead})` : '';
      const insightInfo = consumer.insight ? ` - ${consumer.insight}` : '';
      lines.push(`  ${consumer.workerId}${beadInfo}: ${formatCost(consumer.costUsd)}${insightInfo}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a global cost tracker instance
 */
let globalTracker: CostTracker | undefined;

export function getCostTracker(): CostTracker {
  if (!globalTracker) {
    globalTracker = new CostTracker();
  }
  return globalTracker;
}

export function resetCostTracker(): void {
  globalTracker = undefined;
}

/**
 * Cost Tracking Utilities
 *
 * Tracks token usage from log events and calculates estimated costs.
 * Displays total tokens, estimated cost, and per-worker breakdown.
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
}

export interface CostTrackingOptions {
  /** Budget limit in USD (0 = no limit) */
  budgetLimit?: number;

  /** Warning threshold (percent, default 75) */
  warningThreshold?: number;

  /** Critical threshold (percent, default 90) */
  criticalThreshold?: number;

  /** Input cost per 1M tokens (default: $3 for Claude) */
  inputCostPerMillion?: number;

  /** Output cost per 1M tokens (default: $15 for Claude) */
  outputCostPerMillion?: number;
}

const DEFAULT_OPTIONS: Required<CostTrackingOptions> = {
  budgetLimit: 0,
  warningThreshold: 75,
  criticalThreshold: 90,
  inputCostPerMillion: 3.00,   // Claude Sonnet input
  outputCostPerMillion: 15.00, // Claude Sonnet output
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
      };
      this.workerCosts.set(event.worker, workerCost);
    }

    // Update totals
    workerCost.input += tokens.input;
    workerCost.output += tokens.output;
    workerCost.total += tokens.input + tokens.output;
    workerCost.apiCalls += 1;

    // Calculate cost based on model
    const model = (event.model as string) || 'claude-sonnet-4-6';
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-6'];
    workerCost.costUsd =
      (workerCost.input * pricing.input / 1_000_000) +
      (workerCost.output * pricing.output / 1_000_000);
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

    return {
      total: {
        input: totalInput,
        output: totalOutput,
        total: totalInput + totalOutput,
      },
      totalCostUsd,
      byWorker: new Map(this.workerCosts),
      budget,
      timeRange: {
        start: this.firstEventTs || Date.now(),
        end: this.lastEventTs || Date.now(),
      },
    };
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
      };
    }

    const percentUsed = (spent / limit) * 100;
    const isOverBudget = spent > limit;

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
    };
  }

  /**
   * Reset tracking data
   */
  reset(): void {
    this.workerCosts.clear();
    this.firstEventTs = null;
    this.lastEventTs = null;
  }

  /**
   * Set budget limit
   */
  setBudgetLimit(limit: number): void {
    this.options.budgetLimit = limit;
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

/**
 * Tests for Cost Tracking Utilities
 *
 * Covers CostTracker token accounting, per-model cost calculation,
 * and the 80%/95% budget-alert thresholds.
 */

import { describe, it, expect } from 'vitest';
import {
  CostTracker,
  formatCost,
  formatTokens,
  formatTimeToExhaustion,
  formatBurnRate,
  getBudgetIndicator,
  getBudgetBadge,
  formatBudgetAlert,
  getCostTracker,
  resetCostTracker,
  BudgetStatus,
  BudgetAlert,
} from './costTracking.js';
import { LogEvent } from '../../types.js';

// Timestamp 20s into its minute: base + 30s stays in the same 1-min bucket,
// base + 60s crosses into the next one.
const BASE_TS = 1_700_000_000_000;
const MIN = 60 * 1000;

const makeEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
  ts: BASE_TS,
  worker: 'w-alpha',
  level: 'info',
  msg: 'api call',
  ...overrides,
});

// Sonnet output is $15/1M tokens, so N output tokens cost N/1M * $15.
// With a $15 budget, 800_000 output tokens = $12 = exactly 80%.
const OUTPUT_FOR_DOLLARS = (usd: number) => Math.round((usd / 15) * 1_000_000);

describe('Cost Tracking', () => {
  describe('token accounting', () => {
    it('accumulates explicit input_tokens/output_tokens fields', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 100, output_tokens: 50 }));

      const summary = tracker.getSummary();
      expect(summary.total.input).toBe(100);
      expect(summary.total.output).toBe(50);
      expect(summary.total.total).toBe(150);

      const worker = summary.byWorker.get('w-alpha');
      expect(worker).toBeDefined();
      expect(worker!.input).toBe(100);
      expect(worker!.output).toBe(50);
      expect(worker!.total).toBe(150);
      expect(worker!.apiCalls).toBe(1);
      expect(worker!.lastActivityTs).toBe(BASE_TS);
    });

    it('accumulates across multiple events', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 100, output_tokens: 50 }));
      tracker.processEvent(makeEvent({ input_tokens: 200, output_tokens: 70, ts: BASE_TS + MIN }));

      const summary = tracker.getSummary();
      expect(summary.total.input).toBe(300);
      expect(summary.total.output).toBe(120);
      expect(summary.total.total).toBe(420);
      expect(summary.byWorker.get('w-alpha')!.apiCalls).toBe(2);
    });

    it('aggregates totals across multiple workers', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ worker: 'w-alpha', input_tokens: 100, output_tokens: 10 }));
      tracker.processEvent(makeEvent({ worker: 'w-beta', input_tokens: 300, output_tokens: 30 }));

      const summary = tracker.getSummary();
      expect(summary.byWorker.size).toBe(2);
      expect(summary.byWorker.get('w-alpha')!.input).toBe(100);
      expect(summary.byWorker.get('w-beta')!.input).toBe(300);
      expect(summary.total.input).toBe(400);
    });

    it('extracts tokens from a usage object when explicit fields are absent', () => {
      const tracker = new CostTracker();
      tracker.processEvent(
        makeEvent({ usage: { input_tokens: 200, output_tokens: 100 } }),
      );

      const summary = tracker.getSummary();
      expect(summary.total.input).toBe(200);
      expect(summary.total.output).toBe(100);
    });

    it('extracts tokens from the message text as a fallback', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ msg: 'call complete input: 123 output: 456' }));

      const summary = tracker.getSummary();
      expect(summary.total.input).toBe(123);
      expect(summary.total.output).toBe(456);
    });

    it('prefers explicit fields over the usage object', () => {
      const tracker = new CostTracker();
      tracker.processEvent(
        makeEvent({
          input_tokens: 10,
          output_tokens: 5,
          usage: { input_tokens: 999, output_tokens: 999 },
        }),
      );

      const summary = tracker.getSummary();
      expect(summary.total.input).toBe(10);
      expect(summary.total.output).toBe(5);
    });

    it('ignores events without any token information', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ msg: 'no tokens here' }));

      const summary = tracker.getSummary();
      expect(summary.byWorker.size).toBe(0);
      expect(summary.totalCostUsd).toBe(0);
      expect(summary.total.total).toBe(0);
    });

    it('counts an event with zero-valued explicit fields as an API call', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 0, output_tokens: 0 }));

      const worker = tracker.getSummary().byWorker.get('w-alpha');
      expect(worker).toBeDefined();
      expect(worker!.apiCalls).toBe(1);
      expect(worker!.costUsd).toBe(0);
    });

    it('tracks the time range across out-of-order events', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 1, ts: BASE_TS + 5 * MIN }));
      tracker.processEvent(makeEvent({ input_tokens: 1, ts: BASE_TS }));

      const { timeRange } = tracker.getSummary();
      expect(timeRange.start).toBe(BASE_TS);
      expect(timeRange.end).toBe(BASE_TS + 5 * MIN);
    });

    it('follows the worker current bead, keeping it across bead-less events', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ bead: 'fab-1', input_tokens: 10 }));
      expect(tracker.getSummary().byWorker.get('w-alpha')!.currentBead).toBe('fab-1');

      tracker.processEvent(makeEvent({ input_tokens: 10, ts: BASE_TS + MIN }));
      expect(tracker.getSummary().byWorker.get('w-alpha')!.currentBead).toBe('fab-1');

      tracker.processEvent(makeEvent({ bead: 'fab-2', input_tokens: 10, ts: BASE_TS + 2 * MIN }));
      expect(tracker.getSummary().byWorker.get('w-alpha')!.currentBead).toBe('fab-2');
    });

    it('resets all tracking state', () => {
      const tracker = new CostTracker({ budgetLimit: 10 });
      tracker.processEvent(makeEvent({ bead: 'fab-1', output_tokens: OUTPUT_FOR_DOLLARS(9) }));
      expect(tracker.getSummary().totalCostUsd).toBeGreaterThan(0);
      expect(tracker.getAllAlerts().length).toBeGreaterThan(0);

      tracker.reset();

      const summary = tracker.getSummary();
      expect(summary.byWorker.size).toBe(0);
      expect(summary.totalCostUsd).toBe(0);
      expect(summary.budget.warningLevel).toBe('none');
      expect(tracker.getAllAlerts()).toHaveLength(0);
      expect(tracker.getBeadCosts()).toHaveLength(0);
      expect(tracker.getTimeSeries()).toHaveLength(0);
    });
  });

  describe('per-model cost calculation', () => {
    // Each case: one 1M-input event + one 1M-output event for the same worker.
    it.each([
      ['claude-sonnet-4-6', 3.0, 15.0],
      ['claude-opus-4-6', 15.0, 75.0],
      ['claude-haiku-4-5', 0.8, 4.0],
      ['claude-3-5-sonnet', 3.0, 15.0],
      ['claude-3-opus', 15.0, 75.0],
      ['claude-3-haiku', 0.25, 1.25],
      ['gpt-4o', 2.5, 10.0],
      ['gpt-4-turbo', 10.0, 30.0],
      ['gpt-3.5-turbo', 0.5, 1.5],
      ['glm-5', 0.5, 0.5],
    ])('prices %s at $%s input / $%s output per 1M tokens', (model, inputUsd, outputUsd) => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ model, input_tokens: 1_000_000, output_tokens: 0 }));
      tracker.processEvent(
        makeEvent({ model, input_tokens: 0, output_tokens: 1_000_000, ts: BASE_TS + MIN }),
      );

      expect(tracker.getSummary().totalCostUsd).toBeCloseTo(inputUsd + outputUsd, 8);
    });

    it('defaults to claude-sonnet-4-6 pricing when the model is missing', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000, output_tokens: 1_000_000 }));

      expect(tracker.getSummary().totalCostUsd).toBeCloseTo(18.0, 8);
    });

    it('falls back to claude-sonnet-4-6 pricing for unknown models', () => {
      const tracker = new CostTracker();
      tracker.processEvent(
        makeEvent({ model: 'model-from-the-future', input_tokens: 1_000_000, output_tokens: 0 }),
      );

      expect(tracker.getSummary().totalCostUsd).toBeCloseTo(3.0, 8);
    });

    it('splits cost between input and output components', () => {
      const tracker = new CostTracker();
      // Sonnet: 500_000 input = $1.50, 200_000 output = $3.00
      tracker.processEvent(makeEvent({ input_tokens: 500_000, output_tokens: 200_000 }));

      expect(tracker.getSummary().totalCostUsd).toBeCloseTo(4.5, 8);
    });
  });

  describe('budget thresholds (80% warning / 95% critical)', () => {
    // $15 budget with sonnet output pricing: each 100_000 output tokens = $1 = 6.67%.
    const budgetTracker = () => new CostTracker({ budgetLimit: 15 });

    it('reports no warning level below the warning threshold', () => {
      const tracker = budgetTracker();
      tracker.processEvent(
        makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(11.999985) }), // 79.999%
      );

      const budget = tracker.getSummary().budget;
      expect(budget.limit).toBe(15);
      expect(budget.spent).toBeCloseTo(11.999985, 8);
      expect(budget.percentUsed).toBeCloseTo(79.9999, 3);
      expect(budget.warningLevel).toBe('none');
      expect(budget.isOverBudget).toBe(false);
      expect(tracker.getAlerts()).toHaveLength(0);
    });

    it('enters warning exactly at the 80% threshold and emits one warning alert', () => {
      const tracker = budgetTracker();
      tracker.processEvent(makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(12) })); // exactly 80%

      const budget = tracker.getSummary().budget;
      expect(budget.percentUsed).toBeCloseTo(80, 6);
      expect(budget.warningLevel).toBe('warning');
      expect(budget.remaining).toBeCloseTo(3, 8);

      const alerts = tracker.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('warning');
      expect(alerts[0].spent).toBeCloseTo(12, 8);
      expect(alerts[0].limit).toBe(15);
      expect(alerts[0].message).toContain('BUDGET WARNING');
      expect(alerts[0].message).toContain('$12.00 / $15.00');
      expect(alerts[0].topConsumers.length).toBe(1);
    });

    it('does not re-alert while the warning level is unchanged', () => {
      const tracker = budgetTracker();
      tracker.processEvent(makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(12) })); // 80% -> warning
      tracker.processEvent(
        makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(1.5), ts: BASE_TS + MIN }), // 90%, still warning
      );

      expect(tracker.getSummary().budget.warningLevel).toBe('warning');
      expect(tracker.getAllAlerts()).toHaveLength(1);
    });

    it('escalates to critical exactly at the 95% threshold', () => {
      const tracker = budgetTracker();
      tracker.processEvent(makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(12) })); // 80%
      tracker.processEvent(
        makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(2.25), ts: BASE_TS + MIN }), // 95%
      );

      const budget = tracker.getSummary().budget;
      expect(budget.percentUsed).toBeCloseTo(95, 6);
      expect(budget.warningLevel).toBe('critical');
      expect(budget.isOverBudget).toBe(false);

      const alerts = tracker.getAllAlerts();
      expect(alerts).toHaveLength(2);
      expect(alerts[0].type).toBe('warning');
      expect(alerts[1].type).toBe('critical');
      expect(alerts[1].message).toContain('BUDGET CRITICAL');
    });

    it('flags over-budget at 100% spend without exceeding the limit', () => {
      const tracker = budgetTracker();
      tracker.processEvent(makeEvent({ output_tokens: 1_000_000 })); // $15 = exactly the limit

      const budget = tracker.getSummary().budget;
      expect(budget.percentUsed).toBeCloseTo(100, 6);
      expect(budget.warningLevel).toBe('critical');
      expect(budget.isOverBudget).toBe(false); // spent === limit is not "over"
      expect(budget.remaining).toBe(0);
    });

    it('reports over-budget and clamps remaining to zero past the limit', () => {
      const tracker = budgetTracker();
      tracker.processEvent(makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(12) })); // 80%
      tracker.processEvent(
        makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(4), ts: BASE_TS + MIN }), // $16 = 106.7%
      );

      const budget = tracker.getSummary().budget;
      expect(budget.spent).toBeCloseTo(16, 3); // 266_667 output tokens rounds to $4.000005
      expect(budget.isOverBudget).toBe(true);
      expect(budget.warningLevel).toBe('critical');
      expect(budget.remaining).toBe(0);
    });

    it('supports custom thresholds', () => {
      const tracker = new CostTracker({ budgetLimit: 10, warningThreshold: 50, criticalThreshold: 75 });
      tracker.processEvent(makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(6) })); // 60%

      const budget = tracker.getSummary().budget;
      expect(budget.percentUsed).toBeCloseTo(60, 6);
      expect(budget.warningLevel).toBe('warning');

      tracker.processEvent(
        makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(2), ts: BASE_TS + MIN }), // 80%
      );
      expect(tracker.getSummary().budget.warningLevel).toBe('critical');
    });

    it('enforces nothing when the budget limit is 0', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ output_tokens: 5_000_000 })); // $75 of "no budget"

      const budget = tracker.getSummary().budget;
      expect(budget.limit).toBe(0);
      expect(budget.percentUsed).toBe(0);
      expect(budget.warningLevel).toBe('none');
      expect(budget.isOverBudget).toBe(false);
      expect(tracker.getAlerts()).toHaveLength(0);
    });

    it('generates an alert immediately when a limit is set after spend exists', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(12) }));
      expect(tracker.getAlerts()).toHaveLength(0);

      tracker.setBudgetLimit(15); // $12 spent = 80% of the new limit

      const alerts = tracker.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('warning');
    });

    it('acknowledges alerts and clears them', () => {
      const tracker = budgetTracker();
      tracker.processEvent(makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(12) })); // warning
      tracker.processEvent(
        makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(2.25), ts: BASE_TS + MIN }), // critical
      );

      const firstId = tracker.getAllAlerts()[0].id;
      tracker.acknowledgeAlert(firstId);
      expect(tracker.getAllAlerts()).toHaveLength(2);
      expect(tracker.getAlerts()).toHaveLength(1);

      // Unknown ids are a no-op
      tracker.acknowledgeAlert('does-not-exist');
      expect(tracker.getAlerts()).toHaveLength(1);

      tracker.clearAlerts();
      expect(tracker.getAllAlerts()).toHaveLength(0);
      expect(tracker.getAlerts()).toHaveLength(0);

      // After clearing, the level tracker resets so a fresh alert can fire
      tracker.processEvent(
        makeEvent({ output_tokens: OUTPUT_FOR_DOLLARS(0.1), ts: BASE_TS + 2 * MIN }),
      );
      expect(tracker.getAlerts()).toHaveLength(1);
    });
  });

  describe('burn rate', () => {
    it('computes cost per minute over the burn window with EMA smoothing', () => {
      const tracker = new CostTracker();
      // $3 at t0 and $3 at t0+2min: raw rate = $6 / 2min = $3/min over the
      // trailing 5-minute window. Summaries only run when explicitly requested
      // (no budget), so this is the first EMA observation: smoothed = raw.
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000 }));
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000, ts: BASE_TS + 2 * MIN }));

      const burn = tracker.getSummary().burnRate;
      expect(burn.windowMinutes).toBe(5);
      expect(burn.costPerMinute).toBeCloseTo(3, 6);
      expect(burn.isHighBurnRate).toBe(true); // > $0.50/min default
    });

    it('is not high below the high-burn-rate threshold', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 1_000 })); // negligible cost, zero-length window

      const burn = tracker.getSummary().burnRate;
      expect(burn.costPerMinute).toBe(0);
      expect(burn.isHighBurnRate).toBe(false);
    });

    it('projects time to budget exhaustion from the smoothed rate', () => {
      const tracker = new CostTracker({ budgetLimit: 15 });
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000 }));            // $3
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000, ts: BASE_TS + 2 * MIN })); // $6 total

      const burn = tracker.getSummary().burnRate;
      // The EMA state depends on how many summaries have run, so assert
      // self-consistency: exhaustion is remaining budget divided by the
      // reported rate.
      expect(burn.costPerMinute).toBeGreaterThan(0);
      expect(burn.minutesToExhaustion).not.toBeNull();
      expect(burn.minutesToExhaustion!).toBeCloseTo(9 / burn.costPerMinute, 8);
      expect(burn.minutesToExhaustion!).toBeGreaterThan(0);
      expect(burn.timeToExhaustion).toBe(formatTimeToExhaustion(burn.minutesToExhaustion!));
      expect(burn.projectedTotalCost).toBeGreaterThan(6);
    });

    it('reports exhaustion once the budget is spent', () => {
      const tracker = new CostTracker({ budgetLimit: 6 });
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000 }));            // $3
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000, ts: BASE_TS + 2 * MIN })); // $6 total

      const burn = tracker.getSummary().burnRate;
      expect(burn.minutesToExhaustion).toBe(0);
      expect(burn.timeToExhaustion).toBe('exhausted');
    });

    it('omits exhaustion when there is no budget limit', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000 }));
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000, ts: BASE_TS + 2 * MIN }));

      const burn = tracker.getSummary().burnRate;
      expect(burn.minutesToExhaustion).toBeNull();
      expect(burn.timeToExhaustion).toBeNull();
    });

    it('records burn-rate history and cost history', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000 }));
      tracker.processEvent(makeEvent({ input_tokens: 1_000_000, ts: BASE_TS + 2 * MIN }));

      tracker.getSummary(); // summaries record burn-rate history entries
      tracker.getSummary();

      const history = tracker.getBurnRateHistory(60);
      expect(history).toHaveLength(2);
      expect(history[history.length - 1].sampleCount).toBe(2);
      expect(history[history.length - 1].rawRate).toBeCloseTo(3, 6);

      const costHistory = tracker.getCostHistory(30);
      expect(costHistory).toHaveLength(2);
      expect(costHistory.reduce((sum, h) => sum + h.cost, 0)).toBeCloseTo(6, 8);
    });
  });

  describe('time series', () => {
    it('buckets events into 1-minute windows with active-worker counts', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ worker: 'w-alpha', input_tokens: 1_000_000 })); // $3
      tracker.processEvent(
        makeEvent({ worker: 'w-beta', input_tokens: 1_000_000, ts: BASE_TS + 30 * 1000 }), // same bucket
      );
      tracker.processEvent(
        makeEvent({ worker: 'w-alpha', input_tokens: 1_000_000, ts: BASE_TS + 2 * MIN }), // next bucket
      );

      const series = tracker.getTimeSeries(60);
      expect(series).toHaveLength(2);
      expect(series[0].cost).toBeCloseTo(6, 8);
      expect(series[0].apiCalls).toBe(2);
      expect(series[0].activeWorkers).toBe(2);
      expect(series[1].cost).toBeCloseTo(3, 8);
      expect(series[1].apiCalls).toBe(1);
      expect(series[1].activeWorkers).toBe(1);
    });

    it('aggregates into coarser buckets', () => {
      const tracker = new CostTracker();
      // BASE_TS is 220s into its 5-min window; +60s is still inside it, so the
      // two 1-minute buckets merge into one 5-minute bucket.
      tracker.processEvent(makeEvent({ worker: 'w-alpha', input_tokens: 1_000_000 }));
      tracker.processEvent(
        makeEvent({ worker: 'w-beta', input_tokens: 1_000_000, ts: BASE_TS + MIN }),
      );

      const aggregated = tracker.getAggregatedTimeSeries(60, 5);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].cost).toBeCloseTo(6, 8);
      expect(aggregated[0].apiCalls).toBe(2);
      expect(aggregated[0].activeWorkers).toBe(1);
    });
  });

  describe('per-bead and per-worker breakdowns', () => {
    it('attributes cost to beads and sorts by cost descending', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ bead: 'fab-small', input_tokens: 100_000 })); // $0.30
      tracker.processEvent(
        makeEvent({ bead: 'fab-big', worker: 'w-beta', input_tokens: 1_000_000, ts: BASE_TS + MIN }), // $3
      );

      const beads = tracker.getBeadCosts();
      expect(beads.map(b => b.beadId)).toEqual(['fab-big', 'fab-small']);
      expect(beads[0].costUsd).toBeCloseTo(3, 8);
      expect(beads[0].apiCalls).toBe(1);
      expect(beads[0].workers.has('w-beta')).toBe(true);

      expect(tracker.getBeadCost('fab-big')?.input).toBe(1_000_000);
      expect(tracker.getBeadCost('missing')).toBeUndefined();
    });

    it('tracks bead duration and multiple contributing workers', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ bead: 'fab-shared', worker: 'w-alpha', input_tokens: 10 }));
      tracker.processEvent(
        makeEvent({ bead: 'fab-shared', worker: 'w-beta', input_tokens: 10, ts: BASE_TS + 5 * MIN }),
      );

      const bead = tracker.getBeadCost('fab-shared')!;
      expect(bead.workers).toEqual(new Set(['w-alpha', 'w-beta']));
      expect(bead.firstTs).toBe(BASE_TS);
      expect(bead.lastTs).toBe(BASE_TS + 5 * MIN);
      expect(bead.durationMinutes).toBeCloseTo(5, 8);
    });

    it('breaks a worker cost down by bead with percentages', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ bead: 'fab-a', input_tokens: 500_000 })); // $1.50
      tracker.processEvent(
        makeEvent({ bead: 'fab-b', input_tokens: 500_000, ts: BASE_TS + MIN }), // $1.50
      );

      const breakdown = tracker.getWorkerCostBreakdown('w-alpha');
      expect(breakdown).toBeDefined();
      expect(breakdown!.worker.costUsd).toBeCloseTo(3, 8);
      expect(breakdown!.beadCosts).toHaveLength(2);
      expect(breakdown!.beadCosts[0].percentOfWorker).toBeCloseTo(50, 6);
      expect(
        breakdown!.beadCosts.reduce((sum, b) => sum + b.percentOfWorker, 0),
      ).toBeCloseTo(100, 6);

      expect(tracker.getWorkerCostBreakdown('w-unknown')).toBeUndefined();
    });

    it('ranks top consumers with share of total and insights', () => {
      const tracker = new CostTracker();
      tracker.processEvent(makeEvent({ worker: 'w-big', input_tokens: 100, output_tokens: 900_000 }));
      tracker.processEvent(
        makeEvent({ worker: 'w-small', input_tokens: 100_000, output_tokens: 10, ts: BASE_TS + MIN }),
      );

      const consumers = tracker.getTopConsumers(1);
      expect(consumers).toHaveLength(1);
      expect(consumers[0].workerId).toBe('w-big');
      // w-big: 900_000 output = $13.50; w-small: 100_000 input = $0.30 -> 97.8%
      expect(consumers[0].percentOfTotal).toBeCloseTo(97.8, 1);
      expect(consumers[0].insight).toBe('high output token ratio'); // output/total > 0.4
    });

    it('returns no consumers when nothing has been spent', () => {
      const tracker = new CostTracker();
      expect(tracker.getTopConsumers()).toHaveLength(0);
    });
  });

  describe('formatting helpers', () => {
    it('formatCost scales precision with magnitude', () => {
      expect(formatCost(0.005)).toBe('$0.50c');
      expect(formatCost(0.0099)).toBe('$0.99c');
      expect(formatCost(0.5)).toBe('$0.500');
      expect(formatCost(5)).toBe('$5.00');
      expect(formatCost(99.99)).toBe('$99.99');
      expect(formatCost(1234.56)).toBe('$1235');
    });

    it('formatTokens abbreviates large counts', () => {
      expect(formatTokens(0)).toBe('0');
      expect(formatTokens(999)).toBe('999');
      expect(formatTokens(1000)).toBe('1.0K');
      expect(formatTokens(123_456)).toBe('123.5K');
      expect(formatTokens(1_500_000)).toBe('1.50M');
    });

    it('formatTimeToExhaustion renders minutes and hours', () => {
      expect(formatTimeToExhaustion(0.5)).toBe('< 1m');
      expect(formatTimeToExhaustion(45)).toBe('~45m');
      expect(formatTimeToExhaustion(60)).toBe('~1h');
      expect(formatTimeToExhaustion(90)).toBe('~1h 30m');
      expect(formatTimeToExhaustion(120)).toBe('~2h');
    });

    it('formatBurnRate renders cents below a penny per minute', () => {
      expect(formatBurnRate(0.005)).toBe('$0.50c/min');
      expect(formatBurnRate(1.234)).toBe('$1.23/min');
    });
  });

  describe('budget display helpers', () => {
    const status = (overrides: Partial<BudgetStatus>): BudgetStatus => ({
      limit: 10,
      spent: 5,
      percentUsed: 50,
      isOverBudget: false,
      warningLevel: 'none',
      remaining: 5,
      ...overrides,
    });

    it('getBudgetIndicator maps warning levels to icons', () => {
      expect(getBudgetIndicator(status({ warningLevel: 'none' }))).toBe('');
      expect(getBudgetIndicator(status({ warningLevel: 'warning' }))).toBe('⚡');
      expect(getBudgetIndicator(status({ warningLevel: 'critical' }))).toBe('⚠️');
      expect(
        getBudgetIndicator(status({ warningLevel: 'critical', isOverBudget: true })),
      ).toBe('🚨');
    });

    it('getBudgetBadge renders level-specific text', () => {
      expect(getBudgetBadge(status({ limit: 0 }))).toBe('');
      expect(getBudgetBadge(status({ percentUsed: 75 }))).toBe('75%');
      expect(getBudgetBadge(status({ percentUsed: 82, warningLevel: 'warning' }))).toBe('⚡ 82%');
      expect(
        getBudgetBadge(status({ percentUsed: 96, warningLevel: 'critical' })),
      ).toBe('⚠️ 96% CRITICAL');
      expect(
        getBudgetBadge(
          status({ percentUsed: 110, warningLevel: 'critical', isOverBudget: true, remaining: 0 }),
        ),
      ).toBe('🚨 OVER BUDGET');
    });

    it('formatBudgetAlert renders spend, burn rate, and consumers', () => {
      const alert: BudgetAlert = {
        id: 'alert-1',
        type: 'warning',
        message: 'ignored by the formatter',
        timestamp: BASE_TS,
        spent: 12,
        limit: 15,
        burnRate: 0.5,
        topConsumers: [
          { workerId: 'w-alpha', costUsd: 12, percentOfTotal: 100, currentBead: 'fab-1', insight: 'high output token ratio' },
        ],
        acknowledged: false,
      };

      const text = formatBudgetAlert(alert);
      expect(text).toContain('⚡ BUDGET WARNING');
      expect(text).toContain('Spent: $12.00 / $15.00');
      expect(text).toContain('Burn rate: $0.50/min');
      expect(text).toContain('w-alpha (fab-1): $12.00 - high output token ratio');
    });
  });

  describe('global tracker singleton', () => {
    it('returns the same instance until reset', () => {
      resetCostTracker();
      const a = getCostTracker();
      const b = getCostTracker();
      expect(a).toBe(b);

      resetCostTracker();
      expect(getCostTracker()).not.toBe(a);
    });
  });
});

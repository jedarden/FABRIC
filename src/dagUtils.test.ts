/**
 * Tests for FABRIC DAG Utilities — Span DAG
 *
 * Covers buildSpanDag() which reconstructs OTLP span hierarchy from
 * paired .started/.finished LogEvents carrying span_id / parent_span_id.
 */

import { describe, it, expect } from 'vitest';
import { buildSpanDag, findSpansForBead } from './dagUtils.js';
import { normalizeToLogEvent } from './normalizer.js';
import { LogEvent } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────

function spanStartedEvent(overrides: Partial<LogEvent> & { span_id: string }): LogEvent {
  const { span_id, trace_id, parent_span_id, span_name, bead, ...rest } = overrides;
  return {
    ts: 1000,
    worker: 'tcb-alpha',
    level: 'info',
    msg: 'bead.lifecycle.started',
    span_id,
    trace_id: trace_id ?? 'trace-1',
    parent_span_id,
    span_name: span_name ?? 'bead.lifecycle',
    bead,
    session: 'sess-1',
    ...rest,
  };
}

function spanFinishedEvent(overrides: Partial<LogEvent> & { span_id: string }): LogEvent {
  const { span_id, trace_id, parent_span_id, span_name, bead, duration_ms, ...rest } = overrides;
  return {
    ts: 2000,
    worker: 'tcb-alpha',
    level: 'info',
    msg: 'bead.lifecycle.finished',
    span_id,
    trace_id: trace_id ?? 'trace-1',
    parent_span_id,
    span_name: span_name ?? 'bead.lifecycle',
    bead,
    duration_ms: duration_ms ?? 1000,
    session: 'sess-1',
    ...rest,
  };
}

// ── buildSpanDag ──────────────────────────────────────────────────

describe('buildSpanDag', () => {
  it('builds a single root span from started/finished pair', () => {
    const events = [
      spanStartedEvent({ span_id: 'span-1', trace_id: 'trace-1' }),
      spanFinishedEvent({ span_id: 'span-1', trace_id: 'trace-1', duration_ms: 500 }),
    ];
    const dag = buildSpanDag(events);

    expect(dag.roots).toHaveLength(1);
    expect(dag.roots[0].span_id).toBe('span-1');
    expect(dag.roots[0].start_ts).toBe(1000);
    expect(dag.roots[0].end_ts).toBe(2000);
    expect(dag.roots[0].duration_ms).toBe(500);
    expect(dag.roots[0].status).toBe('ok');
    expect(dag.roots[0].trace_id).toBe('trace-1');
    expect(dag.allSpans.size).toBe(1);
  });

  it('builds parent-child relationship from parent_span_id', () => {
    const events = [
      spanStartedEvent({ span_id: 'parent', trace_id: 'trace-1', span_name: 'bead.lifecycle' }),
      spanStartedEvent({ span_id: 'child-1', trace_id: 'trace-1', parent_span_id: 'parent', span_name: 'tool.call', msg: 'tool.call.started' }),
      spanFinishedEvent({ span_id: 'child-1', trace_id: 'trace-1', parent_span_id: 'parent', span_name: 'tool.call', msg: 'tool.call.finished', duration_ms: 200 }),
      spanStartedEvent({ span_id: 'child-2', trace_id: 'trace-1', parent_span_id: 'parent', span_name: 'llm.request', msg: 'llm.request.started' }),
      spanFinishedEvent({ span_id: 'child-2', trace_id: 'trace-1', parent_span_id: 'parent', span_name: 'llm.request', msg: 'llm.request.finished', duration_ms: 800 }),
      spanFinishedEvent({ span_id: 'parent', trace_id: 'trace-1', span_name: 'bead.lifecycle', duration_ms: 1000 }),
    ];
    const dag = buildSpanDag(events);

    expect(dag.roots).toHaveLength(1);
    const root = dag.roots[0];
    expect(root.span_id).toBe('parent');
    expect(root.children).toHaveLength(2);
    expect(root.children.map(c => c.span_id)).toEqual(expect.arrayContaining(['child-1', 'child-2']));
    expect(root.children.map(c => c.name)).toEqual(expect.arrayContaining(['tool.call', 'llm.request']));
    expect(dag.allSpans.size).toBe(3);
  });

  it('groups spans by trace_id', () => {
    const events = [
      spanStartedEvent({ span_id: 's1', trace_id: 'trace-a' }),
      spanFinishedEvent({ span_id: 's1', trace_id: 'trace-a' }),
      spanStartedEvent({ span_id: 's2', trace_id: 'trace-b' }),
      spanFinishedEvent({ span_id: 's2', trace_id: 'trace-b' }),
    ];
    const dag = buildSpanDag(events);

    expect(dag.traces.size).toBe(2);
    expect(dag.traces.get('trace-a')!.map(s => s.span_id)).toEqual(['s1']);
    expect(dag.traces.get('trace-b')!.map(s => s.span_id)).toEqual(['s2']);
  });

  it('marks error status from error field', () => {
    const events = [
      spanStartedEvent({ span_id: 's-err', trace_id: 'trace-1' }),
      spanFinishedEvent({ span_id: 's-err', trace_id: 'trace-1', error: 'timeout' }),
    ];
    const dag = buildSpanDag(events);

    expect(dag.roots[0].status).toBe('error');
  });

  it('handles orphaned spans (parent not found)', () => {
    const events = [
      spanStartedEvent({ span_id: 'orphan', trace_id: 'trace-1', parent_span_id: 'missing-parent' }),
      spanFinishedEvent({ span_id: 'orphan', trace_id: 'trace-1', parent_span_id: 'missing-parent' }),
    ];
    const dag = buildSpanDag(events);

    // Orphan with missing parent becomes a root
    expect(dag.roots).toHaveLength(1);
    expect(dag.roots[0].span_id).toBe('orphan');
  });

  it('returns empty dag for events without span_id', () => {
    const events: LogEvent[] = [
      { ts: 1000, worker: 'w-1', level: 'info', msg: 'worker.started' },
    ];
    const dag = buildSpanDag(events);

    expect(dag.roots).toHaveLength(0);
    expect(dag.allSpans.size).toBe(0);
    expect(dag.traces.size).toBe(0);
  });

  it('handles nested span hierarchy (grandchild)', () => {
    const events = [
      spanStartedEvent({ span_id: 'root', trace_id: 't1', span_name: 'bead.lifecycle' }),
      spanStartedEvent({ span_id: 'child', trace_id: 't1', parent_span_id: 'root', span_name: 'tool.call', msg: 'tool.call.started' }),
      spanStartedEvent({ span_id: 'grandchild', trace_id: 't1', parent_span_id: 'child', span_name: 'llm.request', msg: 'llm.request.started' }),
      spanFinishedEvent({ span_id: 'grandchild', trace_id: 't1', parent_span_id: 'child', span_name: 'llm.request', msg: 'llm.request.finished', duration_ms: 100 }),
      spanFinishedEvent({ span_id: 'child', trace_id: 't1', parent_span_id: 'root', span_name: 'tool.call', msg: 'tool.call.finished', duration_ms: 300 }),
      spanFinishedEvent({ span_id: 'root', trace_id: 't1', span_name: 'bead.lifecycle', duration_ms: 1000 }),
    ];
    const dag = buildSpanDag(events);

    expect(dag.roots).toHaveLength(1);
    const root = dag.roots[0];
    expect(root.span_id).toBe('root');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].span_id).toBe('child');
    expect(root.children[0].children).toHaveLength(1);
    expect(root.children[0].children[0].span_id).toBe('grandchild');
  });

  it('stores extra event fields in span attributes', () => {
    const events = [
      spanStartedEvent({
        span_id: 's-attrs',
        trace_id: 'trace-1',
        tool: 'Bash',
      } as any),
    ];
    const dag = buildSpanDag(events);

    // 'tool' is in the reserved set, so it should NOT be in attributes
    expect(dag.allSpans.get('s-attrs')!.attributes).not.toHaveProperty('tool');
  });
});

// ── findSpansForBead ──────────────────────────────────────────────

describe('findSpansForBead', () => {
  it('finds spans associated with a bead ID', () => {
    const events = [
      spanStartedEvent({ span_id: 's1', trace_id: 'trace-1', bead: 'bd-abc' }),
      spanFinishedEvent({ span_id: 's1', trace_id: 'trace-1', bead: 'bd-abc' }),
      spanStartedEvent({ span_id: 's2', trace_id: 'trace-1', bead: 'bd-xyz' }),
    ];
    const dag = buildSpanDag(events);
    const spans = findSpansForBead(dag, 'bd-abc');

    expect(spans).toHaveLength(1);
    expect(spans[0].span_id).toBe('s1');
  });

  it('returns empty array when no spans match', () => {
    const events = [
      spanStartedEvent({ span_id: 's1', trace_id: 'trace-1' }),
    ];
    const dag = buildSpanDag(events);
    const spans = findSpansForBead(dag, 'bd-nonexistent');

    expect(spans).toHaveLength(0);
  });
});

// ── Full pipeline: OTLP span → normalizer → buildSpanDag ──────────

describe('OTLP span → DAG integration', () => {
  it('bead lifecycle span renders as DAG node with tool-call children', () => {
    // Simulate an OTLP trace export: a bead.lifecycle root span with
    // two child spans (tool.call and llm.request) as NEEDLE would emit.

    // 1. Root span: bead.lifecycle for bd-integ
    const rootStartSpan = {
      name: 'bead.lifecycle',
      traceId: 'trace-integ-001',
      spanId: 'root-span',
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-integ' } },
        { key: 'bead_id', value: { stringValue: 'bd-integ' } },
      ],
    };

    const rootEndSpan = {
      name: 'bead.lifecycle',
      traceId: 'trace-integ-001',
      spanId: 'root-span',
      startTimeUnixNano: '1772641054008000000',
      endTimeUnixNano: '1772641060000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-integ' } },
        { key: 'bead_id', value: { stringValue: 'bd-integ' } },
      ],
    };

    // 2. Child span: tool.call
    const toolStartSpan = {
      name: 'tool.call',
      traceId: 'trace-integ-001',
      spanId: 'tool-span-1',
      parentSpanId: 'root-span',
      startTimeUnixNano: '1772641055000000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'tool', value: { stringValue: 'Bash' } },
      ],
    };

    const toolEndSpan = {
      name: 'tool.call',
      traceId: 'trace-integ-001',
      spanId: 'tool-span-1',
      parentSpanId: 'root-span',
      startTimeUnixNano: '1772641055000000000',
      endTimeUnixNano: '1772641057000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'tool', value: { stringValue: 'Bash' } },
      ],
    };

    // 3. Child span: llm.request
    const llmStartSpan = {
      name: 'llm.request',
      traceId: 'trace-integ-001',
      spanId: 'llm-span-1',
      parentSpanId: 'root-span',
      startTimeUnixNano: '1772641057100000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'provider', value: { stringValue: 'anthropic' } },
        { key: 'model', value: { stringValue: 'sonnet' } },
      ],
    };

    const llmEndSpan = {
      name: 'llm.request',
      traceId: 'trace-integ-001',
      spanId: 'llm-span-1',
      parentSpanId: 'root-span',
      startTimeUnixNano: '1772641057100000000',
      endTimeUnixNano: '1772641059000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'provider', value: { stringValue: 'anthropic' } },
        { key: 'model', value: { stringValue: 'sonnet' } },
      ],
    };

    // Normalize all spans through the OTLP pipeline
    const events: LogEvent[] = [];
    for (const [startRaw, endRaw] of [
      [rootStartSpan, rootEndSpan],
      [toolStartSpan, toolEndSpan],
      [llmStartSpan, llmEndSpan],
    ]) {
      const startEvent = normalizeToLogEvent(startRaw, 'otlp-span-start');
      const endEvent = normalizeToLogEvent(endRaw, 'otlp-span-end');
      if (startEvent) events.push(startEvent);
      if (endEvent) events.push(endEvent);
    }

    // Build the span DAG from the normalized events
    const dag = buildSpanDag(events);

    // Verify: one root node (bead.lifecycle)
    expect(dag.roots).toHaveLength(1);
    const root = dag.roots[0];
    expect(root.span_id).toBe('root-span');
    expect(root.name).toBe('bead.lifecycle');
    expect(root.trace_id).toBe('trace-integ-001');
    expect(root.bead_id).toBe('bd-integ');
    expect(root.worker_id).toBe('tcb-alpha');
    expect(root.status).toBe('ok');
    expect(root.duration_ms).toBe(5992);

    // Verify: root has two children (tool.call and llm.request)
    expect(root.children).toHaveLength(2);
    const toolChild = root.children.find(c => c.name === 'tool.call');
    const llmChild = root.children.find(c => c.name === 'llm.request');
    expect(toolChild).toBeDefined();
    expect(llmChild).toBeDefined();
    expect(toolChild!.parent_span_id).toBe('root-span');
    expect(llmChild!.parent_span_id).toBe('root-span');

    // Verify: trace grouping
    expect(dag.traces.size).toBe(1);
    expect(dag.traces.get('trace-integ-001')!.length).toBe(3);

    // Verify: findSpansForBead works
    const beadSpans = findSpansForBead(dag, 'bd-integ');
    expect(beadSpans).toHaveLength(1);
    expect(beadSpans[0].span_id).toBe('root-span');
  });

  it('event_type is {name}.started/.finished through full pipeline', () => {
    const span = {
      name: 'bead.lifecycle',
      traceId: 'trace-et',
      spanId: 'span-et',
      startTimeUnixNano: '1772641054008000000',
      endTimeUnixNano: '1772641058000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'bead_id', value: { stringValue: 'bd-et' } },
      ],
    };

    const startEvent = normalizeToLogEvent(span, 'otlp-span-start')!;
    const endEvent = normalizeToLogEvent(span, 'otlp-span-end')!;

    expect(startEvent.msg).toBe('bead.lifecycle.started');
    expect(endEvent.msg).toBe('bead.lifecycle.finished');
    expect(startEvent.span_id).toBe('span-et');
    expect(endEvent.span_id).toBe('span-et');
  });
});

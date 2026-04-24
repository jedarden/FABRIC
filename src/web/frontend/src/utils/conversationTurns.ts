import { LogEvent, ConversationTurn, ConversationTurnRole } from '../types';

/**
 * Convert LogEvents into ConversationTurns grouped by bead.
 *
 * Mapping strategy:
 *   - bead.prompt_built / bead.claimed           → user (the worker received a task)
 *   - bead.agent_started / strand.started         → system
 *   - bead.agent_completed / strand.completed     → assistant
 *   - events with tool field                      → tool
 *   - worker.state_transition                     → system
 *   - error.*                                     → system (error)
 *   - everything else                             → system
 */
export function logEventsToTurns(events: LogEvent[]): ConversationTurn[] {
  const sorted = [...events].sort((a, b) => {
    const seqA = a.sequence ?? a.ts;
    const seqB = b.sequence ?? b.ts;
    return seqA - seqB;
  });

  return sorted.map((event, i) => {
    const { role, isCollapsible } = classifyEvent(event);
    const content = extractContent(event);

    return {
      id: `${event.worker}-${event.sequence ?? i}`,
      role,
      eventType: event.msg || event.level,
      timestamp: event.ts ?? new Date(event.timestamp).getTime(),
      content,
      isCollapsible,
      isCollapsed: isCollapsible,
      tool: event.tool,
      durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
      error: event.error,
      success: !event.error,
      sequence: event.sequence,
      meta: buildMeta(event),
    };
  });
}

function classifyEvent(event: LogEvent): { role: ConversationTurnRole; isCollapsible: boolean } {
  const msg = (event.msg || '').toLowerCase();
  const eventType = (event.msg || '');

  // Tool events
  if (event.tool) {
    return { role: 'tool', isCollapsible: true };
  }

  // User prompt — the worker received a bead to work on
  if (
    eventType === 'bead.prompt_built' ||
    eventType === 'bead.claimed' ||
    eventType === 'bead.agent_started'
  ) {
    return { role: 'user', isCollapsible: false };
  }

  // Assistant responses
  if (
    eventType === 'bead.agent_completed' ||
    eventType === 'bead.completed' ||
    eventType === 'strand.completed'
  ) {
    return { role: 'assistant', isCollapsible: false };
  }

  // System events with long content
  if (msg.includes('error') || eventType.startsWith('error.')) {
    return { role: 'system', isCollapsible: !!event.error };
  }

  return { role: 'system', isCollapsible: false };
}

function extractContent(event: LogEvent): string {
  const msg = event.msg || '';

  // Tool events: show tool name + any context from raw
  if (event.tool) {
    const raw = typeof event.raw === 'string' ? event.raw : '';
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.data) {
          const dataStr =
            typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data, null, 2);
          // Limit to first 500 chars
          return dataStr.length > 500 ? dataStr.slice(0, 500) + '...' : dataStr;
        }
      } catch {
        // fall through
      }
    }
    return msg || `Tool: ${event.tool}`;
  }

  // For bead events, try to extract meaningful content
  const raw = typeof event.raw === 'string' ? event.raw : '';
  if (raw && (msg === 'bead.prompt_built' || msg === 'bead.agent_completed')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.data) {
        if (typeof parsed.data === 'string') {
          return parsed.data.length > 500
            ? parsed.data.slice(0, 500) + '...'
            : parsed.data;
        }
        // For objects, check common content fields
        const data = parsed.data as Record<string, unknown>;
        if (typeof data.content === 'string') return truncate(data.content, 500);
        if (typeof data.prompt === 'string') return truncate(data.prompt, 500);
        if (typeof data.message === 'string') return truncate(data.message, 500);
        if (typeof data.result === 'string') return truncate(data.result, 500);
        const str = JSON.stringify(data, null, 2);
        return truncate(str, 500);
      }
    } catch {
      // fall through
    }
  }

  return event.message || msg;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function buildMeta(event: LogEvent): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (event.bead) meta.bead = event.bead;
  if (event.path) meta.path = event.path;
  if (event.provider) meta.provider = event.provider;
  if (event.model) meta.model = event.model;
  if (event.session) meta.session = event.session;
  return meta;
}

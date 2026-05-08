/**
 * FABRIC Conversation Transcript Parser
 *
 * Extracts full conversation transcripts from NEEDLE logs.
 * Parses OTLP span events (llm.request, tool.call, etc.) into structured conversation events.
 *
 * Data sources:
 * - llm.request.started/finished spans contain prompts, responses, thinking blocks
 * - tool.call.started/finished spans contain tool invocations and results
 * - bead.lifecycle spans provide session context (bead_id, worker_id)
 */

import {
  LogEvent,
  ConversationEvent,
  ConversationSession,
  PromptEvent,
  ResponseEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolResultEvent,
  ConversationEventType,
  ConversationRole,
  ToolArgValue,
} from './types.js';

// ============================================
// Types
// ============================================

/**
 * Span event name patterns that indicate conversation content
 */
const CONVERSATION_SPAN_NAMES = [
  'llm.request',
  'llm.prompt',
  'llm.response',
  'llm.completion',
  'llm.chat',
  'tool.call',
  'tool.invocation',
  'tool.result',
  'tool.response',
  'bead.prompt_built',
  'bead.agent_started',
  'bead.agent_completed',
] as const;

/**
 * Message event types from spans
 */
type SpanMessageType =
  | 'user'
  | 'system'
  | 'assistant'
  | 'tool';

/**
 * Parsed span message with content and metadata
 */
interface ParsedSpanMessage {
  type: SpanMessageType;
  content: string;
  timestamp: number;
  sequence?: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  toolError?: string;
  isThinking?: boolean;
  tokens?: number;
  model?: string;
}

// ============================================
// Span Message Extraction
// ============================================

/**
 * Check if a LogEvent is a conversation-related span event
 */
export function isConversationSpanEvent(event: LogEvent): boolean {
  const msg = event.msg.toLowerCase();
  const spanName = String(event.span_name || '').toLowerCase();

  // Check span_name first (most reliable)
  for (const pattern of CONVERSATION_SPAN_NAMES) {
    if (spanName.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Check message patterns
  if (
    msg.includes('llm.request') ||
    msg.includes('llm.prompt') ||
    msg.includes('llm.response') ||
    msg.includes('llm.completion') ||
    msg.includes('tool.call') ||
    msg.includes('tool.invocation') ||
    msg.includes('tool.result') ||
    msg.includes('bead.prompt_built') ||
    msg.includes('bead.agent_started') ||
    msg.includes('bead.agent_completed')
  ) {
    return true;
  }

  // Check for conversation attributes
  if (
    event.prompt ||
    event.response ||
    event.user_message ||
    event.assistant_message ||
    event.tool_name ||
    event.conversation_role
  ) {
    return true;
  }

  return false;
}

/**
 * Extract conversation data from span event attributes
 */
function extractSpanMessage(event: LogEvent): ParsedSpanMessage | null {
  // Try direct fields first
  if (event.prompt || event.user_message) {
    return {
      type: 'user',
      content: (event.prompt || event.user_message) as string,
      timestamp: event.ts,
      sequence: event.sequence,
    };
  }

  if (event.response || event.assistant_message) {
    // Check if it's a thinking block
    const content = (event.response || event.assistant_message) as string;
    const isThinking = event.thinking === true || event.is_thinking === true;

    return {
      type: 'assistant',
      content,
      timestamp: event.ts,
      sequence: event.sequence,
      isThinking,
      tokens: event.tokens as number | undefined,
      model: event.model as string | undefined,
    };
  }

  // Check for tool call
  if (event.tool_name || event.tool) {
    const toolName = (event.tool_name || event.tool) as string;

    // Check if this is a tool call invocation or result
    if (event.msg.includes('started') || event.tool_args || event.args) {
      return {
        type: 'tool',
        content: `Calling ${toolName}`,
        timestamp: event.ts,
        sequence: event.sequence,
        toolName,
        toolArgs: (event.tool_args || event.args || event.arguments) as Record<string, unknown> | undefined,
      };
    }

    // Tool result
    if (event.msg.includes('finished') || event.result || event.tool_result) {
      const content = (event.result || event.tool_result || '') as string;
      return {
        type: 'tool',
        content: content || 'Tool completed',
        timestamp: event.ts,
        sequence: event.sequence,
        toolName,
        toolResult: content,
        toolError: event.error as string | undefined,
      };
    }
  }

  // Try to extract from data field (for OTLP span attributes)
  const data = event.data as Record<string, unknown> | undefined;
  if (data) {
    // Check for LLM request/response in attributes
    if (data.prompt || data.user_message || data['llm.prompt']) {
      return {
        type: 'user',
        content: (data.prompt || data.user_message || data['llm.prompt']) as string,
        timestamp: event.ts,
        sequence: event.sequence,
      };
    }

    if (data.response || data.assistant_message || data.completion || data['llm.response']) {
      const content = (data.response || data.assistant_message || data.completion || data['llm.response']) as string;
      return {
        type: 'assistant',
        content,
        timestamp: event.ts,
        sequence: event.sequence,
        isThinking: data.thinking === true || data.is_thinking === true,
        tokens: data.tokens as number | undefined,
        model: data.model as string | undefined,
      };
    }

    // Check for tool call in attributes
    if (data.tool_name || data.tool || data['tool.name']) {
      const toolName = (data.tool_name || data.tool || data['tool.name']) as string;

      if (event.msg.includes('started') || data.tool_args || data.args || data['tool.arguments']) {
        return {
          type: 'tool',
          content: `Calling ${toolName}`,
          timestamp: event.ts,
          sequence: event.sequence,
          toolName,
          toolArgs: (data.tool_args || data.args || data['tool.arguments']) as Record<string, unknown> | undefined,
        };
      }

      if (event.msg.includes('finished') || data.result || data.tool_result || data['tool.result']) {
        const content = (data.result || data.tool_result || data['tool.result'] || '') as string;
        return {
          type: 'tool',
          content: content || 'Tool completed',
          timestamp: event.ts,
          sequence: event.sequence,
          toolName,
          toolResult: content,
          toolError: data.error as string | undefined,
        };
      }
    }
  }

  return null;
}

// ============================================
// Conversation Event Construction
// ============================================

let eventIdCounter = 0;

function generateEventId(): string {
  return `conv-${Date.now()}-${++eventIdCounter}`;
}

/**
 * Convert a parsed span message to a ConversationEvent
 */
function parsedMessageToConversationEvent(
  message: ParsedSpanMessage,
  worker: string,
  bead?: string
): ConversationEvent | null {
  const baseEvent = {
    id: generateEventId(),
    ts: message.timestamp,
    worker,
    bead,
    sequence: message.sequence ?? 0,
  };

  switch (message.type) {
    case 'user': {
      const promptEvent: PromptEvent = {
        ...baseEvent,
        type: 'prompt',
        role: 'user',
        content: message.content,
        tokens: message.tokens,
      };
      return promptEvent;
    }

    case 'assistant': {
      if (message.isThinking) {
        const thinkingEvent: ThinkingEvent = {
          ...baseEvent,
          type: 'thinking',
          role: 'assistant',
          content: message.content,
          isTruncated: false,
          tokens: message.tokens,
          durationMs: undefined,
        };
        return thinkingEvent;
      }

      const responseEvent: ResponseEvent = {
        ...baseEvent,
        type: 'response',
        role: 'assistant',
        content: message.content,
        isTruncated: false,
        model: message.model,
        tokens: message.tokens,
      };
      return responseEvent;
    }

    case 'tool': {
      if (message.toolArgs && message.toolName) {
        const toolCallEvent: ToolCallEvent = {
          ...baseEvent,
          type: 'tool_call',
          role: 'assistant',
          tool: message.toolName,
          args: message.toolArgs as Record<string, ToolArgValue>,
          summary: generateToolSummary(message.toolName, message.toolArgs),
        };
        return toolCallEvent;
      }

      if (message.toolName && message.toolResult !== undefined) {
        const toolResultEvent: ToolResultEvent = {
          ...baseEvent,
          type: 'tool_result',
          role: 'tool',
          tool: message.toolName,
          content: message.toolResult,
          success: !message.toolError,
          error: message.toolError,
          isTruncated: false,
          resultSize: message.toolResult.length,
        };
        return toolResultEvent;
      }

      return null;
    }

    default:
      return null;
  }
}

/**
 * Generate a human-readable summary for a tool call
 */
function generateToolSummary(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `Read ${args.file_path || args.path || 'file'}`;
    case 'Edit':
      return `Edit ${args.file_path || args.path || 'file'}`;
    case 'Write':
      return `Write ${args.file_path || args.path || 'file'}`;
    case 'Bash':
      return `Run: ${(args.command as string)?.slice(0, 50) || 'command'}`;
    case 'Grep':
      return `Search: ${args.pattern || 'pattern'}`;
    case 'Glob':
      return `Find: ${args.pattern || 'files'}`;
    default:
      return `${tool}()`;
  }
}

// ============================================
// Session Building
// ============================================

/**
 * Build a ConversationSession from a list of log events
 *
 * Groups events by (worker, bead, session) and extracts conversation
 * data from span events within each session.
 */
export function buildConversationSessions(
  events: LogEvent[]
): ConversationSession[] {
  // Group events by potential session keys
  const sessionGroups = groupEventsBySession(events);
  const sessions: ConversationSession[] = [];

  for (const [sessionKey, sessionEvents] of sessionGroups) {
    const session = buildSessionFromEvents(sessionKey, sessionEvents);
    if (session && session.events.length > 0) {
      sessions.push(session);
    }
  }

  return sessions;
}

/**
 * Session key for grouping events
 */
interface SessionKey {
  worker: string;
  bead?: string;
  session?: string;
}

function sessionKeyToString(key: SessionKey): string {
  return `${key.worker}:${key.bead || 'none'}:${key.session || 'none'}`;
}

/**
 * Group events by (worker, bead, session)
 */
function groupEventsBySession(events: LogEvent[]): Map<string, LogEvent[]> {
  const groups = new Map<string, LogEvent[]>();

  for (const event of events) {
    // Skip events that aren't conversation-related
    if (!isConversationSpanEvent(event)) {
      continue;
    }

    const key: SessionKey = {
      worker: event.worker,
      bead: event.bead,
      session: event.session,
    };

    const keyStr = sessionKeyToString(key);
    const group = groups.get(keyStr) || [];
    group.push(event);
    groups.set(keyStr, group);
  }

  return groups;
}

/**
 * Build a single ConversationSession from grouped events
 */
function buildSessionFromEvents(
  sessionKey: string,
  events: LogEvent[]
): ConversationSession | null {
  if (events.length === 0) return null;

  // Sort by sequence or timestamp
  const sorted = [...events].sort((a, b) => {
    const seqA = a.sequence ?? a.ts;
    const seqB = b.sequence ?? b.ts;
    return seqA - seqB;
  });

  // Extract conversation events
  const conversationEvents: ConversationEvent[] = [];
  let sequence = 0;

  for (const event of sorted) {
    const message = extractSpanMessage(event);
    if (!message) continue;

    message.sequence = sequence++;

    const convEvent = parsedMessageToConversationEvent(
      message,
      event.worker,
      event.bead
    );

    if (convEvent) {
      conversationEvents.push(convEvent);
    }
  }

  if (conversationEvents.length === 0) {
    return null;
  }

  // Build session metadata
  const firstEvent = sorted[0];
  const lastEvent = sorted[sorted.length - 1];

  // Extract worker, bead, session from first event
  const workerId = firstEvent.worker;
  const beadId = firstEvent.bead;
  const sessionId = firstEvent.session || `${workerId}-${firstEvent.ts}`;

  // Calculate tokens
  const totalTokens = conversationEvents.reduce((sum, e) => sum + (e.tokens || 0), 0);

  // Extract tools used
  const toolsUsed = [
    ...new Set(
      conversationEvents
        .filter((e): e is ToolCallEvent => e.type === 'tool_call')
        .map((e) => e.tool)
    ),
  ];

  // Count turns (prompt + response pairs)
  let turnCount = 0;
  let inTurn = false;
  for (const event of conversationEvents) {
    if (event.type === 'prompt') {
      inTurn = true;
    } else if (event.type === 'response' && inTurn) {
      turnCount++;
      inTurn = false;
    }
  }

  return {
    id: sessionId,
    workerId,
    beadId,
    startTime: firstEvent.ts,
    endTime: lastEvent.ts,
    events: conversationEvents,
    totalTokens,
    turnCount,
    toolsUsed,
    isActive: false, // Sessions from historical logs are complete
  };
}

/**
 * Get conversation sessions for a specific worker
 */
export function getWorkerConversationSessions(
  events: LogEvent[],
  workerId: string
): ConversationSession[] {
  const workerEvents = events.filter(e => e.worker === workerId);
  return buildConversationSessions(workerEvents);
}

/**
 * Get conversation session for a specific bead
 */
export function getBeadConversationSession(
  events: LogEvent[],
  beadId: string
): ConversationSession | null {
  const beadEvents = events.filter(e => e.bead === beadId);
  const sessions = buildConversationSessions(beadEvents);
  return sessions[0] || null;
}

/**
 * Extract conversation events from a list of log events
 *
 * This is the main entry point for getting conversation data
 * from raw log events.
 */
export function extractConversationEvents(
  events: LogEvent[]
): ConversationEvent[] {
  const sessions = buildConversationSessions(events);
  const allEvents: ConversationEvent[] = [];

  for (const session of sessions) {
    allEvents.push(...session.events);
  }

  // Sort all events by timestamp/sequence
  return allEvents.sort((a, b) => {
    const seqA = a.sequence ?? a.ts;
    const seqB = b.sequence ?? b.ts;
    return seqA - seqB;
  });
}

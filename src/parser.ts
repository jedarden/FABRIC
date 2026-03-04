/**
 * FABRIC Log Parser
 *
 * Parses NEEDLE log lines into structured LogEvent objects.
 * Also extracts conversation events from log entries.
 */

import {
  LogEvent,
  LogLevel,
  ConversationEvent,
  PromptEvent,
  ResponseEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolResultEvent,
  ConversationParseOptions,
} from './types.js';

/**
 * Parse a single log line
 *
 * Supports two formats:
 * 1. NEEDLE format: {ts: ISO string, event: string, worker: {...}, session: string, data: {...}}
 * 2. Legacy format: {ts: Unix ms, worker: string, level: string, msg: string}
 *
 * @param line - Raw log line (JSON string)
 * @returns Parsed LogEvent or null if invalid
 */
export function parseLogLine(line: string): LogEvent | null {
  // Skip empty lines
  if (!line || !line.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(line);

    // Detect format and route to appropriate parser
    if (isNeedleFormat(parsed)) {
      return parseNeedleFormat(parsed);
    }

    // Legacy format validation
    if (typeof parsed.ts !== 'number') {
      return null;
    }
    if (typeof parsed.worker !== 'string') {
      return null;
    }
    if (!isValidLogLevel(parsed.level)) {
      return null;
    }
    if (typeof parsed.msg !== 'string') {
      return null;
    }

    // Construct LogEvent with validated fields
    const event: LogEvent = {
      ts: parsed.ts,
      worker: parsed.worker,
      level: parsed.level,
      msg: parsed.msg,
    };

    // Copy optional fields if present
    if (typeof parsed.tool === 'string') event.tool = parsed.tool;
    if (typeof parsed.path === 'string') event.path = parsed.path;
    if (typeof parsed.bead === 'string') event.bead = parsed.bead;
    if (typeof parsed.duration_ms === 'number') event.duration_ms = parsed.duration_ms;
    if (typeof parsed.error === 'string') event.error = parsed.error;

    // Copy any additional fields
    for (const key of Object.keys(parsed)) {
      if (!isStandardField(key) && !(key in event)) {
        event[key] = parsed[key];
      }
    }

    return event;
  } catch {
    // Not valid JSON
    return null;
  }
}

/**
 * NEEDLE log format interface
 */
interface NeedleLogEntry {
  ts: string;                    // ISO 8601 timestamp
  event: string;                 // Event type (e.g., "worker.started", "bead.claimed")
  session: string;               // Session identifier
  worker: {
    runner: string;              // e.g., "claude"
    provider: string;            // e.g., "code", "anthropic"
    model: string;               // e.g., "glm-4.7", "sonnet"
    identifier: string;          // e.g., "test", "align"
  };
  data: Record<string, unknown>; // Event-specific payload
}

/**
 * Check if parsed object matches NEEDLE format
 */
function isNeedleFormat(parsed: unknown): parsed is NeedleLogEntry {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;

  // NEEDLE format has: ts (string), event (string), worker (object or string)
  // Worker can be either:
  //   - Object: {runner, provider, model, identifier} (legacy)
  //   - String: "runner-provider-model-identifier" (aligned format)
  return (
    typeof obj.ts === 'string' &&
    typeof obj.event === 'string' &&
    (typeof obj.worker === 'object' || typeof obj.worker === 'string')
  );
}

/**
 * Parse NEEDLE format log entry
 */
function parseNeedleFormat(entry: NeedleLogEntry): LogEvent {
  // Convert ISO timestamp to Unix milliseconds
  const ts = new Date(entry.ts).getTime();

  // Handle worker as string (aligned format) or object (legacy)
  const worker = typeof entry.worker === 'string'
    ? entry.worker
    : `${entry.worker.runner}-${entry.worker.identifier}`;

  // Use event as message
  const msg = entry.event;

  // Infer log level from event name
  const level = inferLogLevel(entry.event);

  // Build LogEvent
  const event: LogEvent = {
    ts,
    worker,
    level,
    msg,
  };

  // Extract optional fields from data payload
  const data = entry.data || {};

  // Extract bead_id (map to 'bead' field)
  if (typeof data.bead_id === 'string') {
    event.bead = data.bead_id;
  }

  // Extract duration_ms
  if (typeof data.duration_ms === 'number') {
    event.duration_ms = data.duration_ms;
  }

  // Extract error if present
  if (typeof data.error === 'string') {
    event.error = data.error;
  }

  // Extract tool if present
  if (typeof data.tool === 'string') {
    event.tool = data.tool;
  }

  // Extract path if present
  if (typeof data.path === 'string') {
    event.path = data.path;
  }

  // Copy session and other NEEDLE-specific fields
  event.session = entry.session;
  event.provider = entry.worker.provider;
  event.model = entry.worker.model;

  // Copy remaining data fields (excluding already extracted ones)
  const extractedFields = ['bead_id', 'duration_ms', 'error', 'tool', 'path'];
  for (const key of Object.keys(data)) {
    if (!extractedFields.includes(key) && !(key in event)) {
      event[key] = data[key];
    }
  }

  return event;
}

/**
 * Infer log level from event name
 *
 * Maps NEEDLE event types to log levels:
 * - error: events containing "error", "fail", "exhausted"
 * - warn: events containing "retry", "warn"
 * - debug: events containing "debug"
 * - info: everything else
 */
function inferLogLevel(eventName: string): LogLevel {
  const lower = eventName.toLowerCase();

  // Error-level events
  if (lower.includes('error') || lower.includes('fail') || lower.includes('exhausted')) {
    return 'error';
  }

  // Warn-level events
  if (lower.includes('retry') || lower.includes('warn')) {
    return 'warn';
  }

  // Debug-level events
  if (lower.includes('debug')) {
    return 'debug';
  }

  // Default to info
  return 'info';
}

/**
 * Parse multiple log lines
 *
 * @param content - Multi-line string of log entries
 * @returns Array of parsed LogEvents (skips invalid lines)
 */
export function parseLogLines(content: string): LogEvent[] {
  const events: LogEvent[] = [];

  for (const line of content.split('\n')) {
    const event = parseLogLine(line);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Format a LogEvent for display
 */
export function formatEvent(event: LogEvent, options: FormatOptions = {}): string {
  const { showWorker = true, showLevel = true, colorize = false } = options;

  const timestamp = formatTimestamp(event.ts);
  const parts: string[] = [];

  if (showWorker) {
    parts.push(padWorker(event.worker));
  }

  if (showLevel) {
    parts.push(formatLevel(event.level, colorize));
  }

  parts.push(event.msg);

  // Add optional context
  if (event.tool) {
    parts.push(`[${event.tool}]`);
  }
  if (event.path) {
    parts.push(event.path);
  }
  if (event.bead) {
    parts.push(`bead:${event.bead}`);
  }
  if (event.duration_ms !== undefined) {
    parts.push(`(${formatDuration(event.duration_ms)})`);
  }
  if (event.error) {
    parts.push(`ERROR: ${event.error}`);
  }

  return `${timestamp}  ${parts.join('  ')}`;
}

export interface FormatOptions {
  showWorker?: boolean;
  showLevel?: boolean;
  colorize?: boolean;
}

/**
 * Check if level is valid
 */
function isValidLogLevel(level: unknown): level is LogLevel {
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error';
}

/**
 * Check if field is a standard LogEvent field
 */
function isStandardField(key: string): boolean {
  return [
    'ts', 'worker', 'level', 'msg', 'tool', 'path', 'bead', 'duration_ms', 'error',
    // NEEDLE-specific fields
    'session', 'provider', 'model'
  ].includes(key);
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Pad worker ID for alignment
 */
function padWorker(worker: string): string {
  return worker.padEnd(12);
}

/**
 * Format log level with optional color
 */
function formatLevel(level: LogLevel, colorize: boolean): string {
  const padded = level.toUpperCase().padEnd(5);

  if (!colorize) {
    return padded;
  }

  // ANSI color codes
  const colors: Record<LogLevel, string> = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m',  // green
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
  };
  const reset = '\x1b[0m';

  return `${colors[level]}${padded}${reset}`;
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

// ============================================
// Conversation Event Parsing
// ============================================

/**
 * Event sequence counter for generating unique IDs
 */
let eventSequence = 0;

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  return `ce-${Date.now()}-${++eventSequence}`;
}

/**
 * Helper: Get string value from LogEvent
 */
function getString(event: LogEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Helper: Get number value from LogEvent
 */
function getNumber(event: LogEvent, key: string): number | undefined {
  const value = event[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Helper: Get boolean value from LogEvent
 */
function getBoolean(event: LogEvent, key: string): boolean | undefined {
  const value = event[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Helper: Get object value from LogEvent
 */
function getObject<T = Record<string, unknown>>(event: LogEvent, key: string): T | undefined {
  const value = event[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as T)
    : undefined;
}

/**
 * Check if a log event contains conversation-related content
 */
export function isConversationEvent(event: LogEvent): boolean {
  // Check for explicit conversation fields
  if (
    event.conversation_role ||
    event.conversation_type ||
    event.prompt ||
    event.response ||
    event.thinking ||
    event.tool_call ||
    event.tool_result
  ) {
    return true;
  }

  // Check message patterns that indicate conversation content
  const msg = event.msg.toLowerCase();
  if (
    msg.includes('user prompt') ||
    msg.includes('assistant response') ||
    msg.includes('thinking') ||
    msg.includes('tool call') ||
    msg.includes('tool result')
  ) {
    return true;
  }

  // Tool events with arguments/results are conversation events
  if (event.tool && (event.tool_args || event.tool_input || event.args)) {
    return true;
  }

  // Events with explicit content field
  if (event.content && typeof event.content === 'string') {
    return true;
  }

  return false;
}

/**
 * Parse a log event into a conversation event
 *
 * @param event - The log event to parse
 * @param sequence - Sequence number in the conversation
 * @param options - Parse options
 * @returns Parsed conversation event or null if not a conversation event
 */
export function parseConversationEvent(
  event: LogEvent,
  sequence: number,
  options: ConversationParseOptions = {}
): ConversationEvent | null {
  const { maxContentLength = 10000, maxToolResultLength = 5000 } = options;

  // Check for explicit conversation type
  if (event.conversation_type) {
    return parseByConversationType(event, sequence, options);
  }

  // Check for user prompt
  if (event.prompt || event.conversation_role === 'user' || event.role === 'user') {
    return parsePromptEvent(event, sequence, maxContentLength);
  }

  // Check for assistant response
  if (event.response || event.conversation_role === 'assistant' || event.role === 'assistant') {
    // Check if it's a thinking block
    if (event.thinking || event.msg.toLowerCase().includes('thinking')) {
      return parseThinkingEvent(event, sequence, maxContentLength);
    }
    return parseResponseEvent(event, sequence, maxContentLength);
  }

  // Check for thinking block
  if (event.thinking || event.msg.toLowerCase().includes('thinking')) {
    return parseThinkingEvent(event, sequence, maxContentLength);
  }

  // Check for tool call
  if (event.tool_call || (event.tool && (event.tool_args || event.tool_input || event.args))) {
    return parseToolCallEvent(event, sequence);
  }

  // Check for tool result
  if (event.tool_result || (event.tool && (event.result || event.tool_output))) {
    return parseToolResultEvent(event, sequence, maxToolResultLength);
  }

  // Check message patterns
  const msg = event.msg.toLowerCase();
  if (msg.includes('prompt') && !msg.includes('tool')) {
    return parsePromptEvent(event, sequence, maxContentLength);
  }

  if (msg.includes('response') && !msg.includes('tool')) {
    return parseResponseEvent(event, sequence, maxContentLength);
  }

  if (msg.includes('tool call') || (event.tool && event.msg.includes('Tool call'))) {
    return parseToolCallEvent(event, sequence);
  }

  if (msg.includes('tool result') || msg.includes('tool response')) {
    return parseToolResultEvent(event, sequence, maxToolResultLength);
  }

  return null;
}

/**
 * Parse by explicit conversation_type field
 */
function parseByConversationType(
  event: LogEvent,
  sequence: number,
  options: ConversationParseOptions
): ConversationEvent | null {
  const type = event.conversation_type as string;
  const { maxContentLength = 10000, maxToolResultLength = 5000 } = options;

  switch (type) {
    case 'prompt':
    case 'user':
      return parsePromptEvent(event, sequence, maxContentLength);
    case 'response':
    case 'assistant':
      return parseResponseEvent(event, sequence, maxContentLength);
    case 'thinking':
      return parseThinkingEvent(event, sequence, maxContentLength);
    case 'tool_call':
      return parseToolCallEvent(event, sequence);
    case 'tool_result':
      return parseToolResultEvent(event, sequence, maxToolResultLength);
    default:
      return null;
  }
}

/**
 * Parse a user prompt event
 */
function parsePromptEvent(
  event: LogEvent,
  sequence: number,
  maxLength: number
): PromptEvent | null {
  const content = extractContent(event, 'prompt') || extractContent(event, 'content');
  if (!content) return null;

  return {
    id: generateEventId(),
    type: 'prompt',
    role: 'user',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    sequence,
    content: truncate(content, maxLength),
    isContinuation: getBoolean(event, 'is_continuation') ?? getBoolean(event, 'continuation'),
    tokens: getNumber(event, 'tokens') ?? getNumber(event, 'input_tokens'),
  };
}

/**
 * Parse an assistant response event
 */
function parseResponseEvent(
  event: LogEvent,
  sequence: number,
  maxLength: number
): ResponseEvent | null {
  const content = extractContent(event, 'response') || extractContent(event, 'content');
  if (!content) return null;

  return {
    id: generateEventId(),
    type: 'response',
    role: 'assistant',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    sequence,
    content: truncate(content, maxLength),
    isTruncated: content.length > maxLength,
    model: getString(event, 'model') ?? getString(event, 'model_name'),
    stopReason: getString(event, 'stop_reason') as ResponseEvent['stopReason'],
    tokens: getNumber(event, 'tokens') ?? getNumber(event, 'output_tokens'),
  };
}

/**
 * Parse a thinking block event
 */
function parseThinkingEvent(
  event: LogEvent,
  sequence: number,
  maxLength: number
): ThinkingEvent | null {
  const content = extractContent(event, 'thinking') || extractContent(event, 'content');
  if (!content) return null;

  return {
    id: generateEventId(),
    type: 'thinking',
    role: 'assistant',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    sequence,
    content: truncate(content, maxLength),
    isTruncated: content.length > maxLength,
    durationMs: getNumber(event, 'thinking_duration_ms') ?? event.duration_ms,
    tokens: getNumber(event, 'tokens'),
  };
}

/**
 * Parse a tool call event
 */
function parseToolCallEvent(event: LogEvent, sequence: number): ToolCallEvent | null {
  const tool = event.tool || getString(event, 'tool_name');
  if (!tool) return null;

  const args = normalizeToolArgs(event);

  return {
    id: generateEventId(),
    type: 'tool_call',
    role: 'assistant',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    sequence,
    tool,
    args: args as Record<string, import('./types.js').ToolArgValue>,
    toolCallId: getString(event, 'tool_call_id') ?? getString(event, 'call_id'),
    summary: generateToolSummary(tool, args as Record<string, import('./types.js').ToolArgValue>),
    tokens: getNumber(event, 'tokens'),
  };
}

/**
 * Parse a tool result event
 */
function parseToolResultEvent(
  event: LogEvent,
  sequence: number,
  maxLength: number
): ToolResultEvent | null {
  const tool = event.tool || getString(event, 'tool_name');
  if (!tool) return null;

  const content = extractContent(event, 'tool_result') ||
    extractContent(event, 'result') ||
    extractContent(event, 'content') ||
    '';

  const hasError = event.error || getString(event, 'tool_error') || event.success === false;

  return {
    id: generateEventId(),
    type: 'tool_result',
    role: 'tool',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    sequence,
    tool,
    toolCallId: getString(event, 'tool_call_id') ?? getString(event, 'call_id'),
    content: truncate(content, maxLength),
    success: !hasError,
    error: event.error || getString(event, 'tool_error'),
    durationMs: event.duration_ms ?? getNumber(event, 'tool_duration_ms'),
    isTruncated: content.length > maxLength,
    resultSize: content.length,
    tokens: getNumber(event, 'tokens'),
  };
}

/**
 * Extract content from various field names
 */
function extractContent(event: LogEvent, primaryField: string): string | null {
  // Try primary field
  if (typeof event[primaryField] === 'string') {
    return event[primaryField] as string;
  }

  // Try content field
  if (primaryField !== 'content' && typeof event.content === 'string') {
    return event.content;
  }

  // Try message as fallback for some cases
  if (primaryField === 'prompt' && event.msg && !event.msg.includes('Tool')) {
    return event.msg;
  }

  return null;
}

/**
 * Normalize tool arguments from various field names
 */
function normalizeToolArgs(event: LogEvent): Record<string, unknown> {
  // Check various argument field names
  const args =
    event.tool_args ||
    event.tool_input ||
    event.args ||
    event.arguments ||
    event.input ||
    {};

  // Ensure it's an object
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { value: args };
  }

  return args as Record<string, unknown>;
}

/**
 * Truncate content to max length
 */
function truncate(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength - 3) + '...';
}

/**
 * Generate a human-readable summary of a tool call
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

/**
 * Parse all conversation events from a list of log events
 *
 * @param events - List of log events to parse
 * @param options - Parse options
 * @returns List of conversation events in chronological order
 */
export function parseConversationEvents(
  events: LogEvent[],
  options: ConversationParseOptions = {}
): ConversationEvent[] {
  const { includeThinking = true, includeToolResults = true } = options;
  const conversationEvents: ConversationEvent[] = [];
  let sequence = 0;

  for (const event of events) {
    const convEvent = parseConversationEvent(event, sequence, options);

    if (convEvent) {
      // Filter based on options
      if (convEvent.type === 'thinking' && !includeThinking) {
        continue;
      }
      if (convEvent.type === 'tool_result' && !includeToolResults) {
        continue;
      }

      conversationEvents.push(convEvent);
      sequence++;
    }
  }

  return conversationEvents;
}

/**
 * Extract conversation from a single log line
 *
 * @param line - Raw log line
 * @param options - Parse options
 * @returns Conversation event or null
 */
export function parseConversationLine(
  line: string,
  options: ConversationParseOptions = {}
): ConversationEvent | null {
  const logEvent = parseLogLine(line);
  if (!logEvent) return null;

  return parseConversationEvent(logEvent, 0, options);
}

/**
 * Extract conversation events from multi-line log content
 *
 * @param content - Multi-line log content
 * @param options - Parse options
 * @returns List of conversation events
 */
export function parseConversationContent(
  content: string,
  options: ConversationParseOptions = {}
): ConversationEvent[] {
  const logEvents = parseLogLines(content);
  return parseConversationEvents(logEvents, options);
}

/**
 * Format a conversation event for display
 */
export function formatConversationEvent(event: ConversationEvent): string {
  const timestamp = formatTimestamp(event.ts);
  const prefix = `${timestamp} [${event.role}]`;

  switch (event.type) {
    case 'prompt':
      return `${prefix}\n${event.content}`;
    case 'response':
      return `${prefix}\n${event.content}${event.isTruncated ? ' [truncated]' : ''}`;
    case 'thinking':
      return `${prefix} <thinking>\n${event.content}${event.isTruncated ? ' [truncated]' : ''}`;
    case 'tool_call':
      return `${prefix} Tool: ${event.summary}`;
    case 'tool_result':
      const status = event.success ? '✓' : '✗';
      const duration = event.durationMs ? ` (${formatDuration(event.durationMs)})` : '';
      return `${prefix} Tool result: ${event.tool} ${status}${duration}`;
    default:
      return prefix;
  }
}

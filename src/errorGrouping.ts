/**
 * FABRIC Error Grouping Module
 *
 * Clusters similar errors together to reduce noise and highlight unique issues.
 * Uses pattern matching on error messages and stack traces to group related errors.
 */

import { LogEvent, ErrorFingerprint, ErrorCategory, ErrorGroup, ErrorGroupingOptions } from './types.js';

// Simple hash function for signatures
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Pattern matchers for error categorization
interface ErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];
  normalizers: Array<(msg: string) => string>;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: 'network',
    patterns: [
      /ECONNREFUSED/i,
      /ECONNRESET/i,
      /EPIPE/i,
      /ENOTFOUND/i,
      /EAI_AGAIN/i,
      /ETIMEDOUT.*connect/i,
      /socket hang up/i,
      /network unreachable/i,
      /connection refused/i,
      /connection reset/i,
      /connection closed/i,
      /getaddrinfo/i,
      /DNS/i,
    ],
    normalizers: [
      // Normalize host:port patterns
      (msg) => msg.replace(/(\d{1,3}\.){3}\d{1,3}(:\d+)?/g, '*:*'),
      (msg) => msg.replace(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(:\d+)?/g, '*:*'),
      // Normalize connection IDs
      (msg) => msg.replace(/connection #[\d]+/gi, 'connection #*'),
    ],
  },
  {
    category: 'permission',
    patterns: [
      /EACCES/i,
      /EPERM/i,
      /permission denied/i,
      /access denied/i,
      /unauthorized/i,
      /forbidden/i,
      /authentication failed/i,
      /invalid.*credentials/i,
      /not authorized/i,
      /insufficient permissions/i,
      /403/i,
      /401/i,
    ],
    normalizers: [
      // Normalize file paths
      (msg) => msg.replace(/\/[\w./-]+/g, '/*'),
      // Normalize usernames
      (msg) => msg.replace(/user ['"][\w@.-]+['"]/gi, 'user "*"'),
    ],
  },
  {
    category: 'not_found',
    patterns: [
      /ENOENT/i,
      /no such file/i,
      /not found/i,
      /does not exist/i,
      /404/i,
      /resource not found/i,
      /no matching/i,
    ],
    normalizers: [
      // Normalize file paths
      (msg) => msg.replace(/['"]\/[\w./-]+['"]/g, '"/*"'),
      (msg) => msg.replace(/['"][\w-]+\.[\w]+['"]/g, '"*"'),
    ],
  },
  {
    category: 'timeout',
    patterns: [
      /ETIMEDOUT/i,
      /timed? out/i,
      /timeout expired/i,
      /deadline exceeded/i,
      /request timeout/i,
    ],
    normalizers: [
      // Normalize durations
      (msg) => msg.replace(/\d+\s*(ms|seconds?|minutes?|s|m)/gi, '*ms'),
      (msg) => msg.replace(/after \d+/gi, 'after *'),
    ],
  },
  {
    category: 'resource',
    patterns: [
      /ENOMEM/i,
      /out of memory/i,
      /disk full/i,
      /no space left/i,
      /quota exceeded/i,
      /limit exceeded/i,
      /rate limit/i,
      /too many requests/i,
      /429/i,
      /resource exhausted/i,
    ],
    normalizers: [
      // Normalize numbers
      (msg) => msg.replace(/\d+(?:\.\d+)?\s*(bytes?|kb|mb|gb|tb)/gi, '*B'),
      (msg) => msg.replace(/limit of \d+/gi, 'limit of *'),
    ],
  },
  // Syntax errors must be checked BEFORE validation errors
  // because "SyntaxError: unexpected token" should match syntax, not validation
  {
    category: 'syntax',
    patterns: [
      /SyntaxError/i,
      /parse error/i,
      /JSON parse/i,
      /YAML parse/i,
      /invalid format/i,
    ],
    normalizers: [
      // Normalize line numbers
      (msg) => msg.replace(/at line \d+/gi, 'at line *'),
      (msg) => msg.replace(/position \d+/gi, 'position *'),
      // Normalize quoted strings
      (msg) => msg.replace(/['"][^'"]{1,30}['"]/g, '"*"'),
    ],
  },
  {
    category: 'validation',
    patterns: [
      /invalid/i,
      /malformed/i,
      /unexpected token/i,
      /expected.*but got/i,
      /validation failed/i,
      /schema validation/i,
      /type error/i,
      /cannot read/i,
      /cannot set/i,
      /undefined is not/i,
      /null is not/i,
      /is not a function/i,
      /is not defined/i,
    ],
    normalizers: [
      // Normalize property names
      (msg) => msg.replace(/property ['"][\w.]+['"]/gi, 'property "*"'),
      (msg) => msg.replace(/['"][\w.]+['"] is not/gi, '"*" is not'),
      // Normalize types
      (msg) => msg.replace(/expected [\w<>[\]]+/gi, 'expected *'),
    ],
  },
  {
    category: 'tool',
    patterns: [
      /tool.*failed/i,
      /tool.*error/i,
      /execution failed/i,
      /command failed/i,
      /exit code \d+/i,
      /non-zero exit/i,
      /spawn.*error/i,
      /child process/i,
    ],
    normalizers: [
      // Normalize command arguments
      (msg) => msg.replace(/--[\w-]+=\S+/g, '--*=*'),
      (msg) => msg.replace(/exit code \d+/gi, 'exit code *'),
    ],
  },
];

/**
 * Default grouping options
 */
const DEFAULT_OPTIONS: Required<ErrorGroupingOptions> = {
  activeWindowMs: 5 * 60 * 1000, // 5 minutes
  highSeverityThreshold: 5,
  criticalSeverityThreshold: 10,
  maxGroups: 100,
};

/**
 * Categorize an error message
 */
export function categorizeError(message: string): ErrorCategory {
  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        return pattern.category;
      }
    }
  }
  return 'unknown';
}

/**
 * Generate a fingerprint for an error event
 */
export function fingerprintError(event: LogEvent): ErrorFingerprint {
  const message = event.error || event.msg;

  // Find matching category and normalizers
  let category: ErrorCategory = 'unknown';
  let normalizers: Array<(msg: string) => string> = [];

  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        category = pattern.category;
        normalizers = pattern.normalizers;
        break;
      }
    }
    if (category !== 'unknown') break;
  }

  // Apply normalizers to create signature
  let signature = message;
  for (const normalize of normalizers) {
    signature = normalize(signature);
  }

  // Also normalize common patterns
  signature = signature
    // UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '*UUID*')
    // Hex strings (longer than 8 chars)
    .replace(/0x[0-9a-f]{8,}/gi, '*HEX*')
    // Numbers
    .replace(/\b\d{4,}\b/g, '*')
    // Timestamps
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, '*TIMESTAMP*')
    // Stack traces - keep first line only
    .split('\n')[0]
    .trim();

  // Truncate very long signatures
  if (signature.length > 200) {
    signature = signature.substring(0, 200) + '...';
  }

  const hash = simpleHash(signature + ':' + category);

  return {
    signature,
    category,
    sampleMessage: message,
    hash,
  };
}

/**
 * Check if two fingerprints represent the same error group
 */
export function fingerprintsMatch(a: ErrorFingerprint, b: ErrorFingerprint): boolean {
  return a.hash === b.hash;
}

/**
 * Calculate severity based on count and recency
 */
function calculateSeverity(
  count: number,
  lastSeen: number,
  options: Required<ErrorGroupingOptions>
): 'low' | 'medium' | 'high' | 'critical' {
  const now = Date.now();
  const isActive = (now - lastSeen) < options.activeWindowMs;

  if (!isActive) {
    return 'low';
  }

  if (count >= options.criticalSeverityThreshold) {
    return 'critical';
  }

  if (count >= options.highSeverityThreshold) {
    return 'high';
  }

  if (count >= 2) {
    return 'medium';
  }

  return 'low';
}

/**
 * Generate a unique group ID
 */
function generateGroupId(): string {
  return `eg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Error Group Manager
 *
 * Manages error groups and provides grouping functionality.
 */
export class ErrorGroupManager {
  private groups: Map<string, ErrorGroup> = new Map();
  private hashToGroup: Map<string, string> = new Map(); // hash -> groupId
  private options: Required<ErrorGroupingOptions>;

  constructor(options: ErrorGroupingOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Add an error event to the appropriate group
   */
  addError(event: LogEvent): ErrorGroup {
    const fingerprint = fingerprintError(event);
    const existingGroupId = this.hashToGroup.get(fingerprint.hash);

    if (existingGroupId) {
      // Add to existing group
      const group = this.groups.get(existingGroupId)!;
      group.events.push(event);
      group.count++;
      group.lastSeen = event.ts;

      if (!group.affectedWorkers.includes(event.worker)) {
        group.affectedWorkers.push(event.worker);
      }

      // Update severity
      group.severity = calculateSeverity(group.count, group.lastSeen, this.options);
      group.isActive = (Date.now() - group.lastSeen) < this.options.activeWindowMs;

      return group;
    }

    // Create new group
    const groupId = generateGroupId();
    const group: ErrorGroup = {
      id: groupId,
      fingerprint,
      events: [event],
      firstSeen: event.ts,
      lastSeen: event.ts,
      count: 1,
      affectedWorkers: [event.worker],
      isActive: true,
      severity: 'low',
    };

    this.groups.set(groupId, group);
    this.hashToGroup.set(fingerprint.hash, groupId);

    // Trim if over limit
    if (this.groups.size > this.options.maxGroups) {
      this.trimGroups();
    }

    return group;
  }

  /**
   * Trim oldest/inactive groups when over limit
   */
  private trimGroups(): void {
    // Sort groups by lastSeen (oldest first)
    const sortedGroups = Array.from(this.groups.entries())
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen);

    // Remove oldest inactive groups first
    const toRemove: string[] = [];
    for (const [groupId, group] of sortedGroups) {
      if (!group.isActive && this.groups.size - toRemove.length > this.options.maxGroups * 0.8) {
        toRemove.push(groupId);
      }
    }

    // If still over limit, remove oldest regardless of status
    while (this.groups.size - toRemove.length > this.options.maxGroups) {
      const oldest = sortedGroups.find(([id]) => !toRemove.includes(id));
      if (oldest) {
        toRemove.push(oldest[0]);
      } else {
        break;
      }
    }

    // Remove selected groups
    for (const groupId of toRemove) {
      const group = this.groups.get(groupId);
      if (group) {
        this.hashToGroup.delete(group.fingerprint.hash);
        this.groups.delete(groupId);
      }
    }
  }

  /**
   * Get all error groups
   */
  getGroups(): ErrorGroup[] {
    // Update active status before returning
    const now = Date.now();
    for (const group of this.groups.values()) {
      group.isActive = (now - group.lastSeen) < this.options.activeWindowMs;
      group.severity = calculateSeverity(group.count, group.lastSeen, this.options);
    }

    return Array.from(this.groups.values())
      .sort((a, b) => {
        // Sort by: active first, then severity, then count
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return b.count - a.count;
      });
  }

  /**
   * Get active error groups only
   */
  getActiveGroups(): ErrorGroup[] {
    return this.getGroups().filter(g => g.isActive);
  }

  /**
   * Get a specific group by ID
   */
  getGroup(groupId: string): ErrorGroup | undefined {
    return this.groups.get(groupId);
  }

  /**
   * Get groups affecting a specific worker
   */
  getWorkerGroups(workerId: string): ErrorGroup[] {
    return this.getGroups().filter(g => g.affectedWorkers.includes(workerId));
  }

  /**
   * Get groups by category
   */
  getGroupsByCategory(category: ErrorCategory): ErrorGroup[] {
    return this.getGroups().filter(g => g.fingerprint.category === category);
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    totalGroups: number;
    activeGroups: number;
    totalErrors: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<string, number>;
  } {
    const groups = this.getGroups();
    const byCategory: Record<ErrorCategory, number> = {
      network: 0,
      permission: 0,
      validation: 0,
      resource: 0,
      not_found: 0,
      timeout: 0,
      syntax: 0,
      tool: 0,
      unknown: 0,
    };
    const bySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    let totalErrors = 0;
    for (const group of groups) {
      byCategory[group.fingerprint.category]++;
      bySeverity[group.severity]++;
      totalErrors += group.count;
    }

    return {
      totalGroups: groups.length,
      activeGroups: groups.filter(g => g.isActive).length,
      totalErrors,
      byCategory,
      bySeverity,
    };
  }

  /**
   * Clear all groups
   */
  clear(): void {
    this.groups.clear();
    this.hashToGroup.clear();
  }

  /**
   * Get number of tracked groups
   */
  get size(): number {
    return this.groups.size;
  }
}

/**
 * Create a singleton manager instance
 */
let globalManager: ErrorGroupManager | undefined;

export function getErrorGroupManager(): ErrorGroupManager {
  if (!globalManager) {
    globalManager = new ErrorGroupManager();
  }
  return globalManager;
}

export function resetErrorGroupManager(): void {
  globalManager = undefined;
}

// Re-export types
export type { ErrorFingerprint, ErrorCategory, ErrorGroup, ErrorGroupingOptions };

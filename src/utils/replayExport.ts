/**
 * Session Replay Export/Import Utilities
 *
 * Provides functionality for exporting and importing session replay data
 * as shareable links or .fabric-replay files.
 */

import { LogEvent } from '../types.js';

/**
 * Version of the export format
 */
export const REPLAY_EXPORT_VERSION = '1.0';

/**
 * Metadata for the exported session
 */
export interface ReplayExportMetadata {
  /** Unix timestamp of session start */
  sessionStart: number;
  /** Unix timestamp of session end */
  sessionEnd: number;
  /** Number of unique workers */
  workerCount: number;
  /** Optional source file path */
  sourcePath?: string;
  /** Optional description */
  description?: string;
}

/**
 * Export format for session replay
 */
export interface ReplayExport {
  /** Format version */
  version: string;
  /** Unix timestamp when exported */
  exportedAt: number;
  /** Number of events in the export */
  eventCount: number;
  /** The events to replay */
  events: LogEvent[];
  /** Metadata about the session */
  metadata: ReplayExportMetadata;
}

/**
 * Convert web LogEvent format to core LogEvent format
 */
export interface WebLogEvent {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  worker: string;
  tool?: string;
  message: string;
  raw: string;
  bead?: string;
}

/**
 * Create a replay export from events
 */
export function createReplayExport(
  events: LogEvent[],
  options: {
    sourcePath?: string;
    description?: string;
  } = {}
): ReplayExport {
  if (events.length === 0) {
    return {
      version: REPLAY_EXPORT_VERSION,
      exportedAt: Date.now(),
      eventCount: 0,
      events: [],
      metadata: {
        sessionStart: Date.now(),
        sessionEnd: Date.now(),
        workerCount: 0,
        sourcePath: options.sourcePath,
        description: options.description,
      },
    };
  }

  // Sort events by timestamp
  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);

  // Calculate metadata
  const timestamps = sortedEvents.map(e => e.ts);
  const sessionStart = Math.min(...timestamps);
  const sessionEnd = Math.max(...timestamps);
  const workers = new Set(sortedEvents.map(e => e.worker));

  return {
    version: REPLAY_EXPORT_VERSION,
    exportedAt: Date.now(),
    eventCount: sortedEvents.length,
    events: sortedEvents,
    metadata: {
      sessionStart,
      sessionEnd,
      workerCount: workers.size,
      sourcePath: options.sourcePath,
      description: options.description,
    },
  };
}

/**
 * Export events to JSON string
 */
export function exportToJson(events: LogEvent[], options?: {
  sourcePath?: string;
  description?: string;
}): string {
  const exportData = createReplayExport(events, options);
  return JSON.stringify(exportData, null, 2);
}

/**
 * Export events to base64 encoded string (for URL sharing)
 */
export function exportToBase64(events: LogEvent[], options?: {
  sourcePath?: string;
  description?: string;
}): string {
  const exportData = createReplayExport(events, options);
  const jsonString = JSON.stringify(exportData);
  // Use Node.js Buffer for base64 encoding
  return Buffer.from(jsonString, 'utf-8').toString('base64');
}

/**
 * Import events from JSON string
 */
export function importFromJson(jsonString: string): ReplayExport {
  try {
    const data = JSON.parse(jsonString) as ReplayExport;

    // Validate structure
    if (!data.version || !Array.isArray(data.events)) {
      throw new Error('Invalid replay export format');
    }

    // Validate events have required fields
    for (const event of data.events) {
      if (typeof event.ts !== 'number' || !event.worker || !event.msg) {
        throw new Error('Invalid event format in export');
      }
    }

    return data;
  } catch (error) {
    throw new Error(`Failed to parse replay export: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Import events from base64 encoded string (from URL)
 */
export function importFromBase64(base64String: string): ReplayExport {
  try {
    const jsonString = Buffer.from(base64String, 'base64').toString('utf-8');
    return importFromJson(jsonString);
  } catch (error) {
    throw new Error(`Failed to decode replay data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a shareable URL with replay data
 */
export function generateShareableUrl(
  events: LogEvent[],
  baseUrl: string,
  options?: {
    sourcePath?: string;
    description?: string;
  }
): string {
  const base64Data = exportToBase64(events, options);
  const url = new URL(baseUrl);
  url.searchParams.set('replay', base64Data);
  return url.toString();
}

/**
 * Extract replay data from URL parameters
 */
export function extractReplayFromUrl(url: string): ReplayExport | null {
  try {
    const parsedUrl = new URL(url);
    const replayParam = parsedUrl.searchParams.get('replay');

    if (!replayParam) {
      return null;
    }

    return importFromBase64(replayParam);
  } catch {
    return null;
  }
}

/**
 * Generate a filename for the export
 */
export function generateExportFilename(metadata: ReplayExportMetadata): string {
  const date = new Date(metadata.sessionStart);
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  return `session-${dateStr}-${timeStr}.fabric-replay`;
}

/**
 * Validate a replay export
 */
export function validateReplayExport(data: unknown): data is ReplayExport {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Check required fields
  if (typeof obj.version !== 'string') return false;
  if (typeof obj.exportedAt !== 'number') return false;
  if (typeof obj.eventCount !== 'number') return false;
  if (!Array.isArray(obj.events)) return false;
  if (typeof obj.metadata !== 'object' || obj.metadata === null) return false;

  // Validate metadata
  const metadata = obj.metadata as Record<string, unknown>;
  if (typeof metadata.sessionStart !== 'number') return false;
  if (typeof metadata.sessionEnd !== 'number') return false;
  if (typeof metadata.workerCount !== 'number') return false;

  return true;
}

// ============================================
// Web-specific utilities (for browser environment)
// ============================================

/**
 * Export events to base64 (browser version)
 */
export function exportToBase64Browser(events: WebLogEvent[]): string {
  const exportData = createReplayExportWeb(events);
  const jsonString = JSON.stringify(exportData);
  return btoa(encodeURIComponent(jsonString));
}

/**
 * Import events from base64 (browser version)
 */
export function importFromBase64Browser(base64String: string): ReplayExportWeb {
  try {
    const jsonString = decodeURIComponent(atob(base64String));
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`Failed to decode replay data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Web version of ReplayExport
 */
export interface ReplayExportWeb {
  version: string;
  exportedAt: number;
  eventCount: number;
  events: WebLogEvent[];
  metadata: {
    sessionStart: number;
    sessionEnd: number;
    workerCount: number;
    sourcePath?: string;
    description?: string;
  };
}

/**
 * Create a replay export from web events
 */
export function createReplayExportWeb(
  events: WebLogEvent[],
  options: {
    sourcePath?: string;
    description?: string;
  } = {}
): ReplayExportWeb {
  if (events.length === 0) {
    return {
      version: REPLAY_EXPORT_VERSION,
      exportedAt: Date.now(),
      eventCount: 0,
      events: [],
      metadata: {
        sessionStart: Date.now(),
        sessionEnd: Date.now(),
        workerCount: 0,
        sourcePath: options.sourcePath,
        description: options.description,
      },
    };
  }

  // Sort events by timestamp
  const sortedEvents = [...events].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Calculate metadata
  const timestamps = sortedEvents.map(e => new Date(e.timestamp).getTime());
  const sessionStart = Math.min(...timestamps);
  const sessionEnd = Math.max(...timestamps);
  const workers = new Set(sortedEvents.map(e => e.worker));

  return {
    version: REPLAY_EXPORT_VERSION,
    exportedAt: Date.now(),
    eventCount: sortedEvents.length,
    events: sortedEvents,
    metadata: {
      sessionStart,
      sessionEnd,
      workerCount: workers.size,
      sourcePath: options.sourcePath,
      description: options.description,
    },
  };
}

/**
 * Export web events to JSON string
 */
export function exportToJsonWeb(events: WebLogEvent[], options?: {
  sourcePath?: string;
  description?: string;
}): string {
  const exportData = createReplayExportWeb(events, options);
  return JSON.stringify(exportData, null, 2);
}

/**
 * Import web events from JSON string
 */
export function importFromJsonWeb(jsonString: string): ReplayExportWeb {
  try {
    const data = JSON.parse(jsonString);

    // Validate structure
    if (!data.version || !Array.isArray(data.events)) {
      throw new Error('Invalid replay export format');
    }

    // Validate events have required fields
    for (const event of data.events) {
      if (!event.timestamp || !event.worker || !event.message) {
        throw new Error('Invalid event format in export');
      }
    }

    return data;
  } catch (error) {
    throw new Error(`Failed to parse replay export: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export default {
  REPLAY_EXPORT_VERSION,
  createReplayExport,
  exportToJson,
  exportToBase64,
  importFromJson,
  importFromBase64,
  generateShareableUrl,
  extractReplayFromUrl,
  generateExportFilename,
  validateReplayExport,
  exportToBase64Browser,
  importFromBase64Browser,
  createReplayExportWeb,
  exportToJsonWeb,
  importFromJsonWeb,
};

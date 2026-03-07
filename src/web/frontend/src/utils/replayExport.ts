/**
 * Session Replay Export/Import Utilities for Web Frontend
 *
 * Provides functionality for exporting and importing session replay data
 * as shareable links or .fabric-replay files.
 */

import { LogEvent } from '../types';

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
  version: string;
  exportedAt: number;
  eventCount: number;
  events: LogEvent[];
  metadata: ReplayExportMetadata;
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
 * Uses browser's btoa with UTF-8 encoding support
 */
export function exportToBase64Browser(events: LogEvent[]): string {
  const exportData = createReplayExport(events);
  const jsonString = JSON.stringify(exportData);
  // Encode UTF-8 to handle special characters
  return btoa(encodeURIComponent(jsonString).replace(/%([0-9A-F]{2})/g, (_, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  }));
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
      if (!event.timestamp || !event.worker || !event.message) {
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
 * Uses browser's atob with UTF-8 decoding support
 */
export function importFromBase64Browser(base64String: string): ReplayExport {
  try {
    const jsonString = decodeURIComponent(atob(base64String).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
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
  baseUrl: string
): string {
  const base64Data = exportToBase64Browser(events);
  const url = new URL(baseUrl);
  url.searchParams.set('replay', base64Data);
  return url.toString();
}

/**
 * Extract replay data from URL parameters
 */
export function extractReplayFromUrl(): ReplayExport | null {
  try {
    const replayParam = new URLSearchParams(window.location.search).get('replay');

    if (!replayParam) {
      return null;
    }

    return importFromBase64Browser(replayParam);
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

// Type aliases for compatibility
export type ReplayExportWeb = ReplayExport;
export const createReplayExportWeb = createReplayExport;
export const exportToJsonWeb = exportToJson;
export const importFromJsonWeb = importFromJson;

export default {
  REPLAY_EXPORT_VERSION,
  createReplayExport,
  exportToJson,
  exportToBase64Browser,
  importFromJson,
  importFromBase64Browser,
  generateShareableUrl,
  extractReplayFromUrl,
  generateExportFilename,
  validateReplayExport,
};

/**
 * Test Helper Functions for FABRIC
 *
 * Provides reusable utilities for creating temporary test data,
 * particularly for log file testing and the --source option.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogEvent, LogLevel, NeedleEvent } from './types.js';

/**
 * Creates a temporary log file with valid NEEDLE JSONL content.
 *
 * This helper function generates temporary files for testing the --source option
 * and other log file consuming functionality. It handles file creation errors gracefully
 * and provides automatic cleanup mechanism.
 *
 * @param options - Configuration options for the log file
 * @returns An object containing the file path and cleanup function
 *
 * @example
 * ```ts
 * const { filePath, cleanup } = createTempLogFile({
 *   filename: 'test-worker.jsonl',
 *   eventCount: 5
 * });
 *
 * // Use filePath in tests
 * const tailer = new LogTailer({ path: filePath });
 *
 * // Clean up after test
 * cleanup();
 * ```
 */
export interface TempLogFileOptions {
  /** Custom filename (defaults to random UUID) */
  filename?: string;
  /** Number of events to generate (default: 1) */
  eventCount?: number;
  /** Worker ID to use in events (default: 'test-worker') */
  workerId?: string;
  /** Session ID to use in events (default: 'test-session') */
  sessionId?: string;
  /** Starting sequence number (default: 1) */
  startSequence?: number;
  /** Custom directory (defaults to OS temp dir) */
  directory?: string;
  /** Event types to generate (default: worker.started) */
  eventTypes?: string[];
  /** Whether to include a bead_id in events (default: false) */
  includeBeadId?: boolean;
}

export interface TempLogFileResult {
  /** Absolute path to the created temporary file */
  filePath: string;
  /** Directory containing the file */
  directory: string;
  /** Cleanup function to remove the file */
  cleanup: () => void;
  /** Function to append additional events to the file */
  appendEvent: (event: Partial<NeedleEvent>) => void;
  /** Function to read the current file contents */
  readContents: () => string;
}

/**
 * Creates a temporary log file with valid NEEDLE JSONL content.
 *
 * @param options - Configuration options for the log file
 * @returns Object containing file path and cleanup mechanism
 * @throws Error if file creation fails (after cleanup attempt)
 */
export function createTempLogFile(options: TempLogFileOptions = {}): TempLogFileResult {
  const {
    filename = `test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
    eventCount = 1,
    workerId = 'test-worker',
    sessionId = 'test-session',
    startSequence = 1,
    directory: customDir,
    eventTypes = ['worker.started', 'worker.idle', 'bead.claimed', 'bead.completed'],
    includeBeadId = false,
  } = options;

  // Create temporary directory
  const tempDir = customDir || fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));

  // Ensure directory exists
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (error) {
      // Cleanup on failure
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        // Ignore cleanup errors during initial creation failure
      }
      throw new Error(`Failed to create temporary directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const filePath = path.join(tempDir, filename);

  // Generate log content
  const lines: string[] = [];
  for (let i = 0; i < eventCount; i++) {
    const sequence = startSequence + i;
    const eventType = eventTypes[i % eventTypes.length];

    const event: NeedleEvent = {
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      event_type: eventType,
      worker_id: workerId,
      session_id: sessionId,
      sequence,
      data: {
        ...(includeBeadId && { bead_id: `bd-test-${sequence}` }),
        workspace: '/tmp/test-workspace',
      },
    };

    lines.push(JSON.stringify(event));
  }

  const content = lines.join('\n') + '\n';

  // Write file content
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    // Cleanup on write failure
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Ignore cleanup errors during write failure
    }
    throw new Error(`Failed to write temporary log file: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Return result with cleanup mechanism
  return {
    filePath,
    directory: tempDir,
    cleanup: () => {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (error) {
        // Log cleanup errors but don't throw - cleanup should be safe
        console.warn(`Warning: Failed to cleanup temporary directory at ${tempDir}:`, error);
      }
    },
    appendEvent: (event: Partial<NeedleEvent>) => {
      const fullEvent: NeedleEvent = {
        timestamp: new Date().toISOString(),
        event_type: event.event_type || 'worker.started',
        worker_id: event.worker_id || workerId,
        session_id: event.session_id || sessionId,
        sequence: event.sequence || (startSequence + eventCount),
        data: event.data || {},
        ...(event.bead_id && { bead_id: event.bead_id }),
      };

      try {
        fs.appendFileSync(filePath, JSON.stringify(fullEvent) + '\n', 'utf8');
      } catch (error) {
        throw new Error(`Failed to append event to temporary log file: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    readContents: () => {
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        throw new Error(`Failed to read temporary log file: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/**
 * Creates a temporary directory for testing log file operations.
 *
 * Useful for testing DirectoryTailer and other multi-file log consumers.
 *
 * @param options - Configuration options
 * @returns Object containing directory path and cleanup mechanism
 */
export interface TempDirOptions {
  /** Custom directory name (defaults to random UUID) */
  dirname?: string;
  /** Parent directory (defaults to OS temp dir) */
  parentDir?: string;
}

export interface TempDirResult {
  /** Absolute path to the created temporary directory */
  path: string;
  /** Cleanup function to remove the directory */
  cleanup: () => void;
  /** Function to create a new log file in the directory */
  createLogFile: (filename: string, content?: string) => string;
}

/**
 * Creates a temporary directory for testing log file operations.
 *
 * @param options - Configuration options
 * @returns Object containing directory path and cleanup mechanism
 * @throws Error if directory creation fails
 */
export function createTempDir(options: TempDirOptions = {}): TempDirResult {
  const { dirname, parentDir } = options;

  let tempDir: string;

  if (parentDir && dirname) {
    tempDir = path.join(parentDir, dirname);
  } else if (dirname) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `fabric-${dirname}-`));
  } else {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  }

  // Ensure directory exists
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create temporary directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    path: tempDir,
    cleanup: () => {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (error) {
        console.warn(`Warning: Failed to cleanup temporary directory at ${tempDir}:`, error);
      }
    },
    createLogFile: (filename: string, content = '') => {
      const filePath = path.join(tempDir, filename);
      try {
        fs.writeFileSync(filePath, content, 'utf8');
      } catch (error) {
        throw new Error(`Failed to create log file in temporary directory: ${error instanceof Error ? error.message : String(error)}`);
      }
      return filePath;
    },
  };
}

/**
 * Helper function to generate a canonical NeedleEvent for testing.
 *
 * Creates a properly formatted NeedleEvent object that can be used in tests
 * or converted to JSONL format.
 *
 * @param overrides - Partial event data to override defaults
 * @returns A complete NeedleEvent object
 */
export function createMockEvent(overrides: Partial<NeedleEvent> = {}): NeedleEvent {
  const defaults: NeedleEvent = {
    timestamp: new Date().toISOString(),
    event_type: 'worker.started',
    worker_id: 'test-worker',
    session_id: 'test-session',
    sequence: 1,
    data: {},
  };

  return {
    ...defaults,
    ...overrides,
    // Ensure data is always an object
    data: {
      ...defaults.data,
      ...overrides.data,
    },
  };
}

/**
 * Helper function to create a JSONL string from an array of events.
 *
 * @param events - Array of NeedleEvent objects
 * @returns JSONL-formatted string (newline-delimited JSON)
 */
export function eventsToJsonl(events: NeedleEvent[]): string {
  return events.map(event => JSON.stringify(event)).join('\n') + '\n';
}

/**
 * Creates a realistic multi-worker log scenario for testing.
 *
 * Generates log content representing multiple workers with various event types,
 * useful for testing fleet-wide functionality.
 *
 * @param workerCount - Number of workers to simulate (default: 3)
 * @param eventsPerWorker - Number of events per worker (default: 5)
 * @returns TempLogFileResult with multi-worker content
 */
export function createMultiWorkerLogFile(
  workerCount: number = 3,
  eventsPerWorker: number = 5
): TempLogFileResult {
  const workerIds = Array.from({ length: workerCount }, (_, i) => `worker-${i + 1}`);
  const allEvents: NeedleEvent[] = [];

  workerIds.forEach((workerId, workerIndex) => {
    const sessionId = `session-${workerIndex}`;
    const eventTypes = [
      'worker.started',
      'bead.claim.succeeded',
      'worker.idle',
      'bead.completed',
      'heartbeat.emitted',
    ];

    for (let i = 0; i < eventsPerWorker; i++) {
      const event = createMockEvent({
        worker_id: workerId,
        session_id: sessionId,
        sequence: i + 1,
        event_type: eventTypes[i % eventTypes.length],
        data: {
          bead_id: `bd-test-${workerIndex}-${i}`,
          workspace: `/tmp/workspace-${workerIndex}`,
        },
      });
      allEvents.push(event);
    }
  });

  // Sort events by timestamp to simulate realistic interleaving
  allEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Re-sequence after sorting
  allEvents.forEach((event, index) => {
    event.sequence = index + 1;
  });

  const content = eventsToJsonl(allEvents);

  const tempResult = createTempLogFile({
    filename: `multi-worker-${Date.now()}.jsonl`,
  });

  // Override with our multi-worker content
  try {
    fs.writeFileSync(tempResult.filePath, content, 'utf8');
  } catch (error) {
    tempResult.cleanup();
    throw new Error(`Failed to write multi-worker log file: ${error instanceof Error ? error.message : String(error)}`);
  }

  return tempResult;
}

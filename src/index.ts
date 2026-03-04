/**
 * FABRIC - Flow Analysis & Bead Reporting Interface Console
 *
 * A live display for NEEDLE worker activity.
 */

export const VERSION = '0.1.0';

export interface LogEvent {
  ts: number;
  worker: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  [key: string]: unknown;
}

export interface WorkerState {
  id: string;
  status: 'active' | 'idle' | 'error';
  lastEvent?: LogEvent;
  beadsCompleted: number;
}

// Re-export submodules
export * from './types.js';
export { SessionDigestGenerator, formatDigestAsMarkdown } from './sessionDigest.js';

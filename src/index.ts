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
export {
  resolveDigestAiConfig,
  buildDigestAiPrompt,
  generateAiDigestNarrative,
  renderAiNarrativeSection,
  DEFAULT_DIGEST_AI_MODEL,
} from './digestAi.js';
export type { DigestAiConfig, DigestAiResult, DigestAiClient } from './digestAi.js';
export {
  RETENTION_CONTROL_SCHEMA_VERSION,
  RETENTION_SIGNATURE_ALGORITHM,
  RetentionControlStore,
  canonicalizeRetentionRecord,
  createSignedOccurrenceTombstone,
  createSignedLegalHold,
  decideOccurrenceDeletion,
  defaultRetentionControlDirectory,
  generateRetentionAuthorityKeyPair,
  isLegalHoldActive,
  isOccurrenceHeld,
  occurrenceIdForPath,
  validateRetentionControlRecord,
  verifyRetentionControlSignature,
} from './retentionControls.js';
export type {
  DeletionDecision,
  LegalHoldInput,
  LegalHoldRecord,
  LegalHoldSelector,
  OccurrenceTombstone,
  OccurrenceTombstoneInput,
  RetentionControlRecord,
  RetentionOccurrence,
  RetentionReasonClass,
} from './retentionControls.js';
export { WorkerAnalytics, getWorkerAnalytics, resetWorkerAnalytics } from './workerAnalytics.js';
export { SemanticNarrativeGenerator, getSemanticNarrativeManager } from './semanticNarrative.js';
export {
  HistoricalStore,
  getHistoricalStore,
  resetHistoricalStore,
  SessionRecord,
  TaskMetricsRecord,
  ErrorHistoryRecord,
  HistoricalQueryOptions,
  WorkerComparisonMetrics,
  LearnedRecoveryEntry,
} from './historicalStore.js';

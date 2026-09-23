/**
 * Signed retention controls.
 *
 * Retention controls are deliberately separate from LogEvent.  A telemetry
 * producer can write raw events, but it cannot create, alter, or remove a
 * retention decision by sending an event.  Controls are signed by a tenant
 * authority and are append-only on disk.
 */

import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyLike,
} from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const RETENTION_CONTROL_SCHEMA_VERSION = 1 as const;
export const RETENTION_SIGNATURE_ALGORITHM = 'ed25519' as const;

/** Standard reason classes plus tenant-defined classes. */
export type RetentionReasonClass =
  | 'legal'
  | 'regulatory'
  | 'privacy'
  | 'security'
  | 'customer_request'
  | 'operational'
  | 'other'
  | (string & {});

export interface RetentionRecordIdentity {
  readonly tenantId: string;
  /** Stable authority identifier, not a secret or private key. */
  readonly tenantAuthority: string;
  /** Human or service identity recorded in the audit trail. */
  readonly auditIdentity: string;
  readonly reasonClass: RetentionReasonClass;
}

interface SignedRetentionRecord extends RetentionRecordIdentity {
  readonly schemaVersion: typeof RETENTION_CONTROL_SCHEMA_VERSION;
  readonly recordId: string;
  readonly createdAt: string;
  readonly effectiveAt: string;
  readonly signatureAlgorithm: typeof RETENTION_SIGNATURE_ALGORITHM;
  readonly keyId?: string;
  readonly signature: string;
}

/** A signed authorization to remove one immutable occurrence. */
export interface OccurrenceTombstone extends SignedRetentionRecord {
  readonly recordType: 'occurrence_tombstone';
  readonly occurrenceId: string;
  readonly occurrenceType?: string;
}

export interface LegalHoldSelector {
  readonly occurrenceId?: string;
  readonly path?: string;
  readonly workerId?: string;
  readonly sessionId?: string;
  readonly beadId?: string;
  readonly host?: string;
}

/** A signed instruction that prevents deletion while it is active. */
export interface LegalHoldRecord extends SignedRetentionRecord {
  readonly recordType: 'legal_hold';
  readonly holdId: string;
  readonly selector: LegalHoldSelector;
  /** null means no expiry; expiry is never inferred from a default. */
  readonly expiresAt: string | null;
  /** Releasing a hold is represented by a new immutable record. */
  readonly releasedAt?: string;
}

export type RetentionControlRecord = OccurrenceTombstone | LegalHoldRecord;

export interface RetentionRecordInput extends RetentionRecordIdentity {
  readonly recordId?: string;
  readonly createdAt?: string | Date;
  readonly effectiveAt?: string | Date;
  readonly keyId?: string;
}

export interface OccurrenceTombstoneInput extends RetentionRecordInput {
  readonly occurrenceId: string;
  readonly occurrenceType?: string;
}

export interface LegalHoldInput extends RetentionRecordInput {
  readonly holdId?: string;
  readonly occurrenceId?: string;
  readonly selector?: LegalHoldSelector;
  readonly expiresAt?: string | Date | null;
  readonly releasedAt?: string | Date;
}

export interface RetentionOccurrence {
  readonly occurrenceId: string;
  readonly tenantId?: string;
  readonly path?: string;
  readonly workerId?: string;
  readonly sessionId?: string;
  readonly beadId?: string;
  readonly host?: string;
}

export interface DeletionDecision {
  readonly allowed: boolean;
  readonly tombstoned: boolean;
  readonly held: boolean;
  readonly reason: 'tombstone' | 'legal_hold' | 'no_tombstone';
}

function requiredString(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function immutableTimestamp(name: string, value: string | Date | undefined, fallback: string): string {
  const timestamp = value === undefined ? fallback : value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${name} must be an RFC3339 timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function optionalTimestamp(name: string, value: string | Date | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return immutableTimestamp(name, value, new Date().toISOString());
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
  }
  return value;
}

/** Stable JSON used as the signature payload. */
export function canonicalizeRetentionRecord(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeRetentionRecord).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter(key => object[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalizeRetentionRecord(object[key])}`)
    .join(',')}}`;
}

function signaturePayload(record: Omit<RetentionControlRecord, 'signature'>): Buffer {
  return Buffer.from(canonicalizeRetentionRecord(record), 'utf8');
}

function signRecord(record: Omit<RetentionControlRecord, 'signature'>, privateKey: KeyLike): string {
  return sign(null, signaturePayload(record), privateKey).toString('base64url');
}

function baseRecord(input: RetentionRecordInput, recordType: RetentionControlRecord['recordType']) {
  const createdAt = immutableTimestamp('createdAt', input.createdAt, new Date().toISOString());
  const effectiveAt = immutableTimestamp('effectiveAt', input.effectiveAt, createdAt);

  return {
    schemaVersion: RETENTION_CONTROL_SCHEMA_VERSION,
    recordType,
    recordId: input.recordId ?? randomUUID(),
    tenantId: requiredString('tenantId', input.tenantId),
    tenantAuthority: requiredString('tenantAuthority', input.tenantAuthority),
    auditIdentity: requiredString('auditIdentity', input.auditIdentity),
    reasonClass: requiredString('reasonClass', input.reasonClass),
    createdAt,
    effectiveAt,
    signatureAlgorithm: RETENTION_SIGNATURE_ALGORITHM,
    ...(input.keyId === undefined ? {} : { keyId: requiredString('keyId', input.keyId) }),
  } as const;
}

/** Create and sign an occurrence tombstone. The returned record is immutable. */
export function createSignedOccurrenceTombstone(
  input: OccurrenceTombstoneInput,
  privateKey: KeyLike,
): OccurrenceTombstone {
  const unsigned = {
    ...baseRecord(input, 'occurrence_tombstone'),
    occurrenceId: requiredString('occurrenceId', input.occurrenceId),
    ...(input.occurrenceType === undefined ? {} : { occurrenceType: requiredString('occurrenceType', input.occurrenceType) }),
  } as Omit<OccurrenceTombstone, 'signature'>;
  return freezeDeep({ ...unsigned, signature: signRecord(unsigned, privateKey) });
}

/** Create and sign a legal hold. An omitted expiry is explicitly indefinite. */
export function createSignedLegalHold(input: LegalHoldInput, privateKey: KeyLike): LegalHoldRecord {
  const selector = { ...(input.selector ?? {}) };
  if (input.occurrenceId !== undefined) {
    selector.occurrenceId = requiredString('occurrenceId', input.occurrenceId);
  }
  if (Object.keys(selector).length === 0) {
    throw new Error('selector must identify at least one occurrence attribute');
  }
  for (const [key, value] of Object.entries(selector)) {
    requiredString(`selector.${key}`, value);
  }

  const unsigned = {
    ...baseRecord(input, 'legal_hold'),
    holdId: input.holdId ? requiredString('holdId', input.holdId) : randomUUID(),
    selector,
    expiresAt: optionalTimestamp('expiresAt', input.expiresAt) ?? null,
    ...(input.releasedAt === undefined ? {} : { releasedAt: immutableTimestamp('releasedAt', input.releasedAt, new Date().toISOString()) }),
  } as Omit<LegalHoldRecord, 'signature'>;

  if (unsigned.expiresAt !== null && Date.parse(unsigned.expiresAt) < Date.parse(unsigned.effectiveAt)) {
    throw new Error('expiresAt cannot be earlier than effectiveAt');
  }
  if (unsigned.releasedAt !== undefined && Date.parse(unsigned.releasedAt) < Date.parse(unsigned.effectiveAt)) {
    throw new Error('releasedAt cannot be earlier than effectiveAt');
  }

  return freezeDeep({ ...unsigned, signature: signRecord(unsigned, privateKey) });
}

/** Verify a record's Ed25519 signature without mutating it. */
export function verifyRetentionControlSignature(record: RetentionControlRecord, publicKey: KeyLike): boolean {
  try {
    validateRetentionControlRecord(record);
    const { signature: _signature, ...unsigned } = record;
    return verify(null, signaturePayload(unsigned), publicKey, Buffer.from(record.signature, 'base64url'));
  } catch {
    return false;
  }
}

/** Validate shape and immutable timestamp invariants. */
export function validateRetentionControlRecord(record: RetentionControlRecord): void {
  if (!record || typeof record !== 'object') throw new Error('retention control must be an object');
  if (record.schemaVersion !== RETENTION_CONTROL_SCHEMA_VERSION) throw new Error('unsupported retention control schema');
  if (record.signatureAlgorithm !== RETENTION_SIGNATURE_ALGORITHM) throw new Error('unsupported retention signature algorithm');
  requiredString('recordId', record.recordId);
  requiredString('tenantId', record.tenantId);
  requiredString('tenantAuthority', record.tenantAuthority);
  requiredString('auditIdentity', record.auditIdentity);
  requiredString('reasonClass', record.reasonClass);
  requiredString('signature', record.signature);
  immutableTimestamp('createdAt', record.createdAt, record.createdAt);
  immutableTimestamp('effectiveAt', record.effectiveAt, record.effectiveAt);

  if (record.recordType === 'occurrence_tombstone') {
    requiredString('occurrenceId', record.occurrenceId);
    return;
  }
  if (record.recordType === 'legal_hold') {
    requiredString('holdId', record.holdId);
    if (!record.selector || Object.keys(record.selector).length === 0) throw new Error('legal hold selector is empty');
    for (const [key, value] of Object.entries(record.selector)) requiredString(`selector.${key}`, value);
    if (record.expiresAt !== null) optionalTimestamp('expiresAt', record.expiresAt);
    if (record.releasedAt !== undefined) immutableTimestamp('releasedAt', record.releasedAt, record.releasedAt);
    return;
  }
  throw new Error('unknown retention control record type');
}

export function isLegalHoldActive(hold: LegalHoldRecord, now = Date.now()): boolean {
  validateRetentionControlRecord(hold);
  const effectiveAt = Date.parse(hold.effectiveAt);
  if (effectiveAt > now || hold.releasedAt !== undefined && Date.parse(hold.releasedAt) <= now) return false;
  return hold.expiresAt === null || Date.parse(hold.expiresAt) > now;
}

function selectorMatches(selector: LegalHoldSelector, occurrence: RetentionOccurrence): boolean {
  const pairs: Array<[keyof LegalHoldSelector, keyof RetentionOccurrence]> = [
    ['occurrenceId', 'occurrenceId'],
    ['path', 'path'],
    ['workerId', 'workerId'],
    ['sessionId', 'sessionId'],
    ['beadId', 'beadId'],
    ['host', 'host'],
  ];
  return pairs.every(([selectorKey, occurrenceKey]) =>
    selector[selectorKey] === undefined || selector[selectorKey] === occurrence[occurrenceKey]
  );
}

export function isOccurrenceHeld(
  occurrence: RetentionOccurrence | string,
  controls: readonly RetentionControlRecord[],
  now = Date.now(),
  tenantId?: string,
): boolean {
  const reference: RetentionOccurrence = typeof occurrence === 'string'
    ? { occurrenceId: occurrence, tenantId }
    : occurrence;
  return controls.some(control =>
    control.recordType === 'legal_hold' &&
    (control.tenantId === reference.tenantId || reference.tenantId === undefined) &&
    isLegalHoldActive(control, now) &&
    selectorMatches(control.selector, reference)
  );
}

function tombstonesOccurrence(occurrence: RetentionOccurrence, controls: readonly RetentionControlRecord[]): boolean {
  return controls.some(control =>
    control.recordType === 'occurrence_tombstone' &&
    control.tenantId === occurrence.tenantId &&
    control.occurrenceId === occurrence.occurrenceId
  );
}

/** A legal hold always wins over a tombstone and over an age-based policy. */
export function decideOccurrenceDeletion(
  occurrence: RetentionOccurrence,
  controls: readonly RetentionControlRecord[],
  now = Date.now(),
): DeletionDecision {
  const held = isOccurrenceHeld(occurrence, controls, now);
  if (held) return { allowed: false, tombstoned: tombstonesOccurrence(occurrence, controls), held: true, reason: 'legal_hold' };
  const tombstoned = tombstonesOccurrence(occurrence, controls);
  return { allowed: tombstoned, tombstoned, held: false, reason: tombstoned ? 'tombstone' : 'no_tombstone' };
}

/** Deterministic identifier used when a file is the retention occurrence. */
export function occurrenceIdForPath(filePath: string): string {
  return `path:${createHash('sha256').update(path.resolve(filePath)).digest('hex')}`;
}

export interface RetentionControlStoreOptions {
  /** Kept outside the raw log directory by callers. */
  directory: string;
  publicKey?: KeyLike;
}

/** Append-only persistence for signed controls. Never accepts raw LogEvents. */
export class RetentionControlStore {
  private readonly filePath: string;
  private readonly publicKey?: KeyLike;
  private loaded = false;
  private controls: RetentionControlRecord[] = [];

  constructor(options: RetentionControlStoreOptions) {
    this.filePath = path.join(options.directory, 'controls.jsonl');
    this.publicKey = options.publicKey;
  }

  private loadIfNeeded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!fs.existsSync(this.filePath)) return;
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const record = JSON.parse(line) as RetentionControlRecord;
      validateRetentionControlRecord(record);
      if (this.publicKey && !verifyRetentionControlSignature(record, this.publicKey)) {
        throw new Error(`invalid retention control signature: ${record.recordId}`);
      }
      if (this.controls.some(existing => existing.recordId === record.recordId)) continue;
      this.controls.push(freezeDeep(record));
    }
  }

  append(record: RetentionControlRecord): RetentionControlRecord {
    this.loadIfNeeded();
    validateRetentionControlRecord(record);
    if (this.publicKey && !verifyRetentionControlSignature(record, this.publicKey)) {
      throw new Error(`invalid retention control signature: ${record.recordId}`);
    }
    const existing = this.controls.find(candidate => candidate.recordId === record.recordId);
    if (existing) {
      if (canonicalizeRetentionRecord(existing) !== canonicalizeRetentionRecord(record)) {
        throw new Error(`retention control recordId already exists: ${record.recordId}`);
      }
      return existing;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(this.filePath, 0o600);
    this.controls.push(freezeDeep(record));
    return record;
  }

  records(): readonly RetentionControlRecord[] {
    this.loadIfNeeded();
    return [...this.controls];
  }
}

export function generateRetentionAuthorityKeyPair(): { publicKey: KeyLike; privateKey: KeyLike } {
  const pair = generateKeyPairSync('ed25519');
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export function defaultRetentionControlDirectory(logDir: string): string {
  return path.join(path.dirname(path.resolve(logDir)), 'retention-controls');
}

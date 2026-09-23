import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createSignedLegalHold,
  createSignedOccurrenceTombstone,
  decideOccurrenceDeletion,
  generateRetentionAuthorityKeyPair,
  isLegalHoldActive,
  occurrenceIdForPath,
  RetentionControlStore,
  verifyRetentionControlSignature,
} from './retentionControls.js';
import { pruneLogs } from './logPruner.js';

describe('retention controls', () => {
  it('signs and verifies immutable occurrence tombstones', () => {
    const { privateKey, publicKey } = generateRetentionAuthorityKeyPair();
    const tombstone = createSignedOccurrenceTombstone({
      occurrenceId: 'occ-1',
      tenantId: 'tenant-a',
      tenantAuthority: 'tenant-a-retention',
      auditIdentity: 'service/audit',
      reasonClass: 'privacy',
      createdAt: '2026-09-22T12:00:00.000Z',
    }, privateKey);

    expect(tombstone.recordType).toBe('occurrence_tombstone');
    expect(verifyRetentionControlSignature(tombstone, publicKey)).toBe(true);
    expect(Object.isFrozen(tombstone)).toBe(true);
    expect(() => {
      (tombstone as { occurrenceId: string }).occurrenceId = 'changed';
    }).toThrow();
  });

  it('defaults legal holds to an indefinite lifetime and lets a release record end one', () => {
    const { privateKey } = generateRetentionAuthorityKeyPair();
    const hold = createSignedLegalHold({
      holdId: 'hold-1',
      occurrenceId: 'occ-1',
      tenantId: 'tenant-a',
      tenantAuthority: 'tenant-a-retention',
      auditIdentity: 'counsel/alice',
      reasonClass: 'legal',
      effectiveAt: '2026-09-01T00:00:00.000Z',
    }, privateKey);

    expect(hold.expiresAt).toBeNull();
    expect(isLegalHoldActive(hold, Date.parse('2099-01-01T00:00:00.000Z'))).toBe(true);

    const released = createSignedLegalHold({
      ...hold,
      recordId: 'hold-1-release',
      releasedAt: '2026-09-23T00:00:00.000Z',
    }, privateKey);
    expect(isLegalHoldActive(released, Date.parse('2026-09-24T00:00:00.000Z'))).toBe(false);
  });

  it('keeps signed control data in its own append-only store', () => {
    const { privateKey, publicKey } = generateRetentionAuthorityKeyPair();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-retention-control-'));
    const controlDirectory = path.join(root, 'retention-controls');
    try {
      const store = new RetentionControlStore({ directory: controlDirectory, publicKey });
      const record = createSignedOccurrenceTombstone({
        occurrenceId: 'occ-2',
        tenantId: 'tenant-a',
        tenantAuthority: 'tenant-a-retention',
        auditIdentity: 'service/audit',
        reasonClass: 'operational',
      }, privateKey);
      store.append(record);

      expect(store.records()).toHaveLength(1);
      expect(fs.existsSync(path.join(controlDirectory, 'controls.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'logs', 'controls.jsonl'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('makes holds override a signed tombstone', () => {
    const { privateKey } = generateRetentionAuthorityKeyPair();
    const tombstone = createSignedOccurrenceTombstone({
      occurrenceId: 'occ-3',
      tenantId: 'tenant-a',
      tenantAuthority: 'tenant-a-retention',
      auditIdentity: 'service/audit',
      reasonClass: 'privacy',
    }, privateKey);
    const hold = createSignedLegalHold({
      occurrenceId: 'occ-3',
      tenantId: 'tenant-a',
      tenantAuthority: 'tenant-a-retention',
      auditIdentity: 'counsel/alice',
      reasonClass: 'legal',
    }, privateKey);

    expect(decideOccurrenceDeletion(
      { occurrenceId: 'occ-3', tenantId: 'tenant-a' },
      [tombstone, hold],
    )).toEqual({ allowed: false, tombstoned: true, held: true, reason: 'legal_hold' });
  });

  it('keeps omitted prune windows indefinite, while an active hold blocks deletion', () => {
    const { privateKey } = generateRetentionAuthorityKeyPair();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-retention-prune-'));
    const logDir = path.join(root, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const filePath = path.join(logDir, 'old.jsonl');
    fs.writeFileSync(filePath, '{}\n');
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.utimesSync(filePath, old, old);
    const occurrenceId = occurrenceIdForPath(filePath);
    const tombstone = createSignedOccurrenceTombstone({
      occurrenceId,
      tenantId: 'tenant-a',
      tenantAuthority: 'tenant-a-retention',
      auditIdentity: 'service/audit',
      reasonClass: 'privacy',
    }, privateKey);
    const hold = createSignedLegalHold({
      occurrenceId,
      tenantId: 'tenant-a',
      tenantAuthority: 'tenant-a-retention',
      auditIdentity: 'counsel/alice',
      reasonClass: 'legal',
    }, privateKey);

    try {
      const indefinite = pruneLogs({ logDir, tenantId: 'tenant-a' });
      expect(indefinite.filesDeleted).toBe(0);
      expect(fs.existsSync(filePath)).toBe(true);

      const held = pruneLogs({
        logDir,
        tenantId: 'tenant-a',
        maxAgeDays: 7,
        controls: [tombstone, hold],
      });
      expect(held.filesDeleted).toBe(0);
      expect(fs.existsSync(filePath)).toBe(true);

      const removed = pruneLogs({
        logDir,
        tenantId: 'tenant-a',
        controls: [tombstone],
      });
      expect(removed.filesDeleted).toBe(1);
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InMemoryEventStore } from '../store.js';
import {
  createSignedLegalHold,
  generateRetentionAuthorityKeyPair,
  RetentionControlStore,
} from '../retentionControls.js';
import { createWebServer, type WebServer } from './server.js';

describe('retention control HTTP boundary', () => {
  let server: WebServer | undefined;
  let store: InMemoryEventStore | undefined;
  let root: string | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => {
        server!.on('stop', () => resolve());
        server!.stop();
      });
    }
    store?.clear();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts only signed controls on the control surface and has no event delete route', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-retention-http-'));
    const logs = path.join(root, 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const { privateKey, publicKey } = generateRetentionAuthorityKeyPair();
    const controls = new RetentionControlStore({
      directory: path.join(root, 'retention-controls'),
      publicKey,
    });
    store = new InMemoryEventStore();
    server = createWebServer({ port: 0, logPath: logs, store, retentionControlStore: controls });
    await new Promise<void>(resolve => {
      server!.on('start', () => resolve());
      server!.start();
    });

    const hold = createSignedLegalHold({
      occurrenceId: 'occ-http',
      tenantId: 'tenant-a',
      tenantAuthority: 'tenant-a-retention',
      auditIdentity: 'counsel/alice',
      reasonClass: 'legal',
    }, privateKey);
    const holdResponse = await fetch(`http://localhost:${server.getPort()}/api/retention/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hold),
    });
    expect(holdResponse.status).toBe(201);

    const rawEventResponse = await fetch(`http://localhost:${server.getPort()}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        event: 'raw.event',
        worker: 'worker-a',
        recordType: 'legal_hold',
        occurrenceId: 'occ-forged',
      }),
    });
    expect(rawEventResponse.status).toBe(201);
    expect(controls.records()).toHaveLength(1);

    const deleteResponse = await fetch(`http://localhost:${server.getPort()}/api/events`, { method: 'DELETE' });
    expect(deleteResponse.status).toBe(405);
  });
});

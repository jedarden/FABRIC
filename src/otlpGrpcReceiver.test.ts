/**
 * Integration test for OTLP/gRPC receiver
 *
 * Starts a real gRPC server, sends OTLP Export requests using a gRPC client,
 * and asserts that NeedleEvents arrive on the event bus.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import * as protobuf from 'protobufjs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { OtlpGrpcReceiver, enrichRecord, extractDataPoints, loadProtoRoot } from './otlpGrpcReceiver.js';
import { LogEvent } from './types.js';

// ── Unit tests for helper functions ───────────────────────────

describe('enrichRecord', () => {
  it('merges scope and resource attributes into record', () => {
    const record = { timeUnixNano: '1709150400000000000' };
    const scope = { name: 'needle', attributes: [
      { key: 'scope_key', value: { stringValue: 'scope_val' } },
    ]};
    const resource = { attributes: [
      { key: 'res_key', value: { stringValue: 'res_val' } },
    ]};

    const merged = enrichRecord(record, scope, resource);
    expect(merged.timeUnixNano).toBe('1709150400000000000');

    const attrs = merged.attributes as Array<{ key: string }>;
    expect(attrs).toHaveLength(2);
    expect(attrs[0].key).toBe('res_key');
    expect(attrs[1].key).toBe('scope_key');
  });

  it('returns record unchanged when no scope/resource', () => {
    const record = { timeUnixNano: '123', attributes: [{ key: 'k', value: { stringValue: 'v' } }] };
    const merged = enrichRecord(record);
    expect(merged.attributes).toEqual(record.attributes);
  });
});

describe('extractDataPoints', () => {
  it('extracts data points from gauge metric', () => {
    const metric = {
      name: 'test_metric',
      gauge: {
        dataPoints: [
          { timeUnixNano: '1709150400000000000', asDouble: 42.5, attributes: [] },
        ],
      },
    };
    const points = extractDataPoints(metric);
    expect(points).toHaveLength(1);
    expect(points[0].asDouble).toBe(42.5);
  });

  it('extracts data points from sum metric', () => {
    const metric = {
      name: 'request_count',
      sum: {
        dataPoints: [
          { timeUnixNano: '1709150400000000000', asInt: '100', attributes: [] },
        ],
      },
    };
    const points = extractDataPoints(metric);
    expect(points).toHaveLength(1);
    expect(points[0].asInt).toBe('100');
  });

  it('returns empty array for metric with no data points', () => {
    expect(extractDataPoints({ name: 'empty' })).toHaveLength(0);
  });
});

// ── Integration tests with real gRPC ──────────────────────────

describe('OtlpGrpcReceiver integration', () => {
  let receiver: OtlpGrpcReceiver;
  let clientRoot: protobuf.Root;
  let client: grpc.Client;
  let collectedEvents: LogEvent[];
  let boundPort: number;

  beforeAll(async () => {
    clientRoot = await loadProtoRoot();
  });

  beforeEach(async () => {
    collectedEvents = [];
    receiver = new OtlpGrpcReceiver({ address: '127.0.0.1:0' });
    receiver.on('event', (event: LogEvent) => {
      collectedEvents.push(event);
    });
    const addr = await receiver.start();
    boundPort = parseInt(addr.split(':')[1], 10);

    // Create gRPC client
    const LogsServiceDef = buildClientServiceDef(
      clientRoot,
      '/opentelemetry.proto.collector.logs.v1.LogsService/Export',
      'opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest',
      'opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse',
    );
    client = new grpc.Client(
      `127.0.0.1:${boundPort}`,
      grpc.credentials.createInsecure(),
    );
  });

  afterEach(async () => {
    client.close();
    await receiver.stop();
  });

  it('accepts a log export and emits a normalized LogEvent', async () => {
    const reqType = clientRoot.lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest')!;
    const resType = clientRoot.lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse')!;

    const nowNs = String(Date.now() * 1_000_000);
    const requestPayload = reqType.create({
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: nowNs,
            attributes: [
              { key: 'event_type', value: { stringValue: 'worker.started' } },
              { key: 'worker_id', value: { stringValue: 'needle-alpha' } },
              { key: 'session_id', value: { stringValue: 'sess-001' } },
              { key: 'sequence', value: { intValue: 1 } },
            ],
          }],
        }],
      }],
    });

    const requestBytes = Buffer.from(reqType.encode(requestPayload).finish());

    await new Promise<void>((resolve, reject) => {
      client.makeUnaryRequest(
        '/opentelemetry.proto.collector.logs.v1.LogsService/Export',
        (msg: any) => Buffer.from(reqType.encode(msg).finish()),
        (buf: Buffer) => resType.decode(new Uint8Array(buf)) as any,
        requestPayload,
        (err: grpc.ServiceError | null, resp: any) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    // Wait for event propagation
    await new Promise((r) => setTimeout(r, 100));

    expect(collectedEvents).toHaveLength(1);
    const event = collectedEvents[0];
    expect(event.worker).toBe('needle-alpha');
    expect(event.msg).toBe('worker.started');
    expect(event.session).toBe('sess-001');
  });

  it('accepts an empty export without error', async () => {
    const reqType = clientRoot.lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest')!;
    const resType = clientRoot.lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse')!;

    await new Promise<void>((resolve, reject) => {
      client.makeUnaryRequest(
        '/opentelemetry.proto.collector.logs.v1.LogsService/Export',
        (msg: any) => Buffer.from(reqType.encode(msg).finish()),
        (buf: Buffer) => resType.decode(new Uint8Array(buf)) as any,
        {},
        (err: grpc.ServiceError | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(collectedEvents).toHaveLength(0);
  });
});

// ── Helper: build a minimal client-side MethodDefinition ──────

function buildClientServiceDef(
  root: protobuf.Root,
  servicePath: string,
  requestFqn: string,
  _responseFqn: string,
): grpc.MethodDefinition<any, any> {
  const reqType = root.lookupType(requestFqn);
  return {
    path: servicePath,
    requestStream: false,
    responseStream: false,
    requestSerialize: (msg: any) =>
      Buffer.from(reqType.encode(reqType.create(msg)).finish()),
    requestDeserialize: (buf: Buffer) =>
      reqType.toObject(reqType.decode(new Uint8Array(buf)), { longs: String }),
    responseSerialize: () => Buffer.alloc(0),
    responseDeserialize: () => ({}),
  };
}

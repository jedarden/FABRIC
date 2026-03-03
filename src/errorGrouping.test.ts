/**
 * Tests for Error Grouping Module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  categorizeError,
  fingerprintError,
  fingerprintsMatch,
  ErrorGroupManager,
  getErrorGroupManager,
  resetErrorGroupManager,
} from './errorGrouping.js';
import { LogEvent, ErrorCategory } from './types.js';

describe('categorizeError', () => {
  it('should categorize network errors', () => {
    expect(categorizeError('ECONNREFUSED')).toBe('network');
    expect(categorizeError('Connection refused to 192.168.1.1:8080')).toBe('network');
    expect(categorizeError('ETIMEDOUT connecting to server')).toBe('network');
    expect(categorizeError('DNS lookup failed')).toBe('network');
    expect(categorizeError('socket hang up')).toBe('network');
  });

  it('should categorize permission errors', () => {
    expect(categorizeError('EACCES: permission denied')).toBe('permission');
    expect(categorizeError('Access denied for user admin')).toBe('permission');
    expect(categorizeError('Unauthorized (401)')).toBe('permission');
    expect(categorizeError('Forbidden: insufficient permissions')).toBe('permission');
  });

  it('should categorize not found errors', () => {
    expect(categorizeError('ENOENT: no such file')).toBe('not_found');
    expect(categorizeError('404 Not Found')).toBe('not_found');
    expect(categorizeError('Resource does not exist')).toBe('not_found');
  });

  it('should categorize timeout errors', () => {
    expect(categorizeError('ETIMEDOUT')).toBe('timeout');
    expect(categorizeError('Request timeout after 30000ms')).toBe('timeout');
    expect(categorizeError('Timeout expired')).toBe('timeout');
  });

  it('should categorize resource errors', () => {
    expect(categorizeError('ENOMEM: out of memory')).toBe('resource');
    expect(categorizeError('Disk full, no space left')).toBe('resource');
    expect(categorizeError('Rate limit exceeded (429)')).toBe('resource');
    expect(categorizeError('Quota exceeded for user')).toBe('resource');
  });

  it('should categorize validation errors', () => {
    expect(categorizeError('Invalid input format')).toBe('validation');
    expect(categorizeError('Cannot read property "x" of undefined')).toBe('validation');
    expect(categorizeError('Expected string but got number')).toBe('validation');
    expect(categorizeError('undefined is not a function')).toBe('validation');
  });

  it('should categorize syntax errors', () => {
    expect(categorizeError('SyntaxError: Unexpected token')).toBe('syntax');
    expect(categorizeError('JSON parse error at line 42')).toBe('syntax');
    expect(categorizeError('YAML parse error')).toBe('syntax');
    expect(categorizeError('invalid format: malformed input')).toBe('syntax');
  });

  it('should categorize tool errors', () => {
    expect(categorizeError('Tool execution failed')).toBe('tool');
    expect(categorizeError('Command failed with exit code 1')).toBe('tool');
    expect(categorizeError('spawn child process error')).toBe('tool');
  });

  it('should return unknown for unrecognized errors', () => {
    expect(categorizeError('Something weird happened')).toBe('unknown');
    expect(categorizeError('Oops')).toBe('unknown');
  });
});

describe('fingerprintError', () => {
  const createErrorEvent = (msg: string, error?: string): LogEvent => ({
    ts: Date.now(),
    worker: 'w-test',
    level: 'error',
    msg,
    error,
  });

  it('should create consistent fingerprints for similar errors', () => {
    const event1 = createErrorEvent('Connection refused', 'ECONNREFUSED 192.168.1.1:8080');
    const event2 = createErrorEvent('Connection refused', 'ECONNREFUSED 10.0.0.1:3000');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp1.category).toBe('network');
    expect(fp2.category).toBe('network');
  });

  it('should create different fingerprints for different error types', () => {
    const event1 = createErrorEvent('Error', 'ECONNREFUSED');
    const event2 = createErrorEvent('Error', 'Permission denied');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    expect(fp1.hash).not.toBe(fp2.hash);
    expect(fp1.category).toBe('network');
    expect(fp2.category).toBe('permission');
  });

  it('should normalize IP addresses', () => {
    const event = createErrorEvent('Network error', 'ECONNREFUSED 192.168.1.100:443');

    const fp = fingerprintError(event);

    // IP addresses should be normalized to wildcards
    expect(fp.signature).toMatch(/\*:\*/);
    expect(fp.category).toBe('network');
  });

  it('should normalize file paths', () => {
    const event = createErrorEvent('File error', 'ENOENT: no such file "/home/user/data.json"');

    const fp = fingerprintError(event);

    expect(fp.signature).not.toContain('/home/user/data.json');
    expect(fp.category).toBe('not_found');
  });

  it('should normalize UUIDs', () => {
    const event = createErrorEvent('Error', 'Invalid UUID 123e4567-e89b-12d3-a456-426614174000');

    const fp = fingerprintError(event);

    expect(fp.signature).not.toContain('123e4567-e89b-12d3-a456-426614174000');
    expect(fp.signature).toContain('*UUID*');
  });

  it('should use event.msg when event.error is not present', () => {
    const event = createErrorEvent('ECONNREFUSED connection failed');

    const fp = fingerprintError(event);

    expect(fp.sampleMessage).toBe('ECONNREFUSED connection failed');
    expect(fp.category).toBe('network');
  });

  it('should truncate long signatures', () => {
    const longMessage = 'ECONNREFUSED ' + 'x'.repeat(300);
    const event = createErrorEvent('Error', longMessage);

    const fp = fingerprintError(event);

    expect(fp.signature.length).toBeLessThanOrEqual(203); // 200 + '...'
  });

  it('should remove stack traces from signature', () => {
    const event = createErrorEvent('Error', 'TypeError: Cannot read property "x"\n    at Object.foo\n    at bar');

    const fp = fingerprintError(event);

    expect(fp.signature).not.toContain('at Object.foo');
    expect(fp.signature).toContain('TypeError');
  });
});

describe('fingerprintsMatch', () => {
  it('should return true for matching fingerprints', () => {
    const event: LogEvent = {
      ts: Date.now(),
      worker: 'w-test',
      level: 'error',
      msg: 'ECONNREFUSED',
    };

    const fp1 = fingerprintError(event);
    const fp2 = fingerprintError(event);

    expect(fingerprintsMatch(fp1, fp2)).toBe(true);
  });

  it('should return false for different fingerprints', () => {
    const event1: LogEvent = {
      ts: Date.now(),
      worker: 'w-test',
      level: 'error',
      msg: 'ECONNREFUSED',
    };
    const event2: LogEvent = {
      ts: Date.now(),
      worker: 'w-test',
      level: 'error',
      msg: 'Permission denied',
    };

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    expect(fingerprintsMatch(fp1, fp2)).toBe(false);
  });
});

describe('ErrorGroupManager', () => {
  let manager: ErrorGroupManager;

  beforeEach(() => {
    manager = new ErrorGroupManager();
  });

  const createErrorEvent = (msg: string, worker = 'w-test'): LogEvent => ({
    ts: Date.now(),
    worker,
    level: 'error',
    msg,
  });

  describe('addError', () => {
    it('should create a new group for first error', () => {
      const event = createErrorEvent('ECONNREFUSED');
      const group = manager.addError(event);

      expect(group.count).toBe(1);
      expect(group.events).toHaveLength(1);
      expect(group.fingerprint.category).toBe('network');
      expect(group.affectedWorkers).toContain('w-test');
    });

    it('should add to existing group for similar errors', () => {
      const event1 = createErrorEvent('ECONNREFUSED 192.168.1.1:8080');
      const event2 = createErrorEvent('ECONNREFUSED 10.0.0.1:3000');

      const group1 = manager.addError(event1);
      const group2 = manager.addError(event2);

      expect(group1.id).toBe(group2.id);
      expect(group2.count).toBe(2);
    });

    it('should track multiple workers', () => {
      const event1 = createErrorEvent('ECONNREFUSED', 'w-worker1');
      const event2 = createErrorEvent('ECONNREFUSED', 'w-worker2');
      const event3 = createErrorEvent('ECONNREFUSED', 'w-worker1');

      manager.addError(event1);
      manager.addError(event2);
      const group = manager.addError(event3);

      expect(group.affectedWorkers).toHaveLength(2);
      expect(group.affectedWorkers).toContain('w-worker1');
      expect(group.affectedWorkers).toContain('w-worker2');
      expect(group.count).toBe(3);
    });

    it('should create separate groups for different error types', () => {
      const event1 = createErrorEvent('ECONNREFUSED');
      const event2 = createErrorEvent('Permission denied');

      const group1 = manager.addError(event1);
      const group2 = manager.addError(event2);

      expect(group1.id).not.toBe(group2.id);
      expect(manager.size).toBe(2);
    });
  });

  describe('getGroups', () => {
    it('should return all groups sorted by severity and activity', () => {
      // Add multiple errors of different types
      for (let i = 0; i < 10; i++) {
        manager.addError(createErrorEvent('ECONNREFUSED'));
      }
      for (let i = 0; i < 5; i++) {
        manager.addError(createErrorEvent('Permission denied'));
      }
      manager.addError(createErrorEvent('Timeout'));

      const groups = manager.getGroups();

      // First group should be the one with most occurrences (network)
      expect(groups[0].count).toBe(10);
      expect(groups[0].fingerprint.category).toBe('network');
    });
  });

  describe('getActiveGroups', () => {
    it('should return only active groups', () => {
      manager.addError(createErrorEvent('ECONNREFUSED'));

      const activeGroups = manager.getActiveGroups();

      expect(activeGroups).toHaveLength(1);
    });

    it('should not return inactive groups', () => {
      // Create manager with very short active window
      const shortManager = new ErrorGroupManager({ activeWindowMs: 1 });
      const event: LogEvent = {
        ts: Date.now() - 10000, // 10 seconds ago
        worker: 'w-test',
        level: 'error',
        msg: 'ECONNREFUSED',
      };

      shortManager.addError(event);
      const activeGroups = shortManager.getActiveGroups();

      expect(activeGroups).toHaveLength(0);
    });
  });

  describe('getWorkerGroups', () => {
    it('should return groups affecting specific worker', () => {
      manager.addError(createErrorEvent('ECONNREFUSED', 'w-worker1'));
      manager.addError(createErrorEvent('Permission denied', 'w-worker2'));

      const worker1Groups = manager.getWorkerGroups('w-worker1');
      const worker2Groups = manager.getWorkerGroups('w-worker2');

      expect(worker1Groups).toHaveLength(1);
      expect(worker1Groups[0].fingerprint.category).toBe('network');

      expect(worker2Groups).toHaveLength(1);
      expect(worker2Groups[0].fingerprint.category).toBe('permission');
    });
  });

  describe('getGroupsByCategory', () => {
    it('should return groups by category', () => {
      manager.addError(createErrorEvent('ECONNREFUSED connection refused'));
      manager.addError(createErrorEvent('Permission denied access error'));
      manager.addError(createErrorEvent('File not found'));

      const networkGroups = manager.getGroupsByCategory('network');
      const permissionGroups = manager.getGroupsByCategory('permission');
      const notFoundGroups = manager.getGroupsByCategory('not_found');

      expect(networkGroups).toHaveLength(1);
      expect(permissionGroups).toHaveLength(1);
      expect(notFoundGroups).toHaveLength(1);
      expect(manager.size).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      for (let i = 0; i < 5; i++) {
        manager.addError(createErrorEvent('ECONNREFUSED'));
      }
      for (let i = 0; i < 3; i++) {
        manager.addError(createErrorEvent('Permission denied'));
      }

      const stats = manager.getStats();

      expect(stats.totalGroups).toBe(2);
      expect(stats.totalErrors).toBe(8);
      expect(stats.activeGroups).toBe(2);
      expect(stats.byCategory.network).toBe(1);
      expect(stats.byCategory.permission).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all groups', () => {
      manager.addError(createErrorEvent('ECONNREFUSED'));
      manager.addError(createErrorEvent('Permission denied'));

      expect(manager.size).toBe(2);

      manager.clear();

      expect(manager.size).toBe(0);
    });
  });

  describe('maxGroups option', () => {
    it('should trim groups when exceeding maxGroups', () => {
      const smallManager = new ErrorGroupManager({ maxGroups: 5 });

      // Add 10 different error types
      for (let i = 0; i < 10; i++) {
        smallManager.addError(createErrorEvent(`Unique error ${i}`));
      }

      expect(smallManager.size).toBeLessThanOrEqual(5);
    });
  });

  describe('severity calculation', () => {
    it('should increase severity with count', () => {
      const manager = new ErrorGroupManager({
        highSeverityThreshold: 3,
        criticalSeverityThreshold: 5,
      });

      for (let i = 0; i < 5; i++) {
        manager.addError(createErrorEvent('ECONNREFUSED'));
      }

      const groups = manager.getGroups();
      expect(groups[0].severity).toBe('critical');
    });
  });
});

describe('Global manager', () => {
  beforeEach(() => {
    resetErrorGroupManager();
  });

  afterEach(() => {
    resetErrorGroupManager();
  });

  it('should return singleton instance', () => {
    const manager1 = getErrorGroupManager();
    const manager2 = getErrorGroupManager();

    expect(manager1).toBe(manager2);
  });

  it('should reset singleton', () => {
    const manager1 = getErrorGroupManager();
    manager1.addError({
      ts: Date.now(),
      worker: 'w-test',
      level: 'error',
      msg: 'Test error',
    });

    resetErrorGroupManager();

    const manager2 = getErrorGroupManager();
    expect(manager2.size).toBe(0);
  });
});

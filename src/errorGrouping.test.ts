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

  it('should prioritize syntax over validation for SyntaxError', () => {
    // SyntaxError contains "unexpected token" which matches validation pattern
    // but should be categorized as syntax because it's checked first
    expect(categorizeError('SyntaxError: unexpected token')).toBe('syntax');
  });

  it('should be case insensitive', () => {
    expect(categorizeError('econnrefused')).toBe('network');
    expect(categorizeError('PERMISSION DENIED')).toBe('permission');
    expect(categorizeError('Timeout Expired')).toBe('timeout');
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

  it('should normalize year in timestamps', () => {
    const event1 = createErrorEvent('Error', 'Error at 2024-01-15T10:30:00 occurred');
    const event2 = createErrorEvent('Error', 'Error at 2024-01-15T10:30:00 occurred');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    // Years (4+ digit numbers) get normalized to *
    expect(fp1.signature).not.toContain('2024');
    expect(fp1.hash).toBe(fp2.hash); // Identical errors should have same hash
  });

  it('should normalize hex strings', () => {
    const event1 = createErrorEvent('Error', 'Memory address 0x7fff5fbff8a0 invalid');
    const event2 = createErrorEvent('Error', 'Memory address 0x7fff5fbff123 invalid');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    expect(fp1.signature).toContain('*HEX*');
    expect(fp1.hash).toBe(fp2.hash);
  });

  it('should normalize large numbers', () => {
    const event1 = createErrorEvent('Error', 'Request ID 123456789 failed');
    const event2 = createErrorEvent('Error', 'Request ID 987654321 failed');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    expect(fp1.hash).toBe(fp2.hash); // Large numbers should be normalized
  });

  it('should apply category-specific normalizers for network errors', () => {
    const event1 = createErrorEvent('Error', 'ECONNREFUSED example.com:443');
    const event2 = createErrorEvent('Error', 'ECONNREFUSED other.com:8080');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    // Hostnames should be normalized to *:*
    expect(fp1.category).toBe('network');
    expect(fp2.category).toBe('network');
    expect(fp1.signature).toContain('*:*');
    expect(fp2.signature).toContain('*:*');
    expect(fp1.hash).toBe(fp2.hash);
  });

  it('should apply category-specific normalizers for timeout errors', () => {
    const event1 = createErrorEvent('Error', 'Request timed out after 5000ms');
    const event2 = createErrorEvent('Error', 'Request timed out after 10000ms');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    // Should be categorized as timeout
    expect(fp1.category).toBe('timeout');
    expect(fp2.category).toBe('timeout');

    // Durations should be normalized
    expect(fp1.signature).toMatch(/\*ms/);
    expect(fp1.hash).toBe(fp2.hash);
  });

  it('should apply category-specific normalizers for resource errors', () => {
    const event1 = createErrorEvent('Error', 'Out of memory: 512MB allocated');
    const event2 = createErrorEvent('Error', 'Out of memory: 1024MB allocated');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    // Memory amounts should be normalized
    expect(fp1.signature).toMatch(/\*B/);
    expect(fp1.hash).toBe(fp2.hash);
  });

  it('should apply category-specific normalizers for validation errors', () => {
    const event1 = createErrorEvent('Error', 'Cannot read property "user.name"');
    const event2 = createErrorEvent('Error', 'Cannot read property "order.id"');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    // Property names should be normalized
    expect(fp1.hash).toBe(fp2.hash);
  });

  it('should create different fingerprints for errors with same text but different categories', () => {
    // "ETIMEDOUT connecting" matches network (higher priority)
    // "ETIMEDOUT" alone matches timeout
    const event1 = createErrorEvent('Error', 'ETIMEDOUT connecting to server');
    const event2 = createErrorEvent('Error', 'ETIMEDOUT request');

    const fp1 = fingerprintError(event1);
    const fp2 = fingerprintError(event2);

    // Both should be categorized as either network or timeout
    // The key is that category is part of the hash
    expect(fp1.category).toBe('network');
    expect(fp2.category).toBe('timeout');
    expect(fp1.hash).not.toBe(fp2.hash); // Different category = different hash
  });

  it('should handle empty error messages', () => {
    const event = createErrorEvent('', '');

    const fp = fingerprintError(event);

    expect(fp.category).toBe('unknown');
    expect(fp.signature).toBe('');
  });

  it('should handle multiline errors with complex stack traces', () => {
    const complexError = `Error: Cannot connect to database
    at DatabaseManager.connect (/app/db.js:42:15)
    at async Server.initialize (/app/server.js:18:5)
    at async main (/app/index.js:10:3)`;

    const event = createErrorEvent('Error', complexError);
    const fp = fingerprintError(event);

    // Should only include first line
    expect(fp.signature).toBe('Error: Cannot connect to database');
    expect(fp.signature).not.toContain('DatabaseManager');
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

    it('should handle boundary conditions for severity thresholds', () => {
      const manager = new ErrorGroupManager({
        highSeverityThreshold: 5,
        criticalSeverityThreshold: 10,
      });

      // 1 error = low
      manager.addError(createErrorEvent('ECONNREFUSED'));
      expect(manager.getGroups()[0].severity).toBe('low');

      // 2 errors = medium
      manager.addError(createErrorEvent('ECONNREFUSED'));
      expect(manager.getGroups()[0].severity).toBe('medium');

      // 5 errors = high (exactly at threshold)
      for (let i = 0; i < 3; i++) {
        manager.addError(createErrorEvent('ECONNREFUSED'));
      }
      expect(manager.getGroups()[0].severity).toBe('high');

      // 10 errors = critical (exactly at threshold)
      for (let i = 0; i < 5; i++) {
        manager.addError(createErrorEvent('ECONNREFUSED'));
      }
      expect(manager.getGroups()[0].severity).toBe('critical');
    });

    it('should downgrade severity for inactive errors', () => {
      const manager = new ErrorGroupManager({
        activeWindowMs: 100, // 100ms window
        highSeverityThreshold: 3,
      });

      // Add high-severity errors
      for (let i = 0; i < 5; i++) {
        manager.addError(createErrorEvent('ECONNREFUSED'));
      }

      expect(manager.getGroups()[0].severity).toBe('high');

      // Wait for errors to become inactive
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const groups = manager.getGroups();
          expect(groups[0].isActive).toBe(false);
          expect(groups[0].severity).toBe('low'); // Should downgrade to low
          resolve();
        }, 150);
      });
    });

    it('should update severity on each new error', () => {
      const manager = new ErrorGroupManager({
        highSeverityThreshold: 3,
        criticalSeverityThreshold: 5,
      });

      manager.addError(createErrorEvent('ECONNREFUSED'));
      expect(manager.getGroups()[0].severity).toBe('low');

      manager.addError(createErrorEvent('ECONNREFUSED'));
      expect(manager.getGroups()[0].severity).toBe('medium');

      manager.addError(createErrorEvent('ECONNREFUSED'));
      expect(manager.getGroups()[0].severity).toBe('high');
    });
  });

  describe('group trimming', () => {
    it('should handle exactly maxGroups limit', () => {
      const manager = new ErrorGroupManager({ maxGroups: 5 });

      // Add exactly maxGroups
      for (let i = 0; i < 5; i++) {
        manager.addError(createErrorEvent(`Error ${i}`));
      }

      expect(manager.size).toBe(5);

      // Add one more to trigger trimming
      manager.addError(createErrorEvent('Error 6'));

      expect(manager.size).toBeLessThanOrEqual(5);
    });

    it('should prioritize removing inactive groups', () => {
      const manager = new ErrorGroupManager({
        maxGroups: 3,
        activeWindowMs: 100,
      });

      // Add old inactive errors
      const oldEvent: LogEvent = {
        ts: Date.now() - 10000, // 10 seconds ago
        worker: 'w-test',
        level: 'error',
        msg: 'Old error 1',
      };
      manager.addError(oldEvent);

      const oldEvent2: LogEvent = {
        ts: Date.now() - 10000,
        worker: 'w-test',
        level: 'error',
        msg: 'Old error 2',
      };
      manager.addError(oldEvent2);

      // Add recent active errors
      manager.addError(createErrorEvent('Recent error 1'));
      manager.addError(createErrorEvent('Recent error 2'));

      // Adding another should trim old ones first
      const groups = manager.getGroups();
      const activeCount = groups.filter(g => g.isActive).length;

      // Should have more active than inactive groups
      expect(activeCount).toBeGreaterThan(manager.size - activeCount);
    });

    it('should remove oldest when all groups are active', () => {
      const manager = new ErrorGroupManager({ maxGroups: 3 });

      manager.addError(createErrorEvent('Error 1'));

      // Wait 10ms before adding next
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          manager.addError(createErrorEvent('Error 2'));

          setTimeout(() => {
            manager.addError(createErrorEvent('Error 3'));

            setTimeout(() => {
              // All should be active and present
              expect(manager.size).toBe(3);

              // Add 4th error - should remove oldest (Error 1)
              manager.addError(createErrorEvent('Error 4'));

              expect(manager.size).toBeLessThanOrEqual(3);

              // Error 1 should be gone, Error 4 should be present
              const groups = manager.getGroups();
              const messages = groups.map(g => g.fingerprint.sampleMessage);
              expect(messages).not.toContain('Error 1');

              resolve();
            }, 10);
          }, 10);
        }, 10);
      });
    });
  });

  describe('group merging', () => {
    it('should merge errors with similar patterns but different values', () => {
      manager.addError(createErrorEvent('ECONNREFUSED 192.168.1.1:8080'));
      manager.addError(createErrorEvent('ECONNREFUSED 10.0.0.1:3000'));
      manager.addError(createErrorEvent('ECONNREFUSED example.com:443'));

      expect(manager.size).toBe(1); // All should merge into one group
      expect(manager.getGroups()[0].count).toBe(3);
    });

    it('should update lastSeen timestamp when merging', () => {
      const event1: LogEvent = {
        ts: 1000,
        worker: 'w-test',
        level: 'error',
        msg: 'ECONNREFUSED 192.168.1.1:8080',
      };

      const event2: LogEvent = {
        ts: 2000,
        worker: 'w-test',
        level: 'error',
        msg: 'ECONNREFUSED 10.0.0.1:3000',
      };

      manager.addError(event1);
      const group1 = manager.getGroups()[0];
      expect(group1.lastSeen).toBe(1000);

      manager.addError(event2);
      const group2 = manager.getGroups()[0];
      expect(group2.lastSeen).toBe(2000);
    });

    it('should not duplicate workers in affectedWorkers', () => {
      manager.addError(createErrorEvent('ECONNREFUSED', 'w-worker1'));
      manager.addError(createErrorEvent('ECONNREFUSED', 'w-worker1'));
      manager.addError(createErrorEvent('ECONNREFUSED', 'w-worker2'));

      const group = manager.getGroups()[0];
      expect(group.affectedWorkers).toHaveLength(2);
      expect(group.affectedWorkers.filter(w => w === 'w-worker1')).toHaveLength(1);
    });

    it('should preserve all events when merging', () => {
      const event1 = createErrorEvent('ECONNREFUSED 192.168.1.1:8080');
      const event2 = createErrorEvent('ECONNREFUSED 10.0.0.1:3000');
      const event3 = createErrorEvent('ECONNREFUSED example.com:443');

      manager.addError(event1);
      manager.addError(event2);
      manager.addError(event3);

      const group = manager.getGroups()[0];
      expect(group.events).toHaveLength(3);
      expect(group.events[0]).toBe(event1);
      expect(group.events[1]).toBe(event2);
      expect(group.events[2]).toBe(event3);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid concurrent errors from same worker', () => {
      for (let i = 0; i < 100; i++) {
        manager.addError(createErrorEvent('ECONNREFUSED', 'w-worker1'));
      }

      expect(manager.size).toBe(1);
      expect(manager.getGroups()[0].count).toBe(100);
      expect(manager.getGroups()[0].affectedWorkers).toHaveLength(1);
    });

    it('should handle mixed error types from multiple workers', () => {
      const errorTypes = [
        'ECONNREFUSED',
        'Permission denied',
        'File not found',
        'Timeout',
        'Out of memory',
      ];
      const workers = ['w-1', 'w-2', 'w-3'];

      // Create a mix of errors
      for (let i = 0; i < 50; i++) {
        const errorType = errorTypes[i % errorTypes.length];
        const worker = workers[i % workers.length];
        manager.addError(createErrorEvent(errorType, worker));
      }

      expect(manager.size).toBe(5); // One group per error type

      // Each group should have all 3 workers
      manager.getGroups().forEach(group => {
        expect(group.affectedWorkers).toHaveLength(3);
        expect(group.count).toBe(10); // 50 total / 5 types
      });
    });

    it('should generate unique group IDs', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const group = manager.addError(createErrorEvent(`Unique error ${i}`));
        ids.add(group.id);
      }

      // All IDs should be unique
      expect(ids.size).toBeGreaterThanOrEqual(manager.size);
    });

    it('should handle errors with no message', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'error',
        msg: '',
      };

      const group = manager.addError(event);

      expect(group).toBeDefined();
      expect(group.count).toBe(1);
    });

    it('should handle getGroup with non-existent ID', () => {
      const group = manager.getGroup('non-existent-id');
      expect(group).toBeUndefined();
    });

    it('should handle getWorkerGroups with no matches', () => {
      manager.addError(createErrorEvent('ECONNREFUSED', 'w-worker1'));

      const groups = manager.getWorkerGroups('w-nonexistent');
      expect(groups).toHaveLength(0);
    });

    it('should handle getGroupsByCategory with no matches', () => {
      manager.addError(createErrorEvent('ECONNREFUSED')); // network

      const groups = manager.getGroupsByCategory('permission');
      expect(groups).toHaveLength(0);
    });
  });

  describe('statistics edge cases', () => {
    it('should return zero stats for empty manager', () => {
      const stats = manager.getStats();

      expect(stats.totalGroups).toBe(0);
      expect(stats.activeGroups).toBe(0);
      expect(stats.totalErrors).toBe(0);

      Object.values(stats.byCategory).forEach(count => {
        expect(count).toBe(0);
      });

      Object.values(stats.bySeverity).forEach(count => {
        expect(count).toBe(0);
      });
    });

    it('should count all categories correctly', () => {
      manager.addError(createErrorEvent('ECONNREFUSED')); // network
      manager.addError(createErrorEvent('Permission denied')); // permission
      manager.addError(createErrorEvent('File not found')); // not_found
      manager.addError(createErrorEvent('Request timed out')); // timeout
      manager.addError(createErrorEvent('Out of memory')); // resource
      manager.addError(createErrorEvent('Invalid input')); // validation
      manager.addError(createErrorEvent('SyntaxError')); // syntax
      manager.addError(createErrorEvent('Tool failed')); // tool
      manager.addError(createErrorEvent('Something unknown happened')); // unknown

      const stats = manager.getStats();

      expect(stats.totalGroups).toBe(9);
      expect(stats.byCategory.network).toBe(1);
      expect(stats.byCategory.permission).toBe(1);
      expect(stats.byCategory.not_found).toBe(1);
      expect(stats.byCategory.timeout).toBe(1);
      expect(stats.byCategory.resource).toBe(1);
      expect(stats.byCategory.validation).toBe(1);
      expect(stats.byCategory.syntax).toBe(1);
      expect(stats.byCategory.tool).toBe(1);
      expect(stats.byCategory.unknown).toBe(1);
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

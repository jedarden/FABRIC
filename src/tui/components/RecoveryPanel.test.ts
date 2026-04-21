/**
 * Tests for RecoveryPanel Component
 *
 * Tests the recovery panel utility functions and formatting logic.
 * Note: The component uses dynamic require('blessed') which makes
 * full component testing difficult in unit tests. Integration tests
 * cover the full component behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RecoverySuggestion,
  RecoveryAction,
  RecoveryPriority,
  RecoveryActionType,
  ErrorCategory,
} from '../../types.js';

// Mock recoveryPlaybook module
vi.mock('../utils/recoveryPlaybook.js', () => ({
  formatRecoveryAction: vi.fn((action: RecoveryAction) => action.title),
}));

// Import after mocking
import { formatRecoveryForConsole, getRecoverySummary } from './RecoveryPanel.js';

// Helper to create mock RecoveryAction
function createMockAction(overrides: Partial<RecoveryAction> = {}): RecoveryAction {
  return {
    id: 'action-1',
    type: 'retry' as RecoveryActionType,
    title: 'Retry operation',
    priority: 'normal' as RecoveryPriority,
    automated: true,
    description: 'Retry the failed operation',
    ...overrides,
  };
}

// Helper to create mock RecoverySuggestion
function createMockSuggestion(overrides: Partial<RecoverySuggestion> = {}): RecoverySuggestion {
  return {
    id: 'suggestion-1',
    errorGroupId: 'error-group-1',
    title: 'Network Error',
    category: 'network' as ErrorCategory,
    errorSummary: 'Connection refused to host',
    confidence: 0.85,
    isActive: true,
    affectedWorkers: ['w-1', 'w-2'],
    actions: [createMockAction()],
    generatedAt: Date.now(),
    ...overrides,
  };
}

describe('RecoveryPanel Utility Functions', () => {
  describe('formatRecoveryForConsole', () => {
    it('should format suggestions for console output', () => {
      const suggestions = [
        createMockSuggestion({ title: 'Network Error', isActive: true }),
        createMockSuggestion({ title: 'Permission Denied', isActive: false }),
      ];

      const output = formatRecoveryForConsole(suggestions);

      expect(output).toContain('RECOVERY PLAYBOOK');
      expect(output).toContain('Network Error');
    });

    it('should handle empty suggestions', () => {
      const output = formatRecoveryForConsole([]);
      expect(output).toBe('No recovery suggestions available.');
    });

    it('should limit to 5 suggestions', () => {
      const suggestions = Array.from({ length: 10 }, (_, i) =>
        createMockSuggestion({ id: `s${i}`, title: `Error ${i}` })
      );

      const output = formatRecoveryForConsole(suggestions);
      expect(output).toContain('more suggestions');
    });

    it('should include action info', () => {
      const suggestions = [
        createMockSuggestion({
          actions: [createMockAction({ title: 'Retry', automated: true })],
        }),
      ];

      const output = formatRecoveryForConsole(suggestions);
      expect(output).toContain('Retry');
    });

    it('should show active badge for active suggestions', () => {
      const suggestions = [createMockSuggestion({ isActive: true })];
      const output = formatRecoveryForConsole(suggestions);
      expect(output).toContain('✓');
    });

    it('should show inactive badge for inactive suggestions', () => {
      const suggestions = [createMockSuggestion({ isActive: false })];
      const output = formatRecoveryForConsole(suggestions);
      expect(output).toContain('○');
    });

    it('should include confidence percentage', () => {
      const suggestions = [createMockSuggestion({ confidence: 0.92 })];
      const output = formatRecoveryForConsole(suggestions);
      expect(output).toContain('92%');
    });

    it('should handle all error categories', () => {
      const categories: ErrorCategory[] = [
        'network', 'permission', 'validation', 'resource',
        'not_found', 'timeout', 'syntax', 'tool', 'unknown'
      ];

      categories.forEach(category => {
        const suggestions = [createMockSuggestion({ category })];
        const output = formatRecoveryForConsole(suggestions);
        expect(output).toContain('RECOVERY PLAYBOOK');
      });
    });

    it('should handle suggestions without actions', () => {
      const suggestions = [createMockSuggestion({ actions: [] })];
      const output = formatRecoveryForConsole(suggestions);
      expect(output).toContain('Network Error');
    });

    it('should truncate long error summaries', () => {
      const longSummary = 'A'.repeat(100);
      const suggestions = [createMockSuggestion({ errorSummary: longSummary })];
      const output = formatRecoveryForConsole(suggestions);
      // Should still contain the header and not throw
      expect(output).toContain('RECOVERY PLAYBOOK');
    });
  });

  describe('getRecoverySummary', () => {
    it('should return correct summary', () => {
      const suggestions = [
        createMockSuggestion({ category: 'network', isActive: true }),
        createMockSuggestion({ category: 'permission', isActive: true }),
        createMockSuggestion({ category: 'network', isActive: false }),
      ];

      const summary = getRecoverySummary(suggestions);

      expect(summary.total).toBe(3);
      expect(summary.active).toBe(2);
      expect(summary.byCategory.network).toBe(2);
      expect(summary.byCategory.permission).toBe(1);
    });

    it('should count automated available', () => {
      const suggestions = [
        createMockSuggestion({
          actions: [createMockAction({ automated: true })],
        }),
        createMockSuggestion({
          actions: [createMockAction({ automated: false })],
        }),
      ];

      const summary = getRecoverySummary(suggestions);

      expect(summary.automatedAvailable).toBe(1);
    });

    it('should handle empty suggestions', () => {
      const summary = getRecoverySummary([]);

      expect(summary.total).toBe(0);
      expect(summary.active).toBe(0);
      expect(summary.automatedAvailable).toBe(0);
    });

    it('should count all categories correctly', () => {
      const suggestions: RecoverySuggestion[] = [
        createMockSuggestion({ category: 'network' }),
        createMockSuggestion({ category: 'permission' }),
        createMockSuggestion({ category: 'validation' }),
        createMockSuggestion({ category: 'resource' }),
        createMockSuggestion({ category: 'not_found' }),
        createMockSuggestion({ category: 'timeout' }),
        createMockSuggestion({ category: 'syntax' }),
        createMockSuggestion({ category: 'tool' }),
        createMockSuggestion({ category: 'unknown' }),
      ];

      const summary = getRecoverySummary(suggestions);

      expect(summary.byCategory.network).toBe(1);
      expect(summary.byCategory.permission).toBe(1);
      expect(summary.byCategory.validation).toBe(1);
      expect(summary.byCategory.resource).toBe(1);
      expect(summary.byCategory.not_found).toBe(1);
      expect(summary.byCategory.timeout).toBe(1);
      expect(summary.byCategory.syntax).toBe(1);
      expect(summary.byCategory.tool).toBe(1);
      expect(summary.byCategory.unknown).toBe(1);
    });

    it('should count multiple actions with automation', () => {
      const suggestions = [
        createMockSuggestion({
          actions: [
            createMockAction({ automated: true }),
            createMockAction({ automated: true }),
            createMockAction({ automated: false }),
          ],
        }),
      ];

      const summary = getRecoverySummary(suggestions);
      expect(summary.automatedAvailable).toBe(1);
    });

    it('should handle inactive suggestions', () => {
      const suggestions = [
        createMockSuggestion({ isActive: false }),
        createMockSuggestion({ isActive: false }),
        createMockSuggestion({ isActive: true }),
      ];

      const summary = getRecoverySummary(suggestions);
      expect(summary.active).toBe(1);
      expect(summary.total).toBe(3);
    });
  });
});

describe('RecoveryPanel Types and Interfaces', () => {
  it('should support all RecoveryActionType values', () => {
    const types: RecoveryActionType[] = [
      'retry', 'backoff', 'alternative', 'escalate',
      'skip', 'fix_config', 'install_dep', 'fix_permissions',
      'cleanup', 'restart', 'investigate'
    ];

    types.forEach(type => {
      const action = createMockAction({ type });
      expect(action.type).toBe(type);
    });
  });

  it('should support all RecoveryPriority values', () => {
    const priorities: RecoveryPriority[] = ['immediate', 'high', 'normal', 'low'];

    priorities.forEach(priority => {
      const action = createMockAction({ priority });
      expect(action.priority).toBe(priority);
    });
  });

  it('should support all ErrorCategory values', () => {
    const categories: ErrorCategory[] = [
      'network', 'permission', 'validation', 'resource',
      'not_found', 'timeout', 'syntax', 'tool', 'unknown'
    ];

    categories.forEach(category => {
      const suggestion = createMockSuggestion({ category });
      expect(suggestion.category).toBe(category);
    });
  });
});

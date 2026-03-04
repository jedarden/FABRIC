/**
 * Tests for FABRIC Git Event Parser
 */

import { describe, it, expect } from 'vitest';
import {
  isGitEvent,
  parseGitEvent,
  parseGitEvents,
  formatGitEvent,
} from './gitParser.js';
import { LogEvent, GitEvent, GitStatusEvent, GitCommitEvent } from './types.js';

describe('isGitEvent', () => {
  it('should detect git status events', () => {
    const event: LogEvent = {
      ts: Date.now(),
      worker: 'w-test',
      level: 'info',
      msg: 'Git status',
      git_status: { branch: 'main' },
    };

    expect(isGitEvent(event)).toBe(true);
  });

  it('should detect git commit events', () => {
    const event: LogEvent = {
      ts: Date.now(),
      worker: 'w-test',
      level: 'info',
      msg: 'Git commit',
      git_commit: 'abc123',
    };

    expect(isGitEvent(event)).toBe(true);
  });

  it('should detect git events from message patterns', () => {
    const event: LogEvent = {
      ts: Date.now(),
      worker: 'w-test',
      level: 'info',
      msg: 'Running git status',
    };

    expect(isGitEvent(event)).toBe(true);
  });

  it('should return false for non-git events', () => {
    const event: LogEvent = {
      ts: Date.now(),
      worker: 'w-test',
      level: 'info',
      msg: 'Regular log message',
    };

    expect(isGitEvent(event)).toBe(false);
  });
});

describe('parseGitEvent', () => {
  describe('git status events', () => {
    it('should parse a basic git status event', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git status',
        git_type: 'status',
        git_branch: 'main',
        git_staged: ['file1.ts', 'file2.ts'],
        git_unstaged: ['file3.ts'],
        git_untracked: ['file4.ts'],
      };

      const result = parseGitEvent(event) as GitStatusEvent;

      expect(result).toBeDefined();
      expect(result.type).toBe('status');
      expect(result.branch).toBe('main');
      expect(result.staged).toHaveLength(2);
      expect(result.unstaged).toHaveLength(1);
      expect(result.untracked).toHaveLength(1);
    });

    it('should parse git status with tracking info', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git status',
        git_status: {
          branch: 'feature/auth',
          tracking: 'origin/feature/auth',
          ahead: 3,
          behind: 1,
          commit: 'abc123',
        },
        git_staged: [],
        git_unstaged: [],
        git_untracked: [],
      };

      const result = parseGitEvent(event) as GitStatusEvent;

      expect(result).toBeDefined();
      expect(result.branch).toBe('feature/auth');
      expect(result.tracking).toBe('origin/feature/auth');
      expect(result.ahead).toBe(3);
      expect(result.behind).toBe(1);
      expect(result.commit).toBe('abc123');
    });

    it('should parse file changes with detailed status', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git status',
        git_type: 'status',
        git_branch: 'main',
        git_staged: [
          { path: 'added.ts', status: 'added', staged: true },
          { path: 'modified.ts', status: 'modified', staged: true },
        ],
        git_unstaged: [
          { path: 'deleted.ts', status: 'deleted', staged: false },
        ],
        git_untracked: ['new-file.ts'],
      };

      const result = parseGitEvent(event) as GitStatusEvent;

      expect(result.staged[0].path).toBe('added.ts');
      expect(result.staged[0].status).toBe('added');
      expect(result.staged[1].path).toBe('modified.ts');
      expect(result.staged[1].status).toBe('modified');
      expect(result.unstaged[0].path).toBe('deleted.ts');
      expect(result.unstaged[0].status).toBe('deleted');
    });
  });

  describe('git commit events', () => {
    it('should parse a basic git commit event', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git commit',
        git_type: 'commit',
        git_commit: 'abc123def456',
        git_message: 'feat: add new feature',
        git_branch: 'main',
      };

      const result = parseGitEvent(event) as GitCommitEvent;

      expect(result).toBeDefined();
      expect(result.type).toBe('commit');
      expect(result.hash).toBe('abc123def456');
      expect(result.message).toBe('feat: add new feature');
      expect(result.branch).toBe('main');
    });

    it('should parse commit with author and files', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git commit',
        git_commit: {
          hash: 'abc123',
          message: 'fix: bug fix',
          author: 'John Doe',
          email: 'john@example.com',
          files: [
            { path: 'file1.ts', status: 'modified' },
            { path: 'file2.ts', status: 'added' },
          ],
        },
      };

      const result = parseGitEvent(event) as GitCommitEvent;

      expect(result.hash).toBe('abc123');
      expect(result.author).toBe('John Doe');
      expect(result.email).toBe('john@example.com');
      expect(result.files).toHaveLength(2);
      expect(result.files![0].path).toBe('file1.ts');
    });

    it('should return null for commit without hash', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git commit',
        git_type: 'commit',
        git_message: 'No hash provided',
      };

      const result = parseGitEvent(event);

      expect(result).toBeNull();
    });
  });

  describe('git branch events', () => {
    it('should parse a basic git branch event', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git branch',
        git_type: 'branch',
        git_branch: 'main',
      };

      const result = parseGitEvent(event);

      expect(result).toBeDefined();
      expect(result!.type).toBe('branch');
      expect(result).toHaveProperty('current', 'main');
    });

    it('should parse branch with tracking info', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git branch',
        git_branch: {
          current: 'feature/test',
          branches: ['main', 'feature/test', 'develop'],
          tracking: 'origin/feature/test',
          ahead: 2,
          behind: 0,
        },
      };

      const result = parseGitEvent(event);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('current', 'feature/test');
      expect(result).toHaveProperty('branches');
      expect(result).toHaveProperty('tracking', 'origin/feature/test');
      expect(result).toHaveProperty('ahead', 2);
    });
  });

  describe('git diff events', () => {
    it('should parse a basic git diff event', () => {
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git diff',
        git_type: 'diff',
        git_target: 'HEAD',
        git_files: [
          { path: 'file1.ts', status: 'modified' },
          { path: 'file2.ts', status: 'added' },
        ],
        git_lines_added: 45,
        git_lines_deleted: 12,
      };

      const result = parseGitEvent(event);

      expect(result).toBeDefined();
      expect(result!.type).toBe('diff');
      expect(result).toHaveProperty('target', 'HEAD');
      expect(result).toHaveProperty('linesAdded', 45);
      expect(result).toHaveProperty('linesDeleted', 12);
      expect(result).toHaveProperty('files');
    });

    it('should truncate long diff content', () => {
      const longContent = 'a'.repeat(15000);
      const event: LogEvent = {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git diff',
        git_diff: {
          target: 'origin/main',
          content: longContent,
          files: [],
        },
        git_lines_added: 100,
        git_lines_deleted: 50,
      };

      const result = parseGitEvent(event, { maxDiffLength: 1000 });

      expect(result).toBeDefined();
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('isTruncated', true);
    });
  });
});

describe('parseGitEvents', () => {
  it('should parse multiple git events from log events', () => {
    const events: LogEvent[] = [
      {
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git status',
        git_type: 'status',
        git_branch: 'main',
        git_staged: [],
        git_unstaged: [],
        git_untracked: [],
      },
      {
        ts: 1709337610000,
        worker: 'w-test',
        level: 'info',
        msg: 'Regular log',
      },
      {
        ts: 1709337620000,
        worker: 'w-test',
        level: 'info',
        msg: 'Git commit',
        git_type: 'commit',
        git_commit: 'abc123',
        git_message: 'test commit',
      },
    ];

    const result = parseGitEvents(events);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('status');
    expect(result[1].type).toBe('commit');
  });
});

describe('formatGitEvent', () => {
  it('should format a git status event', () => {
    const event: GitStatusEvent = {
      id: 'ge-1',
      type: 'status',
      ts: 1709337600000,
      worker: 'w-test',
      branch: 'main',
      staged: [],
      unstaged: [],
      untracked: [],
    };

    const result = formatGitEvent(event);

    expect(result).toContain('[git]');
    expect(result).toContain('Status');
    expect(result).toContain('Branch: main');
    expect(result).toContain('Staged: 0 files');
  });

  it('should format a git commit event', () => {
    const event: GitCommitEvent = {
      id: 'ge-2',
      type: 'commit',
      ts: 1709337600000,
      worker: 'w-test',
      hash: 'abc123def456',
      message: 'feat: add new feature',
      branch: 'main',
      author: 'John Doe',
    };

    const result = formatGitEvent(event);

    expect(result).toContain('[git]');
    expect(result).toContain('Commit');
    expect(result).toContain('abc123d'); // Short hash
    expect(result).toContain('[main]');
    expect(result).toContain('by John Doe');
    expect(result).toContain('feat: add new feature');
  });

  it('should format a git branch event', () => {
    const event = {
      id: 'ge-3',
      type: 'branch' as const,
      ts: 1709337600000,
      worker: 'w-test',
      current: 'feature/test',
      tracking: 'origin/feature/test',
      ahead: 2,
      behind: 1,
    };

    const result = formatGitEvent(event);

    expect(result).toContain('[git]');
    expect(result).toContain('Branch');
    expect(result).toContain('Current: feature/test');
    expect(result).toContain('tracking origin/feature/test');
    expect(result).toContain('+2');
    expect(result).toContain('-1');
  });

  it('should format a git diff event', () => {
    const event = {
      id: 'ge-4',
      type: 'diff' as const,
      ts: 1709337600000,
      worker: 'w-test',
      target: 'origin/main',
      files: [{ path: 'file1.ts', status: 'modified' as const, staged: false }],
      linesAdded: 45,
      linesDeleted: 12,
    };

    const result = formatGitEvent(event);

    expect(result).toContain('[git]');
    expect(result).toContain('Diff');
    expect(result).toContain('Target: origin/main');
    expect(result).toContain('+45/-12');
    expect(result).toContain('1 files');
  });
});

/**
 * Tests for GitIntegration Component
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as blessed from 'blessed';
import { GitIntegration } from './GitIntegration.js';
import { GitEvent, GitStatusEvent, GitCommitEvent, GitFileChange } from '../../types.js';

// Mock blessed screen
function createMockScreen(): blessed.Widgets.Screen {
  const screen = blessed.screen({
    smartCSR: true,
    dump: true,
    warnings: true,
  });

  // Suppress rendering in tests
  screen.render = vi.fn();

  return screen;
}

describe('GitIntegration', () => {
  let screen: blessed.Widgets.Screen;
  let gitIntegration: GitIntegration;

  beforeEach(() => {
    screen = createMockScreen();
    gitIntegration = new GitIntegration({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 20,
    });
  });

  describe('initialization', () => {
    it('should create GitIntegration component', () => {
      expect(gitIntegration).toBeDefined();
      expect(gitIntegration.getElement()).toBeDefined();
    });

    it('should start with no conflicts', () => {
      expect(gitIntegration.hasConflicts()).toBe(false);
    });

    it('should start with zero file counts', () => {
      const counts = gitIntegration.getFileCounts();
      expect(counts.staged).toBe(0);
      expect(counts.unstaged).toBe(0);
      expect(counts.untracked).toBe(0);
    });

    it('should start with no commits', () => {
      expect(gitIntegration.getCommitsCount()).toBe(0);
    });
  });

  describe('updateGitEvents', () => {
    it('should update with status event', () => {
      const statusEvent: GitStatusEvent = {
        id: 'ge-1',
        type: 'status',
        ts: Date.now(),
        worker: 'w-test',
        branch: 'main',
        staged: [
          { path: 'file1.ts', status: 'modified', staged: true },
          { path: 'file2.ts', status: 'added', staged: true },
        ],
        unstaged: [
          { path: 'file3.ts', status: 'modified', staged: false },
        ],
        untracked: ['file4.ts'],
      };

      gitIntegration.updateGitEvents([statusEvent]);

      expect(gitIntegration.getCurrentBranch()).toBe('main');
      const counts = gitIntegration.getFileCounts();
      expect(counts.staged).toBe(2);
      expect(counts.unstaged).toBe(1);
      expect(counts.untracked).toBe(1);
    });

    it('should update with commit events', () => {
      const commitEvent1: GitCommitEvent = {
        id: 'ge-2',
        type: 'commit',
        ts: Date.now() - 1000,
        worker: 'w-test',
        hash: 'abc1234567890',
        message: 'First commit',
        branch: 'main',
      };

      const commitEvent2: GitCommitEvent = {
        id: 'ge-3',
        type: 'commit',
        ts: Date.now(),
        worker: 'w-test',
        hash: 'def0987654321',
        message: 'Second commit',
        branch: 'main',
      };

      gitIntegration.updateGitEvents([commitEvent1, commitEvent2]);

      expect(gitIntegration.getCommitsCount()).toBe(2);
    });

    it('should limit recent commits to maxCommits', () => {
      const commits: GitCommitEvent[] = [];
      for (let i = 0; i < 10; i++) {
        commits.push({
          id: `ge-${i}`,
          type: 'commit',
          ts: Date.now() - (10 - i) * 1000,
          worker: 'w-test',
          hash: `hash${i}`,
          message: `Commit ${i}`,
          branch: 'main',
        });
      }

      const gitIntWithLimit = new GitIntegration({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: 20,
        maxCommits: 5,
      });

      gitIntWithLimit.updateGitEvents(commits);
      expect(gitIntWithLimit.getCommitsCount()).toBe(5);
    });

    it('should detect conflicts from unmerged files', () => {
      const statusEvent: GitStatusEvent = {
        id: 'ge-1',
        type: 'status',
        ts: Date.now(),
        worker: 'w-test',
        branch: 'feature-branch',
        staged: [
          { path: 'conflicted.ts', status: 'unmerged', staged: true },
        ],
        unstaged: [],
        untracked: [],
      };

      gitIntegration.updateGitEvents([statusEvent]);

      expect(gitIntegration.hasConflicts()).toBe(true);
    });

    it('should detect conflicts from unstaged unmerged files', () => {
      const statusEvent: GitStatusEvent = {
        id: 'ge-1',
        type: 'status',
        ts: Date.now(),
        worker: 'w-test',
        branch: 'feature-branch',
        staged: [],
        unstaged: [
          { path: 'conflicted.ts', status: 'unmerged', staged: false },
        ],
        untracked: [],
      };

      gitIntegration.updateGitEvents([statusEvent]);

      expect(gitIntegration.hasConflicts()).toBe(true);
    });

    it('should use latest status when multiple status events provided', () => {
      const statusEvent1: GitStatusEvent = {
        id: 'ge-1',
        type: 'status',
        ts: Date.now() - 2000,
        worker: 'w-test',
        branch: 'old-branch',
        staged: [],
        unstaged: [],
        untracked: [],
      };

      const statusEvent2: GitStatusEvent = {
        id: 'ge-2',
        type: 'status',
        ts: Date.now(),
        worker: 'w-test',
        branch: 'new-branch',
        staged: [{ path: 'new.ts', status: 'added', staged: true }],
        unstaged: [],
        untracked: [],
      };

      gitIntegration.updateGitEvents([statusEvent1, statusEvent2]);

      expect(gitIntegration.getCurrentBranch()).toBe('new-branch');
      expect(gitIntegration.getFileCounts().staged).toBe(1);
    });
  });

  describe('setWorkspace', () => {
    it('should set workspace for a worker', () => {
      gitIntegration.setWorkspace('w-test', '/home/coder/FABRIC');
      // Should not throw and should trigger render
      expect(screen.render).toHaveBeenCalled();
    });
  });

  describe('clearHistory', () => {
    it('should clear all git state', () => {
      const statusEvent: GitStatusEvent = {
        id: 'ge-1',
        type: 'status',
        ts: Date.now(),
        worker: 'w-test',
        branch: 'main',
        staged: [{ path: 'file.ts', status: 'modified', staged: true }],
        unstaged: [],
        untracked: [],
      };

      gitIntegration.updateGitEvents([statusEvent]);
      expect(gitIntegration.getCurrentBranch()).toBe('main');

      gitIntegration.clearHistory();

      expect(gitIntegration.getCurrentBranch()).toBeUndefined();
      expect(gitIntegration.hasConflicts()).toBe(false);
      expect(gitIntegration.getCommitsCount()).toBe(0);
      const counts = gitIntegration.getFileCounts();
      expect(counts.staged).toBe(0);
      expect(counts.unstaged).toBe(0);
      expect(counts.untracked).toBe(0);
    });
  });

  describe('visibility', () => {
    it('should show and hide panel', () => {
      gitIntegration.show();
      expect(gitIntegration.isVisible()).toBe(true);

      gitIntegration.hide();
      expect(gitIntegration.isVisible()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty events array', () => {
      gitIntegration.updateGitEvents([]);
      expect(gitIntegration.getCurrentBranch()).toBeUndefined();
      expect(gitIntegration.getCommitsCount()).toBe(0);
    });

    it('should handle status with tracking info', () => {
      const statusEvent: GitStatusEvent = {
        id: 'ge-1',
        type: 'status',
        ts: Date.now(),
        worker: 'w-test',
        branch: 'feature',
        staged: [],
        unstaged: [],
        untracked: [],
        tracking: 'origin/feature',
        ahead: 3,
        behind: 1,
      };

      gitIntegration.updateGitEvents([statusEvent]);
      expect(gitIntegration.getCurrentBranch()).toBe('feature');
    });

    it('should handle commit with file changes', () => {
      const commitEvent: GitCommitEvent = {
        id: 'ge-1',
        type: 'commit',
        ts: Date.now(),
        worker: 'w-test',
        hash: 'abc123',
        message: 'Add feature\n\nDetailed description',
        branch: 'main',
        author: 'John Doe',
        email: 'john@example.com',
        files: [
          { path: 'src/feature.ts', status: 'added', staged: true },
          { path: 'src/index.ts', status: 'modified', staged: true },
        ],
      };

      gitIntegration.updateGitEvents([commitEvent]);
      expect(gitIntegration.getCommitsCount()).toBe(1);
    });

    it('should handle file with renamed status', () => {
      const statusEvent: GitStatusEvent = {
        id: 'ge-1',
        type: 'status',
        ts: Date.now(),
        worker: 'w-test',
        branch: 'main',
        staged: [
          {
            path: 'new-name.ts',
            status: 'renamed',
            staged: true,
            originalPath: 'old-name.ts',
          },
        ],
        unstaged: [],
        untracked: [],
      };

      gitIntegration.updateGitEvents([statusEvent]);
      const counts = gitIntegration.getFileCounts();
      expect(counts.staged).toBe(1);
    });
  });
});

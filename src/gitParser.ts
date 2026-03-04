/**
 * FABRIC Git Event Parser
 *
 * Parses git-related NEEDLE log lines into structured GitEvent objects.
 */

import {
  LogEvent,
  GitEvent,
  GitStatusEvent,
  GitCommitEvent,
  GitBranchEvent,
  GitDiffEvent,
  GitFileChange,
  GitFileStatus,
  GitParseOptions,
} from './types.js';

/**
 * Event sequence counter for generating unique git event IDs
 */
let gitEventSequence = 0;

/**
 * Generate a unique git event ID
 */
function generateGitEventId(): string {
  return `ge-${Date.now()}-${++gitEventSequence}`;
}

/**
 * Truncate content to max length
 */
function truncate(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength - 3) + '...';
}

/**
 * Check if a log event contains git-related content
 */
export function isGitEvent(event: LogEvent): boolean {
  // Check for explicit git fields
  if (
    event.git_status ||
    event.git_commit ||
    event.git_branch ||
    event.git_diff ||
    event.git_staged ||
    event.git_unstaged ||
    event.git_type
  ) {
    return true;
  }

  // Check message patterns
  const msg = event.msg.toLowerCase();
  if (
    msg.includes('git status') ||
    msg.includes('git commit') ||
    msg.includes('git branch') ||
    msg.includes('git diff') ||
    msg.includes('git log')
  ) {
    return true;
  }

  return false;
}

/**
 * Parse a log event into a git event
 *
 * @param event - The log event to parse
 * @param options - Parse options
 * @returns Parsed git event or null if not a git event
 */
export function parseGitEvent(
  event: LogEvent,
  options: GitParseOptions = {}
): GitEvent | null {
  const { maxDiffLength = 10000, includeFileChanges = true, maxFiles = 100 } = options;

  // Determine git event type
  const gitType = event.git_type as string | undefined;

  if (gitType === 'status' || event.git_status) {
    return parseGitStatusEvent(event, includeFileChanges, maxFiles);
  }

  if (gitType === 'commit' || event.git_commit) {
    return parseGitCommitEvent(event, includeFileChanges, maxFiles);
  }

  if (gitType === 'branch' || event.git_branch) {
    return parseGitBranchEvent(event);
  }

  if (gitType === 'diff' || event.git_diff) {
    return parseGitDiffEvent(event, maxDiffLength, includeFileChanges, maxFiles);
  }

  // Infer from message if no explicit type
  const msg = event.msg.toLowerCase();
  if (msg.includes('git status')) {
    return parseGitStatusEvent(event, includeFileChanges, maxFiles);
  } else if (msg.includes('git commit')) {
    return parseGitCommitEvent(event, includeFileChanges, maxFiles);
  } else if (msg.includes('git branch')) {
    return parseGitBranchEvent(event);
  } else if (msg.includes('git diff')) {
    return parseGitDiffEvent(event, maxDiffLength, includeFileChanges, maxFiles);
  }

  return null;
}

/**
 * Parse a git status event
 */
function parseGitStatusEvent(
  event: LogEvent,
  includeFileChanges: boolean,
  maxFiles: number
): GitStatusEvent | null {
  const statusData = event.git_status as Record<string, unknown> | undefined;

  // Get branch info
  const branch = (statusData?.branch || event.git_branch || event.branch || 'unknown') as string;

  // Parse staged files
  const staged: GitFileChange[] = [];
  const stagedData = (statusData?.staged || event.git_staged || []) as unknown[];
  if (includeFileChanges && Array.isArray(stagedData)) {
    for (const file of stagedData.slice(0, maxFiles)) {
      const change = parseGitFileChange(file, true);
      if (change) staged.push(change);
    }
  }

  // Parse unstaged files
  const unstaged: GitFileChange[] = [];
  const unstagedData = (statusData?.unstaged || event.git_unstaged || []) as unknown[];
  if (includeFileChanges && Array.isArray(unstagedData)) {
    for (const file of unstagedData.slice(0, maxFiles)) {
      const change = parseGitFileChange(file, false);
      if (change) unstaged.push(change);
    }
  }

  // Parse untracked files
  const untracked: string[] = [];
  const untrackedData = (statusData?.untracked || event.git_untracked || []) as unknown[];
  if (Array.isArray(untrackedData)) {
    for (const file of untrackedData.slice(0, maxFiles)) {
      if (typeof file === 'string') {
        untracked.push(file);
      } else if (typeof file === 'object' && file !== null && 'path' in file) {
        untracked.push((file as { path: string }).path);
      }
    }
  }

  return {
    id: generateGitEventId(),
    type: 'status',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    branch,
    commit: (statusData?.commit || event.git_commit || event.commit) as string | undefined,
    staged,
    unstaged,
    untracked,
    ahead: (statusData?.ahead || event.git_ahead || event.ahead) as number | undefined,
    behind: (statusData?.behind || event.git_behind || event.behind) as number | undefined,
    tracking: (statusData?.tracking || event.git_tracking || event.tracking) as string | undefined,
  };
}

/**
 * Parse a git commit event
 */
function parseGitCommitEvent(
  event: LogEvent,
  includeFileChanges: boolean,
  maxFiles: number
): GitCommitEvent | null {
  const commitData = event.git_commit as Record<string, unknown> | undefined;

  // Get commit hash
  const hash = (
    (typeof commitData === 'string' ? commitData : commitData?.hash) ||
    event.commit_hash ||
    event.hash ||
    event.commit
  ) as string;

  if (!hash) return null;

  // Get commit message
  const message = (
    commitData?.message ||
    event.git_message ||
    event.commit_message ||
    event.message ||
    ''
  ) as string;

  // Parse files if available
  const files: GitFileChange[] = [];
  const filesData = (commitData?.files || event.git_files || event.files || []) as unknown[];
  if (includeFileChanges && Array.isArray(filesData)) {
    for (const file of filesData.slice(0, maxFiles)) {
      const change = parseGitFileChange(file, true);
      if (change) files.push(change);
    }
  }

  // Get parents
  const parents: string[] = [];
  const parentsData = (commitData?.parents || event.git_parents || event.parents || []) as unknown[];
  if (Array.isArray(parentsData)) {
    for (const parent of parentsData) {
      if (typeof parent === 'string') {
        parents.push(parent);
      }
    }
  }

  return {
    id: generateGitEventId(),
    type: 'commit',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    hash,
    message,
    branch: (commitData?.branch || event.git_branch || event.branch) as string | undefined,
    author: (commitData?.author || event.git_author || event.author) as string | undefined,
    email: (commitData?.email || event.git_email || event.email) as string | undefined,
    parents: parents.length > 0 ? parents : undefined,
    files: files.length > 0 ? files : undefined,
  };
}

/**
 * Parse a git branch event
 */
function parseGitBranchEvent(event: LogEvent): GitBranchEvent | null {
  const branchData = event.git_branch as Record<string, unknown> | undefined;

  // Get current branch
  const current = (
    (typeof branchData === 'string' ? branchData : branchData?.current) ||
    event.current_branch ||
    event.branch ||
    'unknown'
  ) as string;

  // Get all branches
  const branches: string[] = [];
  const branchesData = (branchData?.branches || event.git_branches || event.branches || []) as unknown[];
  if (Array.isArray(branchesData)) {
    for (const branch of branchesData) {
      if (typeof branch === 'string') {
        branches.push(branch);
      }
    }
  }

  return {
    id: generateGitEventId(),
    type: 'branch',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    current,
    branches: branches.length > 0 ? branches : undefined,
    tracking: (branchData?.tracking || event.git_tracking || event.tracking) as string | undefined,
    ahead: (branchData?.ahead || event.git_ahead || event.ahead) as number | undefined,
    behind: (branchData?.behind || event.git_behind || event.behind) as number | undefined,
  };
}

/**
 * Parse a git diff event
 */
function parseGitDiffEvent(
  event: LogEvent,
  maxLength: number,
  includeFileChanges: boolean,
  maxFiles: number
): GitDiffEvent | null {
  const diffData = event.git_diff as Record<string, unknown> | undefined;

  // Get diff target
  const target = (
    (typeof diffData === 'string' ? diffData : diffData?.target) ||
    event.git_target ||
    event.diff_target ||
    event.target ||
    'HEAD'
  ) as string;

  // Parse files
  const files: GitFileChange[] = [];
  const filesData = (diffData?.files || event.git_files || event.files || []) as unknown[];
  if (includeFileChanges && Array.isArray(filesData)) {
    for (const file of filesData.slice(0, maxFiles)) {
      const change = parseGitFileChange(file, false);
      if (change) files.push(change);
    }
  }

  // Get diff content
  const content = (diffData?.content || event.git_content || event.diff_content || event.content) as
    | string
    | undefined;
  const truncatedContent = content ? truncate(content, maxLength) : undefined;

  return {
    id: generateGitEventId(),
    type: 'diff',
    ts: event.ts,
    worker: event.worker,
    bead: event.bead,
    target,
    files,
    linesAdded: (diffData?.lines_added || event.git_lines_added || event.lines_added || 0) as number,
    linesDeleted: (diffData?.lines_deleted || event.git_lines_deleted || event.lines_deleted || 0) as number,
    content: truncatedContent,
    isTruncated: content ? content.length > maxLength : false,
  };
}

/**
 * Parse a single file change from various formats
 */
function parseGitFileChange(data: unknown, defaultStaged: boolean): GitFileChange | null {
  if (typeof data === 'string') {
    // Simple string path - assume modified
    return {
      path: data,
      status: 'modified',
      staged: defaultStaged,
    };
  }

  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Extract path
  const path = (obj.path || obj.file || obj.filename) as string;
  if (!path) return null;

  // Extract status
  let status: GitFileStatus = 'modified';
  const statusStr = (obj.status || obj.state || obj.type) as string | undefined;
  if (statusStr) {
    const normalized = statusStr.toLowerCase();
    if (normalized === 'a' || normalized === 'added' || normalized === 'new') {
      status = 'added';
    } else if (normalized === 'm' || normalized === 'modified') {
      status = 'modified';
    } else if (normalized === 'd' || normalized === 'deleted' || normalized === 'removed') {
      status = 'deleted';
    } else if (normalized === 'r' || normalized === 'renamed') {
      status = 'renamed';
    } else if (normalized === 'c' || normalized === 'copied') {
      status = 'copied';
    } else if (normalized === '??' || normalized === 'untracked') {
      status = 'untracked';
    } else if (normalized === 'u' || normalized === 'unmerged' || normalized === 'conflict') {
      status = 'unmerged';
    }
  }

  // Extract staged status
  const staged = typeof obj.staged === 'boolean' ? obj.staged : defaultStaged;

  // Extract original path for renames
  const originalPath = (obj.original_path || obj.from || obj.old_path) as string | undefined;

  return {
    path,
    status,
    staged,
    originalPath,
  };
}

/**
 * Parse all git events from a list of log events
 *
 * @param events - List of log events to parse
 * @param options - Parse options
 * @returns List of git events in chronological order
 */
export function parseGitEvents(
  events: LogEvent[],
  options: GitParseOptions = {}
): GitEvent[] {
  const gitEvents: GitEvent[] = [];

  for (const event of events) {
    const gitEvent = parseGitEvent(event, options);
    if (gitEvent) {
      gitEvents.push(gitEvent);
    }
  }

  return gitEvents;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format a git event for display
 */
export function formatGitEvent(event: GitEvent): string {
  const timestamp = formatTimestamp(event.ts);
  const prefix = `${timestamp} [git]`;

  switch (event.type) {
    case 'status':
      const statusParts: string[] = [
        `Branch: ${event.branch}`,
      ];
      if (event.tracking) {
        statusParts.push(`tracking ${event.tracking}`);
      }
      if (event.ahead) {
        statusParts.push(`+${event.ahead}`);
      }
      if (event.behind) {
        statusParts.push(`-${event.behind}`);
      }
      statusParts.push(`\n  Staged: ${event.staged.length} files`);
      statusParts.push(`Unstaged: ${event.unstaged.length} files`);
      statusParts.push(`Untracked: ${event.untracked.length} files`);
      return `${prefix} Status\n  ${statusParts.join(', ')}`;

    case 'commit':
      const commitParts: string[] = [
        `${event.hash.slice(0, 7)}`,
      ];
      if (event.branch) {
        commitParts.push(`[${event.branch}]`);
      }
      if (event.author) {
        commitParts.push(`by ${event.author}`);
      }
      commitParts.push(`\n  ${event.message.split('\n')[0]}`);
      if (event.files) {
        commitParts.push(`\n  ${event.files.length} files changed`);
      }
      return `${prefix} Commit ${commitParts.join(' ')}`;

    case 'branch':
      const branchParts: string[] = [`Current: ${event.current}`];
      if (event.tracking) {
        branchParts.push(`tracking ${event.tracking}`);
      }
      if (event.ahead) {
        branchParts.push(`+${event.ahead}`);
      }
      if (event.behind) {
        branchParts.push(`-${event.behind}`);
      }
      if (event.branches) {
        branchParts.push(`\n  Total branches: ${event.branches.length}`);
      }
      return `${prefix} Branch\n  ${branchParts.join(', ')}`;

    case 'diff':
      const diffParts: string[] = [
        `Target: ${event.target}`,
        `+${event.linesAdded}/-${event.linesDeleted}`,
        `${event.files.length} files`,
      ];
      if (event.isTruncated) {
        diffParts.push('[truncated]');
      }
      return `${prefix} Diff ${diffParts.join(', ')}`;

    default:
      return prefix;
  }
}

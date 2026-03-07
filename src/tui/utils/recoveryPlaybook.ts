/**
 * FABRIC Recovery Playbook Module
 *
 * Maps error patterns to actionable recovery steps.
 * Provides suggestions when workers encounter errors.
 * Learns from historical error resolutions.
 */

import {
  ErrorCategory,
  ErrorGroup,
  RecoveryAction,
  RecoveryActionType,
  RecoveryPlaybookEntry,
  RecoverySuggestion,
  RecoveryOptions,
  RecoveryStats,
  RecoveryPriority,
} from '../../types.js';
import { getHistoricalStore, HistoricalStore, LearnedRecoveryEntry } from '../../historicalStore.js';

// ============================================
// Predefined Recovery Actions
// ============================================

const ACTION_TEMPLATES: Record<string, Partial<RecoveryAction>> = {
  // Network recovery actions
  retry_connection: {
    type: 'retry',
    title: 'Retry Connection',
    description: 'Wait briefly and retry the connection attempt',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  check_network: {
    type: 'investigate',
    title: 'Check Network Connectivity',
    description: 'Verify network connectivity to the target host',
    automated: true,
    command: 'ping -c 3 <host>',
    riskLevel: 'safe',
    estimatedTime: 10,
  },
  use_fallback_endpoint: {
    type: 'alternative',
    title: 'Use Fallback Endpoint',
    description: 'Switch to a backup endpoint if available',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  exponential_backoff: {
    type: 'backoff',
    title: 'Exponential Backoff Retry',
    description: 'Retry with exponential backoff (1s, 2s, 4s, 8s delays)',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 30,
  },

  // Permission recovery actions
  check_permissions: {
    type: 'fix_permissions',
    title: 'Check File Permissions',
    description: 'Verify read/write permissions on the affected file',
    automated: true,
    command: 'ls -la <path>',
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  fix_file_permissions: {
    type: 'fix_permissions',
    title: 'Fix File Permissions',
    description: 'Set appropriate permissions on the file',
    automated: false,
    command: 'chmod 644 <path>',
    riskLevel: 'moderate',
    estimatedTime: 5,
  },
  check_credentials: {
    type: 'investigate',
    title: 'Verify Credentials',
    description: 'Check if API keys or tokens are valid and not expired',
    automated: false,
    riskLevel: 'safe',
    estimatedTime: 30,
  },
  use_alternative_auth: {
    type: 'alternative',
    title: 'Use Alternative Auth Method',
    description: 'Try a different authentication method if available',
    automated: false,
    riskLevel: 'moderate',
    estimatedTime: 60,
  },

  // Not found recovery actions
  verify_path: {
    type: 'investigate',
    title: 'Verify File Path',
    description: 'Check if the file or directory exists',
    automated: true,
    command: 'test -e <path> && echo "exists" || echo "not found"',
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  create_missing: {
    type: 'alternative',
    title: 'Create Missing Resource',
    description: 'Create the missing file or directory if appropriate',
    automated: false,
    riskLevel: 'moderate',
    estimatedTime: 10,
  },
  check_git_status: {
    type: 'investigate',
    title: 'Check Git Status',
    description: 'Verify the file is tracked or should be created',
    automated: true,
    command: 'git status <path>',
    riskLevel: 'safe',
    estimatedTime: 5,
  },

  // Timeout recovery actions
  increase_timeout: {
    type: 'fix_config',
    title: 'Increase Timeout Value',
    description: 'Extend the operation timeout setting',
    automated: false,
    riskLevel: 'safe',
    estimatedTime: 10,
  },
  split_operation: {
    type: 'alternative',
    title: 'Split Operation',
    description: 'Break the operation into smaller chunks',
    automated: false,
    riskLevel: 'safe',
    estimatedTime: 60,
  },
  check_resource_health: {
    type: 'investigate',
    title: 'Check Resource Health',
    description: 'Verify the target resource is responding normally',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 15,
  },

  // Resource recovery actions
  free_memory: {
    type: 'cleanup',
    title: 'Free Memory',
    description: 'Clear caches or close unused resources',
    automated: true,
    command: 'sync && echo 3 | sudo tee /proc/sys/vm/drop_caches',
    riskLevel: 'moderate',
    estimatedTime: 10,
  },
  check_disk_space: {
    type: 'investigate',
    title: 'Check Disk Space',
    description: 'Verify available disk space',
    automated: true,
    command: 'df -h',
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  cleanup_temp_files: {
    type: 'cleanup',
    title: 'Cleanup Temp Files',
    description: 'Remove temporary or cache files to free space',
    automated: false,
    command: 'rm -rf /tmp/*',
    riskLevel: 'moderate',
    estimatedTime: 30,
  },
  wait_for_rate_limit: {
    type: 'backoff',
    title: 'Wait for Rate Limit Reset',
    description: 'Wait until rate limit window resets',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 60,
  },

  // Syntax recovery actions
  validate_syntax: {
    type: 'investigate',
    title: 'Validate Syntax',
    description: 'Use a linter or validator to find syntax errors',
    automated: true,
    command: '<linter> <path>',
    riskLevel: 'safe',
    estimatedTime: 10,
  },
  fix_indentation: {
    type: 'fix_config',
    title: 'Fix Indentation',
    description: 'Correct indentation issues (tabs vs spaces)',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  check_encoding: {
    type: 'investigate',
    title: 'Check File Encoding',
    description: 'Verify the file encoding is correct (UTF-8)',
    automated: true,
    command: 'file <path>',
    riskLevel: 'safe',
    estimatedTime: 5,
  },

  // Validation recovery actions
  validate_schema: {
    type: 'investigate',
    title: 'Validate Against Schema',
    description: 'Check data against expected schema or type',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 10,
  },
  fix_type_mismatch: {
    type: 'fix_config',
    title: 'Fix Type Mismatch',
    description: 'Convert data to expected type',
    automated: false,
    riskLevel: 'moderate',
    estimatedTime: 15,
  },
  add_missing_fields: {
    type: 'fix_config',
    title: 'Add Missing Fields',
    description: 'Add required fields with default values',
    automated: false,
    riskLevel: 'moderate',
    estimatedTime: 15,
  },

  // Tool recovery actions
  check_tool_installed: {
    type: 'investigate',
    title: 'Check Tool Installation',
    description: 'Verify the required tool is installed',
    automated: true,
    command: 'which <tool>',
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  install_dependency: {
    type: 'install_dep',
    title: 'Install Missing Dependency',
    description: 'Install the required tool or library',
    automated: false,
    command: '<package-manager> install <package>',
    riskLevel: 'moderate',
    estimatedTime: 60,
  },
  check_tool_version: {
    type: 'investigate',
    title: 'Check Tool Version',
    description: 'Verify tool version compatibility',
    automated: true,
    command: '<tool> --version',
    riskLevel: 'safe',
    estimatedTime: 5,
  },
  use_alternative_tool: {
    type: 'alternative',
    title: 'Use Alternative Tool',
    description: 'Use a different tool that achieves the same result',
    automated: false,
    riskLevel: 'moderate',
    estimatedTime: 30,
  },

  // Generic recovery actions
  escalate_to_human: {
    type: 'escalate',
    title: 'Escalate to Human',
    description: 'Create a human bead for manual intervention',
    automated: true,
    riskLevel: 'safe',
    estimatedTime: 0,
  },
  restart_process: {
    type: 'restart',
    title: 'Restart Process',
    description: 'Restart the worker or service',
    automated: false,
    riskLevel: 'risky',
    estimatedTime: 30,
  },
  skip_and_continue: {
    type: 'skip',
    title: 'Skip and Continue',
    description: 'Skip this operation and continue with next task',
    automated: false,
    riskLevel: 'moderate',
    estimatedTime: 0,
  },
};

// ============================================
// Predefined Recovery Playbooks
// ============================================

const PLAYBOOKS: RecoveryPlaybookEntry[] = [
  // Network Error Playbooks
  {
    id: 'pb-network-connection-refused',
    category: 'network',
    title: 'Connection Refused Recovery',
    description: 'Recovery steps for ECONNREFUSED errors',
    patterns: [/ECONNREFUSED/i, /connection refused/i],
    actions: [
      createRecoveryAction('retry_connection', 'immediate'),
      createRecoveryAction('check_network', 'normal'),
      createRecoveryAction('exponential_backoff', 'normal'),
      createRecoveryAction('use_fallback_endpoint', 'high'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['network', 'connection', 'critical'],
  },
  {
    id: 'pb-network-timeout',
    category: 'network',
    title: 'Network Timeout Recovery',
    description: 'Recovery steps for network timeout errors',
    patterns: [/ETIMEDOUT/i, /timed? out/i, /timeout expired/i],
    actions: [
      createRecoveryAction('exponential_backoff', 'immediate'),
      createRecoveryAction('increase_timeout', 'normal'),
      createRecoveryAction('check_resource_health', 'normal'),
      createRecoveryAction('use_fallback_endpoint', 'high'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['network', 'timeout', 'latency'],
  },
  {
    id: 'pb-network-dns',
    category: 'network',
    title: 'DNS Resolution Failure',
    description: 'Recovery steps for DNS resolution errors',
    patterns: [/ENOTFOUND/i, /EAI_AGAIN/i, /DNS/i, /getaddrinfo/i],
    actions: [
      createRecoveryAction('retry_connection', 'immediate'),
      createRecoveryAction('check_network', 'high'),
      createRecoveryAction('use_fallback_endpoint', 'normal'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['network', 'dns', 'resolution'],
  },

  // Permission Error Playbooks
  {
    id: 'pb-permission-denied',
    category: 'permission',
    title: 'Permission Denied Recovery',
    description: 'Recovery steps for EACCES/EPERM errors',
    patterns: [/EACCES/i, /EPERM/i, /permission denied/i],
    actions: [
      createRecoveryAction('check_permissions', 'immediate'),
      createRecoveryAction('fix_file_permissions', 'high'),
      createRecoveryAction('use_alternative_auth', 'normal'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['permission', 'access', 'security'],
  },
  {
    id: 'pb-permission-auth',
    category: 'permission',
    title: 'Authentication Failure',
    description: 'Recovery steps for authentication errors',
    patterns: [/unauthorized/i, /forbidden/i, /401/i, /403/i, /authentication failed/i],
    actions: [
      createRecoveryAction('check_credentials', 'immediate'),
      createRecoveryAction('use_alternative_auth', 'high'),
      createRecoveryAction('escalate_to_human', 'normal'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['permission', 'auth', 'credentials'],
  },

  // Not Found Error Playbooks
  {
    id: 'pb-notfound-file',
    category: 'not_found',
    title: 'File Not Found Recovery',
    description: 'Recovery steps for ENOENT errors',
    patterns: [/ENOENT/i, /no such file/i],
    actions: [
      createRecoveryAction('verify_path', 'immediate'),
      createRecoveryAction('check_git_status', 'high'),
      createRecoveryAction('create_missing', 'normal'),
      createRecoveryAction('skip_and_continue', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['not_found', 'file', 'path'],
  },
  {
    id: 'pb-notfound-resource',
    category: 'not_found',
    title: 'Resource Not Found',
    description: 'Recovery steps for 404/resource not found errors',
    patterns: [/404/i, /not found/i, /does not exist/i, /no matching/i],
    actions: [
      createRecoveryAction('verify_path', 'immediate'),
      createRecoveryAction('create_missing', 'high'),
      createRecoveryAction('use_fallback_endpoint', 'normal'),
      createRecoveryAction('skip_and_continue', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['not_found', 'resource', '404'],
  },

  // Timeout Error Playbooks
  {
    id: 'pb-timeout-operation',
    category: 'timeout',
    title: 'Operation Timeout Recovery',
    description: 'Recovery steps for operation timeout errors',
    patterns: [/ETIMEDOUT/i, /deadline exceeded/i, /request timeout/i],
    actions: [
      createRecoveryAction('exponential_backoff', 'immediate'),
      createRecoveryAction('increase_timeout', 'high'),
      createRecoveryAction('split_operation', 'normal'),
      createRecoveryAction('check_resource_health', 'normal'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['timeout', 'latency', 'performance'],
  },

  // Resource Error Playbooks
  {
    id: 'pb-resource-memory',
    category: 'resource',
    title: 'Memory Exhaustion Recovery',
    description: 'Recovery steps for out of memory errors',
    patterns: [/ENOMEM/i, /out of memory/i],
    actions: [
      createRecoveryAction('free_memory', 'immediate'),
      createRecoveryAction('restart_process', 'high'),
      createRecoveryAction('split_operation', 'normal'),
      createRecoveryAction('escalate_to_human', 'normal'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['resource', 'memory', 'critical'],
  },
  {
    id: 'pb-resource-disk',
    category: 'resource',
    title: 'Disk Space Exhaustion',
    description: 'Recovery steps for disk full errors',
    patterns: [/disk full/i, /no space left/i, /quota exceeded/i],
    actions: [
      createRecoveryAction('check_disk_space', 'immediate'),
      createRecoveryAction('cleanup_temp_files', 'high'),
      createRecoveryAction('skip_and_continue', 'low'),
      createRecoveryAction('escalate_to_human', 'normal'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['resource', 'disk', 'space'],
  },
  {
    id: 'pb-resource-ratelimit',
    category: 'resource',
    title: 'Rate Limit Exceeded',
    description: 'Recovery steps for rate limiting errors',
    patterns: [/rate limit/i, /too many requests/i, /429/i, /limit exceeded/i],
    actions: [
      createRecoveryAction('wait_for_rate_limit', 'immediate'),
      createRecoveryAction('exponential_backoff', 'high'),
      createRecoveryAction('use_fallback_endpoint', 'normal'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['resource', 'ratelimit', 'throttle'],
  },

  // Syntax Error Playbooks
  {
    id: 'pb-syntax-parse',
    category: 'syntax',
    title: 'Parse Error Recovery',
    description: 'Recovery steps for parse/syntax errors',
    patterns: [/SyntaxError/i, /parse error/i, /JSON parse/i, /YAML parse/i],
    actions: [
      createRecoveryAction('validate_syntax', 'immediate'),
      createRecoveryAction('fix_indentation', 'high'),
      createRecoveryAction('check_encoding', 'normal'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['syntax', 'parse', 'format'],
  },
  {
    id: 'pb-syntax-format',
    category: 'syntax',
    title: 'Invalid Format Recovery',
    description: 'Recovery steps for invalid format errors',
    patterns: [/invalid format/i, /malformed/i],
    actions: [
      createRecoveryAction('validate_syntax', 'immediate'),
      createRecoveryAction('check_encoding', 'high'),
      createRecoveryAction('escalate_to_human', 'normal'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['syntax', 'format', 'encoding'],
  },

  // Validation Error Playbooks
  {
    id: 'pb-validation-type',
    category: 'validation',
    title: 'Type Validation Error',
    description: 'Recovery steps for type errors',
    patterns: [/type error/i, /cannot read/i, /cannot set/i, /undefined is not/i, /null is not/i, /is not a function/i],
    actions: [
      createRecoveryAction('validate_schema', 'immediate'),
      createRecoveryAction('fix_type_mismatch', 'high'),
      createRecoveryAction('add_missing_fields', 'normal'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['validation', 'type', 'null'],
  },
  {
    id: 'pb-validation-schema',
    category: 'validation',
    title: 'Schema Validation Error',
    description: 'Recovery steps for schema validation failures',
    patterns: [/invalid/i, /malformed/i, /unexpected token/i, /expected.*but got/i, /validation failed/i, /schema validation/i],
    actions: [
      createRecoveryAction('validate_schema', 'immediate'),
      createRecoveryAction('add_missing_fields', 'high'),
      createRecoveryAction('fix_type_mismatch', 'normal'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['validation', 'schema', 'data'],
  },

  // Tool Error Playbooks
  {
    id: 'pb-tool-missing',
    category: 'tool',
    title: 'Missing Tool Recovery',
    description: 'Recovery steps for missing tool errors',
    patterns: [/spawn.*error/i, /command not found/i],
    actions: [
      createRecoveryAction('check_tool_installed', 'immediate'),
      createRecoveryAction('install_dependency', 'high'),
      createRecoveryAction('use_alternative_tool', 'normal'),
      createRecoveryAction('escalate_to_human', 'low'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['tool', 'dependency', 'install'],
  },
  {
    id: 'pb-tool-failed',
    category: 'tool',
    title: 'Tool Execution Failure',
    description: 'Recovery steps for tool execution failures',
    patterns: [/tool.*failed/i, /tool.*error/i, /execution failed/i, /command failed/i, /exit code \d+/i, /non-zero exit/i],
    actions: [
      createRecoveryAction('check_tool_version', 'immediate'),
      createRecoveryAction('retry_connection', 'high'),
      createRecoveryAction('use_alternative_tool', 'normal'),
      createRecoveryAction('escalate_to_human', 'normal'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['tool', 'execution', 'failure'],
  },

  // Unknown Error Playbooks (fallback)
  {
    id: 'pb-unknown-generic',
    category: 'unknown',
    title: 'Unknown Error Recovery',
    description: 'Generic recovery steps for unknown errors',
    patterns: [/.*/], // Match everything
    actions: [
      createRecoveryAction('retry_connection', 'normal'),
      createRecoveryAction('restart_process', 'low'),
      createRecoveryAction('escalate_to_human', 'high'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['unknown', 'generic', 'fallback'],
  },
];

// ============================================
// Helper Functions
// ============================================

/**
 * Create a recovery action from a template
 */
function createRecoveryAction(
  templateId: string,
  priority: RecoveryPriority
): RecoveryAction {
  const template = ACTION_TEMPLATES[templateId] || {};
  return {
    id: `action-${templateId}-${Date.now().toString(36)}`,
    type: template.type || 'investigate',
    title: template.title || templateId,
    description: template.description || '',
    priority,
    automated: template.automated ?? false,
    command: template.command,
    expectedOutcome: template.expectedOutcome,
    riskLevel: template.riskLevel,
    estimatedTime: template.estimatedTime,
  };
}

/**
 * Generate a unique suggestion ID
 */
function generateSuggestionId(): string {
  return `rs-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

// ============================================
// Recovery Manager Class
// ============================================

/**
 * Manages recovery playbooks and generates suggestions
 */
export class RecoveryManager {
  private playbooks: Map<string, RecoveryPlaybookEntry> = new Map();
  private suggestions: Map<string, RecoverySuggestion> = new Map();

  constructor() {
    // Load predefined playbooks
    for (const playbook of PLAYBOOKS) {
      this.playbooks.set(playbook.id, playbook);
    }
  }

  /**
   * Find matching playbook for an error message
   */
  findPlaybook(errorMessage: string, category: ErrorCategory): RecoveryPlaybookEntry | undefined {
    // First try to find a specific match within the category
    const categoryPlaybooks = Array.from(this.playbooks.values()).filter(
      (p) => p.category === category
    );

    for (const playbook of categoryPlaybooks) {
      for (const pattern of playbook.patterns) {
        if (pattern.test(errorMessage)) {
          return playbook;
        }
      }
    }

    // Fall back to unknown playbook if nothing matched
    if (category !== 'unknown') {
      return this.playbooks.get('pb-unknown-generic');
    }

    return undefined;
  }

  /**
   * Generate recovery suggestion for an error group
   */
  generateSuggestion(
    errorGroup: ErrorGroup,
    options: RecoveryOptions = {}
  ): RecoverySuggestion | null {
    const { maxActions = 5, automatedOnly = false, minConfidence = 0.3 } = options;

    const message = errorGroup.fingerprint.sampleMessage;
    const category = errorGroup.fingerprint.category;

    // Find matching playbook
    const playbook = this.findPlaybook(message, category);

    if (!playbook) {
      return null;
    }

    // Calculate confidence based on pattern match quality
    let confidence = 0.5; // Base confidence
    if (playbook.category === category) {
      confidence += 0.3; // Category match
    }
    if (playbook.patterns.some((p) => p.source !== '.*')) {
      confidence += 0.1; // Specific pattern (not wildcard)
    }
    if (errorGroup.count > 1) {
      confidence += 0.1; // Recurring error
    }
    confidence = Math.min(confidence, 1.0);

    if (confidence < minConfidence) {
      return null;
    }

    // Filter and limit actions
    let actions = [...playbook.actions];
    if (automatedOnly) {
      actions = actions.filter((a) => a.automated);
    }
    actions = actions.slice(0, maxActions);

    // Create suggestion
    const suggestion: RecoverySuggestion = {
      id: generateSuggestionId(),
      errorGroupId: errorGroup.id,
      playbookId: playbook.id,
      category,
      title: playbook.title,
      errorSummary: message.slice(0, 100),
      actions,
      generatedAt: Date.now(),
      confidence,
      affectedWorkers: errorGroup.affectedWorkers,
      isActive: errorGroup.isActive,
    };

    // Store suggestion
    this.suggestions.set(suggestion.id, suggestion);

    return suggestion;
  }

  /**
   * Generate suggestions for all active error groups
   */
  generateAllSuggestions(
    errorGroups: ErrorGroup[],
    options: RecoveryOptions = {}
  ): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];

    for (const group of errorGroups) {
      if (!group.isActive && !options.category) {
        continue;
      }

      if (options.workerId && !group.affectedWorkers.includes(options.workerId)) {
        continue;
      }

      if (options.category && group.fingerprint.category !== options.category) {
        continue;
      }

      const suggestion = this.generateSuggestion(group, options);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    // Sort by confidence and severity
    return suggestions.sort((a, b) => {
      // Active first
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      // Then by confidence
      return b.confidence - a.confidence;
    });
  }

  /**
   * Get a specific suggestion by ID
   */
  getSuggestion(suggestionId: string): RecoverySuggestion | undefined {
    return this.suggestions.get(suggestionId);
  }

  /**
   * Get all suggestions
   */
  getAllSuggestions(): RecoverySuggestion[] {
    return Array.from(this.suggestions.values());
  }

  /**
   * Get active suggestions only
   */
  getActiveSuggestions(): RecoverySuggestion[] {
    return this.getAllSuggestions().filter((s) => s.isActive);
  }

  /**
   * Get suggestions for a specific worker
   */
  getWorkerSuggestions(workerId: string): RecoverySuggestion[] {
    return this.getAllSuggestions().filter((s) =>
      s.affectedWorkers.includes(workerId)
    );
  }

  /**
   * Get recovery statistics
   */
  getStats(): RecoveryStats {
    const suggestions = this.getAllSuggestions();
    const activeSuggestions = suggestions.filter((s) => s.isActive);

    const byCategory: Record<ErrorCategory, number> = {
      network: 0,
      permission: 0,
      validation: 0,
      resource: 0,
      not_found: 0,
      timeout: 0,
      syntax: 0,
      tool: 0,
      unknown: 0,
    };

    let automatedActions = 0;
    let manualActions = 0;
    let totalConfidence = 0;

    const actionTypeCounts: Record<RecoveryActionType, number> = {
      retry: 0,
      backoff: 0,
      alternative: 0,
      escalate: 0,
      skip: 0,
      fix_config: 0,
      install_dep: 0,
      fix_permissions: 0,
      cleanup: 0,
      restart: 0,
      investigate: 0,
    };

    for (const suggestion of suggestions) {
      byCategory[suggestion.category]++;
      totalConfidence += suggestion.confidence;

      for (const action of suggestion.actions) {
        if (action.automated) {
          automatedActions++;
        } else {
          manualActions++;
        }
        actionTypeCounts[action.type]++;
      }
    }

    // Get top action types
    const topActionTypes = Object.entries(actionTypeCounts)
      .map(([type, count]) => ({ type: type as RecoveryActionType, count }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalSuggestions: suggestions.length,
      activeSuggestions: activeSuggestions.length,
      byCategory,
      automatedActions,
      manualActions,
      avgConfidence: suggestions.length > 0 ? totalConfidence / suggestions.length : 0,
      topActionTypes,
    };
  }

  // ============================================
  // Historical Error Methods
  // ============================================

  /**
   * Search for similar historical errors and their resolutions
   */
  searchHistoricalErrors(errorMessage: string, limit: number = 5): Array<{
    error: {
      id: number;
      workerId: string;
      errorType: string;
      errorMessage: string;
      filePath: string | null;
      timestamp: number;
      resolution: string | null;
      resolutionSuccessful: boolean | null;
    };
    similarity: number;
  }> {
    const store = getHistoricalStore();
    const similar = store.findSimilarErrors(errorMessage, limit);

    return similar.map(e => ({
      error: {
        id: e.id,
        workerId: e.worker_id,
        errorType: e.error_type,
        errorMessage: e.error_message,
        filePath: e.file_path,
        timestamp: e.timestamp,
        resolution: e.resolution,
        resolutionSuccessful: e.resolution_successful !== null
          ? Boolean(e.resolution_successful)
          : null,
      },
      similarity: e.similarity,
    }));
  }

  /**
   * Get learned recovery patterns from historical data
   */
  getLearnedRecoveries(): LearnedRecoveryEntry[] {
    const store = getHistoricalStore();
    return store.getLearnedRecoveries();
  }

  /**
   * Generate recovery suggestion enhanced with historical data
   */
  generateEnhancedSuggestion(
    errorGroup: ErrorGroup,
    options: RecoveryOptions = {}
  ): RecoverySuggestion | null {
    // First get the standard suggestion
    const standardSuggestion = this.generateSuggestion(errorGroup, options);
    if (!standardSuggestion) return null;

    // Search for similar historical errors
    const historicalMatches = this.searchHistoricalErrors(
      errorGroup.fingerprint.sampleMessage,
      3
    );

    // Get learned recoveries for this error type
    const learnedRecoveries = this.getLearnedRecoveries()
      .filter(lr => lr.errorType === errorGroup.fingerprint.category)
      .slice(0, 3);

    // Add historical context to actions
    if (historicalMatches.length > 0 || learnedRecoveries.length > 0) {
      // Add learned actions from history
      const historicalActions: RecoveryAction[] = learnedRecoveries
        .filter(lr => lr.successRate > 0.5)
        .map(lr => ({
          id: `action-learned-${Date.now().toString(36)}`,
          type: 'fix_config' as RecoveryActionType,
          title: `Learned: ${lr.resolution.slice(0, 50)}...`,
          description: `Previously resolved ${lr.occurrenceCount} times with ${(lr.successRate * 100).toFixed(0)}% success rate`,
          priority: 'high' as RecoveryPriority,
          automated: false,
          expectedOutcome: lr.resolution,
          riskLevel: 'safe' as const,
          estimatedTime: 5,
        }));

      // Combine standard actions with learned actions
      standardSuggestion.actions = [
        ...standardSuggestion.actions.slice(0, 2),
        ...historicalActions,
        ...standardSuggestion.actions.slice(2),
      ].slice(0, 6);

      // Boost confidence based on historical data
      if (historicalMatches.some(m => m.error.resolutionSuccessful)) {
        standardSuggestion.confidence = Math.min(standardSuggestion.confidence + 0.2, 1.0);
      }
    }

    return standardSuggestion;
  }

  /**
   * Get recovery statistics including historical data
   */
  getEnhancedStats(): RecoveryStats & {
    historicalErrorsCount: number;
    learnedRecoveriesCount: number;
    avgHistoricalSuccessRate: number;
  } {
    const baseStats = this.getStats();
    const store = getHistoricalStore();
    const dbStats = store.getStats();
    const learned = store.getLearnedRecoveries();

    const avgSuccessRate = learned.length > 0
      ? learned.reduce((sum, lr) => sum + lr.successRate, 0) / learned.length
      : 0;

    return {
      ...baseStats,
      historicalErrorsCount: dbStats.errorsCount,
      learnedRecoveriesCount: learned.length,
      avgHistoricalSuccessRate: avgSuccessRate,
    };
  }

  /**
   * Clear all suggestions
   */
  clear(): void {
    this.suggestions.clear();
  }

  /**
   * Add a custom playbook
   */
  addPlaybook(playbook: RecoveryPlaybookEntry): void {
    this.playbooks.set(playbook.id, playbook);
  }

  /**
   * Get all playbooks
   */
  getPlaybooks(): RecoveryPlaybookEntry[] {
    return Array.from(this.playbooks.values());
  }
}

// ============================================
// Singleton Instance
// ============================================

let globalRecoveryManager: RecoveryManager | undefined;

/**
 * Get the global recovery manager instance
 */
export function getRecoveryManager(): RecoveryManager {
  if (!globalRecoveryManager) {
    globalRecoveryManager = new RecoveryManager();
  }
  return globalRecoveryManager;
}

/**
 * Reset the global recovery manager
 */
export function resetRecoveryManager(): void {
  globalRecoveryManager = undefined;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get a quick recovery suggestion for an error message
 */
export function getQuickRecovery(errorMessage: string, category: ErrorCategory): RecoveryAction[] {
  const manager = getRecoveryManager();
  const playbook = manager.findPlaybook(errorMessage, category);

  if (!playbook) {
    return [createRecoveryAction('escalate_to_human', 'high')];
  }

  return playbook.actions.slice(0, 3);
}

/**
 * Format a recovery action for display
 */
export function formatRecoveryAction(action: RecoveryAction): string {
  const priorityEmoji = {
    immediate: '🔴',
    high: '🟠',
    normal: '🟡',
    low: '🟢',
  };

  const typeEmoji = {
    retry: '🔄',
    backoff: '⏳',
    alternative: '🔀',
    escalate: '👤',
    skip: '⏭️',
    fix_config: '⚙️',
    install_dep: '📦',
    fix_permissions: '🔐',
    cleanup: '🧹',
    restart: '🔁',
    investigate: '🔍',
  };

  const emoji = priorityEmoji[action.priority] || '⚪';
  const typeIcon = typeEmoji[action.type] || '❓';
  const automatedBadge = action.automated ? '[AUTO]' : '[MANUAL]';

  return `${emoji} ${typeIcon} ${automatedBadge} ${action.title}`;
}

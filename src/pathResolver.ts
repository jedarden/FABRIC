/**
 * Path Resolution Module
 *
 * Exports path resolution functions for FABRIC CLI commands.
 * These functions handle source path resolution with validation and
 * tilde expansion for the digest command and other CLI commands.
 */

import { statSync } from 'node:fs';
import type { ResolvedSource } from './types.js';

/**
 * Resolve --source option value to a typed source with validation.
 *
 * This is called by resolveFromOptions() when the --source option is provided.
 * It performs actual filesystem validation to determine whether the path is a directory
 * or file, and exits with an error if the path doesn't exist.
 *
 * @param source - The --source option value (file or directory path). Can include ~ as
 *                 home directory shorthand.
 * @param HOME - Home directory path for tilde expansion.
 * @returns A ResolvedSource object with 'kind' set to 'directory' or 'file' based on
 *          fs.statSync(), and the expanded absolute path.
 *
 * Validation behavior:
 *   - Expands leading ~ to HOME environment variable
 *   - Calls fs.statSync() to check path existence and type
 *   - Returns { kind: 'directory', path: expanded } for directories
 *   - Returns { kind: 'file', path: expanded } for files
 *   - Exits process(1) with error message if path doesn't exist
 *
 * Note: This is only called when --source is explicitly provided. The legacy -f/--file
 * option bypasses this validation (see resolveFromOptions()).
 */
export function resolveSource(source: string, HOME: string): ResolvedSource {
  const expanded = source.startsWith('~') ? source.replace('~', HOME) : source;
  try {
    const stat = statSync(expanded);
    return stat.isDirectory()
      ? { kind: 'directory', path: expanded }
      : { kind: 'file', path: expanded };
  } catch {
    console.error(`Error: Source path does not exist: ${expanded}`);
    process.exit(1);
  }
}

/**
 * Resolve CLI source options into a typed source.
 *
 * This function implements the backward-compatible source resolution logic for FABRIC commands.
 * It prioritizes --source over -f/--file, with a default to ~/.needle/logs if neither is provided.
 *
 * @param source - The --source option value (file or directory path). If provided, this takes
 *                 precedence over `file` and is validated via resolveSource().
 * @param file - The legacy -f/--file option value (file path only). Used for backward compatibility
 *               with older FABRIC invocations that predate --source.
 * @param HOME - Home directory path for default and tilde expansion.
 * @returns A ResolvedSource object indicating the kind ('directory' | 'file') and expanded path.
 *
 * Flow:
 *   1. If `source` is provided → call resolveSource(source), which:
 *      - Expands ~ to HOME
 *      - Checks if path exists (fs.statSync)
 *      - Returns { kind: 'directory', path } or { kind: 'file', path }
 *      - Exits with error if path doesn't exist
 *   2. Else if `file` is provided → treat as file path:
 *      - Expands ~ to HOME if present
 *      - Returns { kind: 'file', path } (no existence check)
 *   3. Else → default to ~/.needle/logs as directory
 *
 * Usage examples:
 *   - `fabric digest --source /path/to/logs` → resolves to directory or file based on fs.stat
 *   - `fabric digest -f /path/to/file.jsonl` → resolves as file (legacy)
 *   - `fabric digest` → resolves to ~/.needle/logs as directory
 *
 * See also: resolveSource() (handles the actual path validation), ResolvedSource type.
 */
export function resolveFromOptions(
  source: string | undefined,
  file: string | undefined,
  HOME: string
): ResolvedSource {
  if (source) return resolveSource(source, HOME);
  if (file) return { kind: 'file', path: file.startsWith('~') ? file.replace('~', HOME) : file };
  return { kind: 'directory', path: `${HOME}/.needle/logs` };
}
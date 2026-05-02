/**
 * Type declarations for systemd-notify module
 */
declare module 'systemd-notify' {
  export interface NotifyOptions {
    readonly?: boolean;
    pid?: number;
  }

  export function notify(
    status: string,
    options?: NotifyOptions
  ): boolean;

  export function ready(options?: NotifyOptions): boolean;

  export function reloading(options?: NotifyOptions): boolean;

  export function stopping(options?: NotifyOptions): boolean;

  export function status(status: string, options?: NotifyOptions): boolean;

  export function errno(errno: number, options?: NotifyOptions): boolean;

  export function buserror(
    error: string,
    options?: NotifyOptions
  ): boolean;

  export function mainpid(pid: number, options?: NotifyOptions): boolean;

  export function watchdog(
    trigger: string | boolean,
    options?: NotifyOptions
  ): boolean;

  export function fdname(
    fd: number,
    name: string,
    options?: NotifyOptions
  ): boolean;

  export function fdstore(
    fd: number,
    options?: NotifyOptions
  ): boolean;
}

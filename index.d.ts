/** One observed process. Unreadable details are always null. */
export interface ProcessInfo {
  readonly pid: number
  /** OS process name, which may be truncated by the OS. */
  readonly name: string | null
  readonly parentPid: number | null
  readonly executablePath: string | null
  /** Resident memory / working set in bytes, including shared pages. */
  readonly memoryBytes: number | null
  /** Unix timestamp in milliseconds. Precision depends on the OS. */
  readonly startedAt: number | null
}

export type ForegroundSource = 'win32' | 'appkit' | 'x11'

export type ForegroundUnavailableReason =
  'wayland' | 'no-display' | 'unsupported-desktop' | 'missing-pid' | 'unverified-pid' | 'changed-during-query'

/** One observation of the desktop's foreground owner, not a complete process record. */
export type ForegroundResult =
  | { readonly status: 'active'; readonly pid: number; readonly source: ForegroundSource }
  | { readonly status: 'none'; readonly source: ForegroundSource }
  | { readonly status: 'unavailable'; readonly reason: ForegroundUnavailableReason }

export interface ListProcessesOptions {
  /** Omit for all visible processes; [] returns none. Duplicate PIDs are ignored. */
  readonly pids?: readonly number[]
}

export type QueryOperation = 'listProcesses' | 'getProcess' | 'getForeground'

/** Unexpected query failure, shared by asynchronous and synchronous functions. */
export declare class ProcessQueryError extends Error {
  readonly code: 'ERR_PROCESS_QUERY_FAILED'
  /** Logical query name, without a Sync suffix in either execution mode. */
  readonly operation: QueryOperation
  /** The original error from the native binding, including the system failure details. */
  readonly cause: Error
  constructor(operation: QueryOperation, cause: Error)
}

/** Collect a fresh, sorted list on Node.js's worker pool. Does not query the desktop. */
export declare function listProcesses(options?: ListProcessesOptions): Promise<readonly ProcessInfo[]>
/** Find a visible PID. Resolves to null when it is absent or has exited. */
export declare function getProcess(pid: number): Promise<ProcessInfo | null>
/** Query foreground ownership without enumerating processes. Unexpected failures reject. */
export declare function getForeground(): Promise<ForegroundResult>

/** Blocking alternatives for scripts and dedicated workers. */
export declare function listProcessesSync(options?: ListProcessesOptions): readonly ProcessInfo[]
export declare function getProcessSync(pid: number): ProcessInfo | null
export declare function getForegroundSync(): ForegroundResult

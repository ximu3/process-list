import * as native from './native/binding.ts'

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

/** One observation of the desktop's foreground owner. */
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
export class ProcessQueryError extends Error {
  declare readonly code: 'ERR_PROCESS_QUERY_FAILED'
  /** Logical query name, without a Sync suffix in either execution mode. */
  declare readonly operation: QueryOperation
  /** The original error from the native binding, including the system failure details. */
  declare readonly cause: Error

  constructor(operation: QueryOperation, cause: Error) {
    super(`${operation} failed: ${cause.message}`, { cause })
    this.name = 'ProcessQueryError'
    this.code = 'ERR_PROCESS_QUERY_FAILED'
    this.operation = operation
    this.cause = cause
  }
}

async function query<T>(operation: QueryOperation, execute: () => Promise<T>): Promise<T> {
  try {
    return await execute()
  } catch (cause) {
    throw new ProcessQueryError(operation, cause instanceof Error ? cause : new Error(String(cause)))
  }
}

function querySync<T>(operation: QueryOperation, execute: () => T): T {
  try {
    return execute()
  } catch (cause) {
    throw new ProcessQueryError(operation, cause instanceof Error ? cause : new Error(String(cause)))
  }
}

function validatePid(pid: unknown): number {
  if (typeof pid !== 'number') throw new TypeError('pid must be a number')
  if (!Number.isInteger(pid) || pid < 0 || pid > 0xffff_ffff) {
    throw new RangeError('pid must be an integer between 0 and 4294967295')
  }
  return pid
}

function validateOptions(options: ListProcessesOptions | undefined): number[] | undefined {
  if (options === undefined) return undefined
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object')
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'pids') throw new TypeError(`Unknown option: ${String(key)}`)
  }
  const { pids } = options
  if (pids !== undefined && !Array.isArray(pids)) throw new TypeError('pids must be an array')
  return pids === undefined ? undefined : [...new Set(Array.from(pids, validatePid))]
}

function processInfo(process: native.NativeProcess): ProcessInfo {
  return {
    pid: process.pid,
    name: process.name ?? null,
    parentPid: process.parentPid ?? null,
    executablePath: process.executablePath ?? null,
    memoryBytes: process.memoryBytes ?? null,
    startedAt: process.startedAt ?? null,
  }
}

function foregroundResult(value: native.NativeForeground): ForegroundResult {
  if (value.status === 'active' && value.pid !== undefined && value.source !== undefined) {
    return { status: 'active', pid: value.pid, source: value.source as ForegroundSource }
  }
  if (value.status === 'none' && value.source !== undefined) {
    return { status: 'none', source: value.source as ForegroundSource }
  }
  if (value.status === 'unavailable' && value.reason !== undefined) {
    return { status: 'unavailable', reason: value.reason as ForegroundUnavailableReason }
  }
  throw new Error('Invalid foreground response from native binding')
}

/** Collect a fresh, sorted list on Node.js's worker pool. Does not query the desktop. */
export async function listProcesses(options?: ListProcessesOptions): Promise<readonly ProcessInfo[]> {
  const pids = validateOptions(options)
  return query('listProcesses', async () => (await native.listProcesses(pids)).map(processInfo))
}

/** Blocking alternative to listProcesses. */
export function listProcessesSync(options?: ListProcessesOptions): readonly ProcessInfo[] {
  const pids = validateOptions(options)
  return querySync('listProcesses', () => native.listProcessesSync(pids).map(processInfo))
}

/** Find a visible PID. Resolves to null when it is absent or has exited. */
export async function getProcess(pid: number): Promise<ProcessInfo | null> {
  const validated = validatePid(pid)
  return query('getProcess', async () => {
    const value = await native.getProcess(validated)
    return value == null ? null : processInfo(value)
  })
}

/** Blocking alternative to getProcess. */
export function getProcessSync(pid: number): ProcessInfo | null {
  const validated = validatePid(pid)
  return querySync('getProcess', () => {
    const value = native.getProcessSync(validated)
    return value == null ? null : processInfo(value)
  })
}

/** Query foreground ownership without enumerating processes. Unexpected failures reject. */
export async function getForeground(): Promise<ForegroundResult> {
  return query('getForeground', async () => foregroundResult(await native.getForeground()))
}

/** Blocking alternative to getForeground. */
export function getForegroundSync(): ForegroundResult {
  return querySync('getForeground', () => foregroundResult(native.getForegroundSync()))
}

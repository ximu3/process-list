import * as native from './native/binding.js'

/** @typedef {import('./index.d.ts').ProcessInfo} ProcessInfo */
/** @typedef {import('./index.d.ts').ForegroundResult} ForegroundResult */
/** @typedef {import('./index.d.ts').ListProcessesOptions} ListProcessesOptions */
/** @typedef {import('./index.d.ts').QueryOperation} QueryOperation */

export class ProcessQueryError extends Error {
  /** @param {QueryOperation} operation @param {Error} cause */
  constructor(operation, cause) {
    super(`${operation} failed: ${cause.message}`, { cause })
    this.name = 'ProcessQueryError'
    /** @type {'ERR_PROCESS_QUERY_FAILED'} */
    this.code = 'ERR_PROCESS_QUERY_FAILED'
    this.operation = operation
    this.cause = cause
  }
}

/** @template T @param {QueryOperation} operation @param {() => Promise<T>} execute @returns {Promise<T>} */
async function query(operation, execute) {
  try {
    return await execute()
  } catch (cause) {
    throw new ProcessQueryError(operation, cause instanceof Error ? cause : new Error(String(cause)))
  }
}

/** @template T @param {QueryOperation} operation @param {() => T} execute @returns {T} */
function querySync(operation, execute) {
  try {
    return execute()
  } catch (cause) {
    throw new ProcessQueryError(operation, cause instanceof Error ? cause : new Error(String(cause)))
  }
}

/** @param {unknown} pid @returns {number} */
function validatePid(pid) {
  if (typeof pid !== 'number') throw new TypeError('pid must be a number')
  if (!Number.isInteger(pid) || pid < 0 || pid > 0xffff_ffff) {
    throw new RangeError('pid must be an integer between 0 and 4294967295')
  }
  return pid
}

/** @param {ListProcessesOptions | undefined} options */
function validateOptions(options) {
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

/** @param {import('./native/binding.js').NativeProcess} process @returns {ProcessInfo} */
function processInfo(process) {
  return {
    pid: process.pid,
    name: process.name ?? null,
    parentPid: process.parentPid ?? null,
    executablePath: process.executablePath ?? null,
    memoryBytes: process.memoryBytes ?? null,
    startedAt: process.startedAt ?? null,
  }
}

/** @param {import('./native/binding.js').NativeForeground} value @returns {ForegroundResult} */
function foregroundResult(value) {
  if (value.status === 'active' && value.pid !== undefined && value.source !== undefined) {
    return {
      status: 'active',
      pid: value.pid,
      source: /** @type {import('./index.d.ts').ForegroundSource} */ (value.source),
    }
  }
  if (value.status === 'none' && value.source !== undefined) {
    return { status: 'none', source: /** @type {import('./index.d.ts').ForegroundSource} */ (value.source) }
  }
  if (value.status === 'unavailable' && value.reason !== undefined) {
    return {
      status: 'unavailable',
      reason: /** @type {import('./index.d.ts').ForegroundUnavailableReason} */ (value.reason),
    }
  }
  throw new Error('Invalid foreground response from native binding')
}

/** @param {ListProcessesOptions} [options] @returns {Promise<readonly ProcessInfo[]>} */
export async function listProcesses(options) {
  const pids = validateOptions(options)
  return query('listProcesses', async () => (await native.listProcesses(pids)).map(processInfo))
}

/** @param {ListProcessesOptions} [options] @returns {readonly ProcessInfo[]} */
export function listProcessesSync(options) {
  const pids = validateOptions(options)
  return querySync('listProcesses', () => native.listProcessesSync(pids).map(processInfo))
}

/** @param {number} pid @returns {Promise<ProcessInfo | null>} */
export async function getProcess(pid) {
  const validated = validatePid(pid)
  return query('getProcess', async () => {
    const value = await native.getProcess(validated)
    return value == null ? null : processInfo(value)
  })
}

/** @param {number} pid @returns {ProcessInfo | null} */
export function getProcessSync(pid) {
  const validated = validatePid(pid)
  return querySync('getProcess', () => {
    const value = native.getProcessSync(validated)
    return value == null ? null : processInfo(value)
  })
}

/** @returns {Promise<ForegroundResult>} */
export async function getForeground() {
  return query('getForeground', async () => foregroundResult(await native.getForeground()))
}

/** @returns {ForegroundResult} */
export function getForegroundSync() {
  return querySync('getForeground', () => foregroundResult(native.getForegroundSync()))
}

import assert from 'node:assert/strict'
import { mock } from 'node:test'

let cause
let calls = 0
let foregroundCalls = 0
let foreground = { status: 'none', source: 'win32' }
const record = { pid: process.pid }
const value = (result) => {
  calls++
  if (cause) throw cause
  return result
}
mock.module(new URL('../../native/binding.js', import.meta.url), {
  namedExports: {
    listProcesses: async () => value([record]),
    listProcessesSync: () => value([record]),
    getProcess: async () => value(record),
    getProcessSync: () => value(record),
    getForeground: async () => {
      foregroundCalls++
      return value(foreground)
    },
    getForegroundSync: () => {
      foregroundCalls++
      return value(foreground)
    },
  },
})
const api = await import('../../index.js')
assert.ok(Array.isArray(await api.listProcesses()))
assert.ok(Array.isArray(api.listProcessesSync()))
assert.equal(foregroundCalls, 0)

const failures = [
  ['listProcesses', 'listProcesses', []],
  ['listProcessesSync', 'listProcesses', []],
  ['getProcess', 'getProcess', [process.pid]],
  ['getProcessSync', 'getProcess', [process.pid]],
  ['getForeground', 'getForeground', []],
  ['getForegroundSync', 'getForeground', []],
]
cause = Object.assign(new Error('native connection reset'), { code: 'ECONNRESET' })
for (const [name, operation, args] of failures) {
  const verify = (error) => {
    assert.ok(error instanceof api.ProcessQueryError)
    assert.ok(error instanceof Error)
    assert.equal(error.name, 'ProcessQueryError')
    assert.equal(error.code, 'ERR_PROCESS_QUERY_FAILED')
    assert.equal(error.operation, operation)
    assert.equal(error.cause, cause)
    assert.equal(error.cause.code, 'ECONNRESET')
    return true
  }
  if (name.endsWith('Sync')) assert.throws(() => api[name](...args), verify)
  else await assert.rejects(api[name](...args), verify)
}

const beforeValidation = calls
await assert.rejects(api.getProcess(-1), RangeError)
assert.throws(() => api.getProcessSync('123'), TypeError)
await assert.rejects(api.listProcesses({ foreground: true }), TypeError)
assert.equal(calls, beforeValidation)

cause = undefined
for (const expected of [
  { status: 'active', pid: 123, source: 'win32' },
  { status: 'none', source: 'win32' },
  { status: 'unavailable', reason: 'wayland' },
  { status: 'unavailable', reason: 'changed-during-query' },
]) {
  foreground = expected
  assert.deepEqual(await api.getForeground(), expected)
  assert.deepEqual(api.getForegroundSync(), expected)
}

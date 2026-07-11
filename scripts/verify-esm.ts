import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { getProcess, getProcesses } from '@ximu3/process-list'

assert.equal(typeof getProcess, 'function')
assert.equal(typeof getProcesses, 'function')
assert.ok(Array.isArray(getProcesses()))

const require = createRequire(import.meta.url)
assert.throws(
  () => require('@ximu3/process-list'),
  (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
)

import assert from 'node:assert/strict'
import {
  getForeground,
  getForegroundSync,
  listProcesses,
  listProcessesSync,
  ProcessQueryError,
} from '@ximu3/process-list'

for (const processes of [
  await listProcesses({ pids: [process.pid] }),
  listProcessesSync({ pids: [process.pid] }),
]) {
  assert.deepEqual(
    processes.map((process) => process.pid),
    [process.pid],
  )
}
const expected = process.argv[2]
if (expected === 'error') {
  const verify = (error) => {
    assert.ok(error instanceof ProcessQueryError)
    assert.equal(error.operation, 'getForeground')
    assert.equal(error.code, 'ERR_PROCESS_QUERY_FAILED')
    assert.ok(error.cause instanceof Error)
    assert.ok(error.cause.message.length > 0)
    return true
  }
  await assert.rejects(getForeground(), verify)
  assert.throws(getForegroundSync, verify)
} else {
  assert.deepEqual(await getForeground(), { status: 'unavailable', reason: expected })
  assert.deepEqual(getForegroundSync(), { status: 'unavailable', reason: expected })
}

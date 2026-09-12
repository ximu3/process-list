import assert from 'node:assert/strict'
import { parentPort } from 'node:worker_threads'
import { getProcess } from '@ximu3/process-list'
assert.ok(parentPort)
parentPort.postMessage(await getProcess(process.pid))

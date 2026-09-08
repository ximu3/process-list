import assert from 'node:assert/strict'
import { pbkdf2 } from 'node:crypto'
import { promisify } from 'node:util'
import { getProcess } from '@ximu3/process-list'

let cryptoFinished = false
let timerTicks = 0
const timer = setInterval(() => {
  timerTicks++
}, 5)
try {
  const busy = promisify(pbkdf2)('test', 'test', 600_000, 32, 'sha512').then(() => {
    cryptoFinished = true
  })
  const value = await getProcess(process.pid)
  assert.equal(value.pid, process.pid)
  assert.ok(cryptoFinished, 'native work must queue behind the occupied worker')
  assert.ok(timerTicks > 0, 'the JavaScript event loop must remain responsive')
  await busy
} finally {
  clearInterval(timer)
}

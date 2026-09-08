import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { realpathSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, toNamespacedPath } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import {
  getForeground,
  getForegroundSync,
  getProcess,
  getProcessSync,
  listProcesses,
  listProcessesSync,
} from '@ximu3/process-list'

const processKeys = ['executablePath', 'memoryBytes', 'name', 'parentPid', 'pid', 'startedAt']

function assertProcess(value) {
  assert.deepEqual(Object.keys(value).sort(), processKeys)
  assert.ok(Number.isInteger(value.pid) && value.pid >= 0)
  assert.ok(value.name === null || typeof value.name === 'string')
  assert.ok(value.executablePath === null || typeof value.executablePath === 'string')
  assert.ok(value.parentPid === null || (Number.isInteger(value.parentPid) && value.parentPid >= 0))
  assert.ok(value.memoryBytes === null || (Number.isFinite(value.memoryBytes) && value.memoryBytes >= 0))
  assert.ok(value.startedAt === null || (Number.isFinite(value.startedAt) && value.startedAt >= 0))
}

function assertForeground(value) {
  if (value.status === 'active') {
    assert.deepEqual(Object.keys(value).sort(), ['pid', 'source', 'status'])
    assert.ok(Number.isInteger(value.pid) && value.pid > 0)
  } else if (value.status === 'none') {
    assert.deepEqual(Object.keys(value).sort(), ['source', 'status'])
  } else {
    assert.equal(value.status, 'unavailable')
    assert.deepEqual(Object.keys(value).sort(), ['reason', 'status'])
    assert.ok(
      [
        'wayland',
        'no-display',
        'unsupported-desktop',
        'missing-pid',
        'unverified-pid',
        'changed-during-query',
      ].includes(value.reason),
    )
    return
  }
  assert.ok(['win32', 'appkit', 'x11'].includes(value.source))
  assert.equal(value.source, { win32: 'win32', darwin: 'appkit', linux: 'x11' }[process.platform])
}

test('self query returns actual details with consistent units and nullability', async () => {
  const value = await getProcess(process.pid)
  assertProcess(value)
  assert.equal(value.pid, process.pid)
  assert.equal(value.parentPid, process.ppid)
  assert.ok(value.name.length > 0)
  assert.equal(realpathSync(value.executablePath), realpathSync(process.execPath))
  assert.ok(value.memoryBytes > 0)
  assert.ok(Math.abs(value.startedAt - (Date.now() - process.uptime() * 1000)) < 10_000)
  const sync = getProcessSync(process.pid)
  for (const key of ['pid', 'parentPid', 'name', 'executablePath', 'startedAt'])
    assert.equal(value[key], sync[key])
})

test('process lists are arrays with sorted unique PIDs', async () => {
  const processes = await listProcesses()
  assert.ok(Array.isArray(processes))
  assert.ok(processes.some((value) => value.pid === process.pid))
  processes.forEach(assertProcess)
  const pids = processes.map((value) => value.pid)
  assert.deepEqual(
    pids,
    [...new Set(pids)].sort((a, b) => a - b),
  )
  assert.deepEqual(
    Object.keys(processes),
    processes.map((_, index) => String(index)),
  )
})

test('PID filtering is exact and an empty selection stays empty', async () => {
  const options = { pids: [process.pid, process.pid] }
  const asyncResult = await listProcesses(options)
  const syncResult = listProcessesSync(options)
  for (const processes of [asyncResult, syncResult]) {
    assert.deepEqual(
      processes.map((value) => value.pid),
      [process.pid],
    )
  }
  assert.deepEqual(await listProcesses({ pids: [] }), [])
  assert.deepEqual(options.pids, [process.pid, process.pid])
})

test(
  'child process is observed with its parent and disappears after exit',
  { timeout: 15_000 },
  async (t) => {
    const before = Date.now()
    const child = fork(new URL('./fixtures/child.js', import.meta.url), {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    t.after(() => {
      if (child.exitCode === null) child.kill()
    })
    await once(child, 'message')
    const value = await getProcess(child.pid)
    assertProcess(value)
    assert.equal(value.parentPid, process.pid)
    assert.ok(value.startedAt >= before - 1000 && value.startedAt <= Date.now())
    assert.ok(value.memoryBytes > 0)
    const exited = once(child, 'exit')
    child.send('exit')
    await exited
    assert.equal(await getProcess(child.pid), null)
    assert.equal(getProcessSync(child.pid), null)
  },
)

test('invalid PIDs are rejected before native integer conversion', async () => {
  for (const pid of [-1, 1.5, NaN, Infinity, 0x1_0000_0000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => getProcessSync(pid), RangeError)
    await assert.rejects(getProcess(pid), RangeError)
    await assert.rejects(listProcesses({ pids: [pid] }), RangeError)
  }
  for (const pid of ['1', null, undefined, 1n, {}, true]) {
    assert.throws(() => getProcessSync(pid), TypeError)
    await assert.rejects(getProcess(pid), TypeError)
  }
  assert.doesNotThrow(() => getProcessSync(0))
})

test('invalid options never silently change a query', async () => {
  for (const options of [
    null,
    [],
    'all',
    3,
    { include: [] },
    { foreground: true },
    { foreground: false },
    { foreground: null },
    { foreground: 1 },
    { pids: null },
    { pids: '1' },
    { pids: new Array(1) },
    { [Symbol('unknown')]: true },
  ]) {
    assert.throws(() => listProcessesSync(options), TypeError)
    await assert.rejects(listProcesses(options), TypeError)
  }
})

test('foreground queries have the same state contract in both execution modes', async () => {
  assertForeground(await getForeground())
  assertForeground(getForegroundSync())
})

test('independent concurrent queries do not share mutable records', async () => {
  const lists = await Promise.all(Array.from({ length: 12 }, () => listProcesses({ pids: [process.pid] })))
  for (const processes of lists) assert.equal(processes[0].pid, process.pid)
  lists[0][0].name = 'changed by caller'
  assert.notEqual(lists[1][0].name, 'changed by caller')
})

test('the binding works inside a Node.js worker', { timeout: 10_000 }, async (t) => {
  const worker = new Worker(new URL('./fixtures/worker.js', import.meta.url))
  t.after(() => worker.terminate())
  const [message] = await once(worker, 'message')
  assert.equal(message.pid, process.pid)
  assertProcess(message)
})

test(
  'Windows executable paths preserve Unicode and exceed MAX_PATH',
  { skip: process.platform !== 'win32', timeout: 20_000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'process-list-path-'))
    let child
    try {
      const directory = join(
        temporary,
        '路径 with spaces',
        'segment-'.repeat(18),
        'segment-'.repeat(14),
        'segment-'.repeat(24),
      )
      await mkdir(directory, { recursive: true })
      const executable = join(directory, '进程.exe')
      await copyFile(process.execPath, executable)
      child = fork(new URL('./fixtures/child.js', import.meta.url), {
        execPath: toNamespacedPath(executable),
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      })
      await once(child, 'message')
      const value = await getProcess(child.pid)
      assert.ok(value.executablePath.length > 512)
      assert.equal(realpathSync(value.executablePath), realpathSync(executable))
    } finally {
      if (child?.exitCode === null) {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }
      await rm(temporary, { recursive: true, force: true })
    }
  },
)

test(
  'async queries use the worker pool and leave JavaScript timers responsive',
  { timeout: 15_000 },
  async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/async.js', import.meta.url))], {
      env: { ...process.env, UV_THREADPOOL_SIZE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let error = ''
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      error += chunk
    })
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, error)
  },
)

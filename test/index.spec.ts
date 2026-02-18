import test from 'ava'

import { getProcesses, getProcess } from '../index'

test('getProcesses returns non-empty array', (t) => {
  const processes = getProcesses()
  t.true(Array.isArray(processes))
  t.true(processes.length > 0)
})

test('getProcesses returns processes with required fields', (t) => {
  const processes = getProcesses()
  const proc = processes[0]

  t.is(typeof proc.pid, 'number')
  t.is(typeof proc.name, 'string')
  t.is(typeof proc.isForeground, 'boolean')
  // path can be null/undefined for system processes without accessible path
  t.true(proc.path === null || proc.path === undefined || typeof proc.path === 'string')
})

test('getProcesses with include options returns optional fields', (t) => {
  const processes = getProcesses({ include: ['ppid', 'memory', 'startTime'] })
  const withPpid = processes.find((p) => p.ppid !== undefined && p.ppid !== null)

  if (withPpid) {
    t.is(typeof withPpid.ppid, 'number')
  } else {
    t.pass('No process with ppid found')
  }

  const withMemory = processes.find((p) => p.memory !== undefined && p.memory !== null)
  if (withMemory) {
    t.is(typeof withMemory.memory, 'number')
  } else {
    t.pass('No process with memory found')
  }
})

test('getProcess returns null for non-existent PID', (t) => {
  const info = getProcess(999999999)
  t.is(info, null)
})

test('foreground process detection works', (t) => {
  const processes = getProcesses()
  const foregroundCount = processes.filter((p) => p.isForeground).length

  // Should have at most one foreground process
  t.true(foregroundCount <= 1)
})

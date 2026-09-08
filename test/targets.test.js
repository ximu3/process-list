import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentTarget, selectTarget, targets } from '../native/targets.js'
import { validateProject } from '../scripts/package.mjs'

test('the distribution matrix and build configuration agree', validateProject)

test('runtime selection covers every published platform with no ABI fallback', () => {
  for (const target of targets) assert.equal(selectTarget(target.os, target.cpu, target.libc), target)
  for (const args of [
    ['freebsd', 'x64'],
    ['win32', 'ia32'],
    ['linux', 'x64'],
    ['linux', 'x64', 'bionic'],
  ]) {
    assert.throws(() => selectTarget(...args), { code: 'ERR_UNSUPPORTED_PLATFORM' })
  }
})

test('platform detection preserves the process diagnostic report configuration', () => {
  const original = process.report.excludeNetwork
  currentTarget()
  assert.equal(process.report.excludeNetwork, original)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentTarget, selectTarget, targets } from '../native/targets.ts'
import { validateProject } from '../scripts/package.ts'

test('the distribution matrix and build configuration agree', validateProject)

test('runtime selection covers every published platform with no ABI fallback', () => {
  for (const target of targets) assert.equal(selectTarget(target.os, target.cpu, target.libc), target)
  const unsupported: Parameters<typeof selectTarget>[] = [
    ['freebsd', 'x64'],
    ['win32', 'ia32'],
    ['linux', 'x64'],
    ['linux', 'x64', 'bionic'],
  ]
  for (const args of unsupported) {
    assert.throws(() => selectTarget(...args), { code: 'ERR_UNSUPPORTED_PLATFORM' })
  }
})

test('platform detection preserves the process diagnostic report configuration', () => {
  const report = process.report as NodeJS.ProcessReport & { excludeNetwork?: boolean }
  const original = report.excludeNetwork
  currentTarget()
  assert.equal(report.excludeNetwork, original)
})

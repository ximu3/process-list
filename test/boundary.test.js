import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('public query errors preserve their causes and list queries never invoke foreground lookup', () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-test-module-mocks', fileURLToPath(new URL('./fixtures/boundary.js', import.meta.url))],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  )
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
})

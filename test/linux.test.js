import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

for (const [expected, session] of [
  ['no-display', {}],
  ['wayland', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: 'invalid-display' }],
  ['error', { XDG_SESSION_TYPE: 'x11', DISPLAY: 'invalid-display' }],
]) {
  test(
    `Linux foreground result: ${expected}; process listing remains independent`,
    { skip: process.platform !== 'linux' },
    () => {
      const env = { ...process.env }
      delete env.DISPLAY
      delete env.WAYLAND_DISPLAY
      delete env.XDG_SESSION_TYPE
      Object.assign(env, session)
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./fixtures/linux-session.js', import.meta.url)), expected],
        { env, encoding: 'utf8', timeout: 15_000, windowsHide: true },
      )
      assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    },
  )
}

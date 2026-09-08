import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentTarget, targets } from '../native/targets.js'
import { npm } from './npm.mjs'
import {
  binaryName,
  manifest,
  root,
  stageMain,
  stagePlatform,
  validateProject,
  writeJson,
} from './package.mjs'

await validateProject()
const temporary = await mkdtemp(join(tmpdir(), 'process-list-package-'))
try {
  const target = currentTarget()
  const main = join(temporary, 'main')
  const platform = join(temporary, 'platform')
  const consumer = join(temporary, 'consumer')
  await stageMain(main)
  await stagePlatform(platform, target, join(root, 'native', `${binaryName}.${target.suffix}.node`))
  const [packedMain] = JSON.parse(
    npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], main),
  )
  const [packedPlatform] = JSON.parse(
    npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], platform),
  )
  const files = packedMain.files.map((/** @type {{path: string}} */ file) => file.path)
  assert.deepEqual(files.sort(), ['package.json', 'README.md', 'LICENSE', ...manifest.files].sort())
  const published = JSON.parse(await readFile(join(main, 'package.json'), 'utf8'))
  assert.equal(published.private, undefined, 'The staged distribution must be publishable')
  assert.equal(Object.keys(published.optionalDependencies).length, targets.length)
  assert.ok(Object.values(published.optionalDependencies).every((version) => version === manifest.version))
  await mkdir(consumer)
  await writeJson(join(consumer, 'package.json'), {
    name: 'process-list-consumer-test',
    private: true,
    type: 'module',
  })
  npm(
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      join(temporary, packedMain.filename),
      join(temporary, packedPlatform.filename),
    ],
    consumer,
  )
  await writeFile(
    join(consumer, 'verify.mjs'),
    `
import assert from 'node:assert/strict'
import * as api from '${manifest.name}'
assert.deepEqual(Object.keys(api).sort(), ['ProcessQueryError', 'getForeground', 'getForegroundSync', 'getProcess', 'getProcessSync', 'listProcesses', 'listProcessesSync'].sort())
const own = await api.getProcess(process.pid)
assert.equal(own.pid, process.pid)
assert.ok(own.memoryBytes > 0)
assert.ok(own.executablePath)
assert.equal(api.getProcessSync(process.pid).startedAt, own.startedAt)
const processes = await api.listProcesses({ pids: [process.pid] })
assert.ok(Array.isArray(processes))
assert.equal(processes.length, 1)
assert.ok(['active', 'none', 'unavailable'].includes((await api.getForeground()).status))
`,
  )
  const result = spawnSync(process.execPath, ['verify.mjs'], {
    cwd: consumer,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)

  // Each import happens in a new process so the module cache cannot hide loader failures.
  await writeFile(
    join(consumer, 'verify-error.mjs'),
    `
import assert from 'node:assert/strict'
await assert.rejects(import('${manifest.name}'), (error) => {
  assert.equal(error.code, 'ERR_NATIVE_LOAD_FAILED')
  assert.ok(error.cause instanceof Error)
  return true
})
`,
  )
  const nativeDirectory = join(consumer, 'node_modules', `${manifest.name}-${target.suffix}`)
  const nativeManifestPath = join(nativeDirectory, 'package.json')
  const nativeManifest = JSON.parse(await readFile(nativeManifestPath, 'utf8'))
  await writeJson(nativeManifestPath, { ...nativeManifest, version: '0.0.0' })
  const mismatch = spawnSync(process.execPath, ['verify-error.mjs'], {
    cwd: consumer,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  assert.equal(mismatch.status, 0, mismatch.error?.message ?? mismatch.stderr)
  await writeJson(nativeManifestPath, nativeManifest)
  await writeFile(join(nativeDirectory, `${binaryName}.${target.suffix}.node`), 'invalid native binary')
  const corrupt = spawnSync(process.execPath, ['verify-error.mjs'], {
    cwd: consumer,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  assert.equal(corrupt.status, 0, corrupt.error?.message ?? corrupt.stderr)
  console.log(`Verified packed ESM exports, optional native dependency, and runtime API for ${target.suffix}`)
} finally {
  // temporary is the exact directory created by mkdtemp above, never caller-supplied.
  await rm(temporary, { recursive: true, force: true })
}

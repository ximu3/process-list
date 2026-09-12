import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { targets } from '../native/targets.js'
import { assertVerification, changedFiles, platformMatrix, requiresFullVerification } from '../scripts/ci.mjs'

test('documentation and templates use light checks, with unknown changes requiring the native matrix', () => {
  assert.equal(requiresFullVerification(['README.md', 'README.zh-CN.md', 'changelog/v0.1.0/en.md']), false)
  assert.equal(
    requiresFullVerification(['.github/ISSUE_TEMPLATE/bug_report.yml', '.github/pull_request_template.md']),
    false,
  )
  for (const path of [
    'src/lib.rs',
    'index.js',
    'index.d.ts',
    'package.json',
    'pnpm-lock.yaml',
    'Cargo.lock',
    '.github/workflows/verify.yml',
    'scripts/ci.mjs',
    'new-file',
  ]) {
    assert.equal(requiresFullVerification(['README.md', path]), true, path)
  }
  assert.equal(requiresFullVerification([]), false)
  assert.equal(requiresFullVerification(null), true)
  assert.equal(requiresFullVerification(['README.md'], true), true)
})

test('change detection includes deleted and renamed paths and preserves filename boundaries', () => {
  const sha = 'a'.repeat(40)
  const calls = []
  const git = (args) => {
    calls.push(args)
    return 'README.md\0src/removed.rs\0file with\nnewline\0'
  }
  const paths = changedFiles('pull_request', { pull_request: { base: { sha } } }, git)
  assert.deepEqual(paths, ['README.md', 'src/removed.rs', 'file with\nnewline'])
  assert.deepEqual(calls[0], ['diff', '--name-only', '--no-renames', '-z', `${sha}...HEAD`])
  changedFiles('push', { before: sha }, git)
  assert.deepEqual(calls[1], ['diff', '--name-only', '--no-renames', '-z', sha, 'HEAD'])
})

test('manual runs, initial pushes, malformed events and missing history all require full validation', () => {
  const unavailable = () => {
    throw new Error('History is unavailable')
  }
  for (const [name, event] of [
    ['workflow_dispatch', {}],
    ['push', { before: '0'.repeat(40) }],
    ['push', { before: '--invalid-revision' }],
    ['pull_request', {}],
    ['push', { before: 'a'.repeat(40) }],
  ]) {
    assert.equal(requiresFullVerification(changedFiles(name, event, unavailable)), true)
  }
})

test('CI has exactly one runner mapping for every published target', () => {
  const matrix = platformMatrix().include
  assert.deepEqual(
    matrix.map((item) => item.target),
    targets.map((item) => item.triple),
  )
  for (const [index, item] of matrix.entries()) {
    assert.equal(typeof item.runner, 'string')
    assert.ok(item.runner.length > 0)
    assert.equal(item.musl, targets[index].libc === 'musl')
  }
})

test('the planner CLI selects light and full checks from actual committed Git changes', async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'process-list-ci-test-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(repo, 'empty-gitconfig') }
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '--quiet', '--template=')
  git('config', 'user.name', 'CI fixture')
  git('config', 'user.email', 'ci@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(join(repo, 'README.md'), 'first version\n')
  git('add', 'README.md')
  git('commit', '--quiet', '-m', 'initial')
  const initial = git('rev-parse', 'HEAD')
  await writeFile(join(repo, 'README.md'), 'documentation change\n')
  git('commit', '--quiet', '-am', 'docs')
  const docs = git('rev-parse', 'HEAD')
  const event = join(repo, 'event.json')
  const output = join(repo, 'output.txt')
  const planner = fileURLToPath(new URL('../scripts/ci.mjs', import.meta.url))
  async function plan(base, force = false) {
    await writeFile(event, JSON.stringify({ before: base }))
    await writeFile(output, '')
    execFileSync(process.execPath, [planner, 'plan'], {
      cwd: repo,
      env: {
        ...env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: event,
        GITHUB_OUTPUT: output,
        FORCE_FULL: String(force),
      },
      encoding: 'utf8',
      windowsHide: true,
    })
    return Object.fromEntries(
      (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => {
          const separator = line.indexOf('=')
          return [line.slice(0, separator), line.slice(separator + 1)]
        }),
    )
  }
  const light = await plan(initial)
  assert.equal(light.full, 'false')
  assert.deepEqual(JSON.parse(light.matrix), platformMatrix())
  assert.equal((await plan(docs, true)).full, 'true')
  await writeFile(join(repo, 'native.rs'), 'pub fn query() {}\n')
  git('add', 'native.rs')
  git('commit', '--quiet', '-m', 'source')
  assert.equal((await plan(docs)).full, 'true')
})

function results(full, result = full ? 'success' : 'skipped') {
  return {
    plan: { result: 'success', outputs: { full: String(full) } },
    quality: { result: 'success' },
    platforms: { result },
  }
}

test('the final check accepts only the successful checks required for the selected scope', () => {
  assert.doesNotThrow(() => assertVerification(results(true)))
  assert.doesNotThrow(() => assertVerification(results(false)))
  for (const status of ['failure', 'cancelled', 'skipped']) {
    assert.throws(() => assertVerification({ ...results(true), plan: { result: status } }))
    assert.throws(() => assertVerification({ ...results(false), quality: { result: status } }))
    assert.throws(() => assertVerification(results(true, status)))
  }
  assert.throws(() => assertVerification({ ...results(false), plan: { result: 'success' } }))
  assert.throws(() => assertVerification(results(false, 'failure')))
  assert.throws(() => assertVerification({}))
})

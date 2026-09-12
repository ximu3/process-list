import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { parse } from 'yaml'

interface Step {
  env?: Record<string, string>
  run?: string
}
const workflow: { jobs: Record<'plan' | 'result', { steps: Step[] }> } = parse(
  await readFile(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8'),
)

function policy(mode: 'plan' | 'result') {
  const command = workflow.jobs[mode].steps.find((step) => step.env?.VERIFICATION_MODE === mode)?.run
  assert.ok(command)
  const match = /^node --input-type=module-typescript <<'TS'\r?\n([\s\S]+)\r?\nTS\s*$/.exec(command)
  assert.ok(match?.[1], 'The workflow must execute its own TypeScript policy')
  return match[1]
}

async function fixture(t: TestContext) {
  const repo = await mkdtemp(join(tmpdir(), 'process-list-ci-test-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(repo, 'empty-gitconfig') }
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '--quiet', '--template=')
  git('config', 'user.name', 'CI fixture')
  git('config', 'user.email', 'ci@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  async function commit(files: Record<string, string | null>) {
    for (const [path, content] of Object.entries(files)) {
      const file = join(repo, path)
      if (content === null) await rm(file)
      else {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, content)
      }
    }
    git('add', '--all')
    git('commit', '--quiet', '-m', 'fixture change')
    return git('rev-parse', 'HEAD')
  }
  const initial = await commit({ 'README.md': 'initial\n' })
  function run(mode: 'plan' | 'result', overrides: NodeJS.ProcessEnv = {}, needs?: unknown) {
    return spawnSync(process.execPath, ['--input-type=module-typescript'], {
      cwd: repo,
      env: {
        ...env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_OUTPUT: join(repo, '.git/output'),
        BASE_SHA: initial,
        FORCE_FULL: 'false',
        VERIFICATION_MODE: mode,
        VERIFICATION_NEEDS: JSON.stringify(needs ?? {}),
        ...overrides,
      },
      input: policy(mode),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    })
  }
  async function plan(overrides: NodeJS.ProcessEnv = {}) {
    await writeFile(join(repo, '.git/output'), '')
    const result = run('plan', overrides)
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    return (await readFile(join(repo, '.git/output'), 'utf8')).trim()
  }
  return { repo, initial, commit, git, run, plan }
}

function results(full: boolean, result = full ? 'success' : 'skipped') {
  return {
    plan: { result: 'success', outputs: { full: String(full) } },
    quality: { result: 'success' },
    platforms: { result },
  }
}

test('documentation and templates use light checks while every other committed path requires the native matrix', async (t) => {
  const f = await fixture(t)
  const docs = await f.commit({
    'README.md': 'updated\n',
    'README.zh-CN.md': '中文\n',
    'changelog/v1.0.0/en.md': 'changes\n',
    '.github/ISSUE_TEMPLATE/bug_report.yml': 'name: bug\n',
    '.github/pull_request_template.md': 'changes\n',
  })
  assert.equal(await f.plan(), 'full=false')
  assert.equal(await f.plan({ GITHUB_EVENT_NAME: 'pull_request' }), 'full=false')
  for (const path of [
    'src/lib.rs',
    'index.ts',
    'native/addon.d.ts',
    'package.json',
    'pnpm-lock.yaml',
    'Cargo.lock',
    '.github/workflows/verify.yml',
    'scripts/check.ts',
    'file with spaces',
  ]) {
    await f.commit({ [path]: 'source\n' })
    assert.equal(await f.plan({ BASE_SHA: docs }), 'full=true', path)
    f.git('reset', '--hard', docs)
  }
})

test('deleting or renaming code into a documentation path still requires native checks', async (t) => {
  const f = await fixture(t)
  const base = await f.commit({ 'source.ts': 'source\n' })
  await f.commit({ 'source.ts': null, 'changelog/source.md': 'source\n' })
  assert.equal(await f.plan({ BASE_SHA: base }), 'full=true')
})

test('pull requests compare against the merge base rather than unrelated new base-branch code', async (t) => {
  const f = await fixture(t)
  const base = await f.commit({ 'unrelated.ts': 'base branch addition\n' })
  f.git('checkout', '--detach', f.initial)
  await f.commit({ 'README.md': 'PR documentation\n' })
  assert.equal(await f.plan({ BASE_SHA: base, GITHUB_EVENT_NAME: 'pull_request' }), 'full=false')
})

test('manual runs, forced verification, malformed events and missing history require complete verification', async (t) => {
  const f = await fixture(t)
  await f.commit({ 'README.md': 'docs\n' })
  for (const overrides of [
    { FORCE_FULL: 'true' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_EVENT_NAME: 'unknown' },
    { BASE_SHA: '' },
    { BASE_SHA: '0'.repeat(40) },
    { BASE_SHA: '--invalid-revision' },
    { BASE_SHA: 'a'.repeat(40) },
  ]) {
    assert.equal(await f.plan(overrides), 'full=true')
  }
  const forced = f.run('result', { FORCE_FULL: 'true' }, results(false))
  assert.notEqual(forced.status, 0)
})

test('checked-out helpers cannot select their own scope and a spoofed planner cannot pass Result', async (t) => {
  const f = await fixture(t)
  await f.commit({
    'src/lib.rs': 'changed native code\n',
    'scripts/ci.ts':
      "import { writeFileSync } from 'node:fs'\nwriteFileSync('helper-ran', 'yes')\nconsole.log('full=false')\n",
  })
  assert.equal(await f.plan(), 'full=true')
  await assert.rejects(readFile(join(f.repo, 'helper-ran')), { code: 'ENOENT' })
  const skipped = f.run('result', {}, results(false))
  assert.notEqual(skipped.status, 0)
  assert.match(skipped.stderr, /Planned scope differs from independently required scope/)
  const completed = f.run('result', {}, results(true))
  assert.equal(completed.status, 0, completed.stderr)
})

test('Result accepts legitimate documentation skips and rejects missing, failed or cancelled checks', async (t) => {
  const f = await fixture(t)
  await f.commit({ 'README.md': 'docs\n' })
  assert.equal(f.run('result', {}, results(false)).status, 0)
  for (const status of ['failure', 'cancelled', 'skipped']) {
    assert.notEqual(f.run('result', {}, { ...results(false), plan: { result: status } }).status, 0)
    assert.notEqual(f.run('result', {}, { ...results(false), quality: { result: status } }).status, 0)
    assert.notEqual(f.run('result', { FORCE_FULL: 'true' }, results(true, status)).status, 0)
  }
  assert.notEqual(f.run('result', {}, results(false, 'failure')).status, 0)
  assert.notEqual(f.run('result', {}, { ...results(false), plan: { result: 'success' } }).status, 0)
  assert.notEqual(f.run('result', {}, {}).status, 0)
})

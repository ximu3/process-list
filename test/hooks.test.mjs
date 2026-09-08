import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { manifest, root, writeJson } from '../scripts/package.mjs'

function environment(repo) {
  return {
    ...process.env,
    CI: '0',
    HUSKY: '1',
    NODE_ENV: 'development',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(repo, '.test-config', 'gitconfig'),
    XDG_CONFIG_HOME: join(repo, '.test-config'),
  }
}

function run(command, args, cwd, env = environment(cwd)) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  if (result.error) throw result.error
  return result
}

function git(repo, args) {
  const result = run('git', args, repo)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

async function fixture(t, install = true) {
  const repo = await mkdtemp(join(tmpdir(), 'process-list-hooks-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  git(repo, ['init', '--quiet', '--template='])
  git(repo, ['config', 'core.autocrlf', 'false'])
  await symlink(
    join(root, 'node_modules'),
    join(repo, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await mkdir(join(repo, '.husky'))
  await mkdir(join(repo, 'scripts'))
  for (const file of [
    '.husky/pre-commit',
    '.husky/pre-push',
    'lint-staged.config.mjs',
    '.prettierignore',
    'scripts/install-hooks.mjs',
    'scripts/uninstall-hooks.mjs',
    'scripts/hooks-state.mjs',
  ]) {
    await copyFile(join(root, file), join(repo, file))
  }
  await writeJson(join(repo, 'package.json'), {
    name: 'process-list-hook-fixture',
    private: true,
    type: 'module',
    packageManager: manifest.packageManager,
    prettier: manifest.prettier,
    devDependencies: { husky: manifest.devDependencies.husky },
    scripts: {
      'check:format': manifest.scripts['check:format'],
      'check:rust-format': manifest.scripts['check:rust-format'],
      verify: 'node verify.mjs',
    },
  })
  await writeFile(join(repo, '.gitignore'), 'node_modules\n/target\n.husky/_/\n')
  await writeFile(
    join(repo, 'Cargo.toml'),
    '[package]\nname = "hook_fixture"\nversion = "0.0.0"\nedition = "2024"\n',
  )
  await mkdir(join(repo, 'src'))
  await writeFile(join(repo, 'src/main.rs'), 'fn main() {}\n')
  await writeFile(join(repo, 'partial.js'), 'const initial = 0\n')
  await writeFile(
    join(repo, 'verify.mjs'),
    "import { writeFileSync } from 'node:fs'\nwriteFileSync('verify-ran', 'yes')\nprocess.exit(Number(process.env.TEST_VERIFY_EXIT ?? 0))\n",
  )
  git(repo, ['add', '.'])
  git(repo, [
    '-c',
    'user.name=Hook fixture',
    '-c',
    'user.email=hook@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ])
  if (install) {
    const result = run(process.execPath, ['scripts/install-hooks.mjs'], repo)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.husky/_')
    assert.match(await readFile(join(repo, '.husky/_/pre-commit'), 'utf8'), /\/h/)
    assert.match(await readFile(join(repo, '.husky/_/pre-push'), 'utf8'), /\/h/)
  }
  return repo
}

test('hooks accept nested, Unicode, spaced, and shell-sensitive filenames', async (t) => {
  const repo = await fixture(t)
  const files = ['nested/路径 with spaces.js', '[literal].js', "quote's.js", '$(echo quoted).js']
  await mkdir(join(repo, 'nested'))
  for (const file of files) await writeFile(join(repo, file), 'const value = 1\n')
  git(repo, ['add', '--', ...files])
  const before = git(repo, ['diff', '--cached', '--binary'])
  const result = run('git', ['hook', 'run', 'pre-commit'], repo)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(git(repo, ['diff', '--cached', '--binary']), before)
  for (const file of files) assert.equal(await readFile(join(repo, file), 'utf8'), 'const value = 1\n')
})

test('invalid staged content is rejected and both versions of a partial file are preserved', async (t) => {
  const repo = await fixture(t)
  const staged = 'const value={a:1}\n'
  const working = 'const value = { a: 1 }\n'
  await writeFile(join(repo, 'partial.js'), staged)
  git(repo, ['add', 'partial.js'])
  await writeFile(join(repo, 'partial.js'), working)
  const stashes = git(repo, ['stash', 'list'])
  const result = run('git', ['hook', 'run', 'pre-commit'], repo)
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /prettier --check/)
  assert.equal(git(repo, ['show', ':partial.js']), staged)
  assert.equal(await readFile(join(repo, 'partial.js'), 'utf8'), working)
  assert.equal(git(repo, ['stash', 'list']), stashes)
})

test('valid staged content passes without including unformatted unstaged edits', async (t) => {
  const repo = await fixture(t)
  const staged = 'const value = { a: 1 }\n'
  const working = 'const value={a:2}\n'
  await writeFile(join(repo, 'partial.js'), staged)
  git(repo, ['add', 'partial.js'])
  await writeFile(join(repo, 'partial.js'), working)
  const stashes = git(repo, ['stash', 'list'])
  const result = run('git', ['hook', 'run', 'pre-commit'], repo)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(git(repo, ['show', ':partial.js']), staged)
  assert.equal(await readFile(join(repo, 'partial.js'), 'utf8'), working)
  assert.equal(git(repo, ['stash', 'list']), stashes)
})

test('Rust changes run the shared crate formatting check', async (t) => {
  const repo = await fixture(t)
  const source = 'fn main(){println!("check");}\n'
  await writeFile(join(repo, 'src/main.rs'), source)
  git(repo, ['add', 'src/main.rs'])
  const result = run('git', ['hook', 'run', 'pre-commit'], repo)
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /cargo fmt --check/)
  assert.equal(await readFile(join(repo, 'src/main.rs'), 'utf8'), source)
  assert.equal(git(repo, ['show', ':src/main.rs']), source)
})

test('pre-push runs pnpm verify and propagates verification failures', async (t) => {
  const repo = await fixture(t)
  let result = run('git', ['hook', 'run', 'pre-push'], repo)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(await readFile(join(repo, 'verify-ran'), 'utf8'), 'yes')
  await writeFile(join(repo, 'verify-ran'), 'not rerun')
  result = run('git', ['hook', 'run', 'pre-push'], repo, { ...environment(repo), TEST_VERIFY_EXIT: '7' })
  assert.notEqual(result.status, 0)
  assert.equal(await readFile(join(repo, 'verify-ran'), 'utf8'), 'yes')
})

test('installation is repeatable and preserves custom hook paths', async (t) => {
  const repo = await fixture(t)
  const hook = join(repo, '.husky/pre-commit')
  const original = (await readFile(hook, 'utf8')) + '\n# preserve tracked hook\n'
  await writeFile(hook, original)
  let result = run(process.execPath, ['scripts/install-hooks.mjs'], repo)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(await readFile(hook, 'utf8'), original)
  git(repo, ['config', 'core.hooksPath', '.custom-hooks'])
  await mkdir(join(repo, '.custom-hooks'))
  await writeFile(join(repo, '.custom-hooks/pre-commit'), '# custom hook\n')
  result = run(process.execPath, ['scripts/install-hooks.mjs'], repo)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /core\.hooksPath preserved/)
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.custom-hooks')
  assert.equal(await readFile(join(repo, '.custom-hooks/pre-commit'), 'utf8'), '# custom hook\n')
})

test('CI and HUSKY=0 skip installation; nested source copies leave parent hooks alone', async (t) => {
  const repo = await fixture(t, false)
  for (const override of [{ CI: 'true' }, { HUSKY: '0' }, { NODE_ENV: 'production' }]) {
    const result = run(process.execPath, ['scripts/install-hooks.mjs'], repo, {
      ...environment(repo),
      ...override,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(run('git', ['config', '--get', 'core.hooksPath'], repo).status, 1)
  }
  const result = run(process.execPath, ['scripts/install-hooks.mjs'], repo)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const before = await readFile(join(repo, '.husky/_/h'), 'utf8')
  const nested = join(repo, 'nested copy')
  await mkdir(join(nested, 'scripts'), { recursive: true })
  await copyFile(join(root, 'scripts/install-hooks.mjs'), join(nested, 'scripts/install-hooks.mjs'))
  await copyFile(join(root, 'scripts/hooks-state.mjs'), join(nested, 'scripts/hooks-state.mjs'))
  const copy = run(process.execPath, ['scripts/install-hooks.mjs'], nested)
  assert.equal(copy.status, 0, copy.stderr || copy.stdout)
  assert.equal(await readFile(join(repo, '.husky/_/h'), 'utf8'), before)
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.husky/_')
})

async function missing(path) {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}

function uninstall(repo, env = environment(repo)) {
  const result = run(process.execPath, ['scripts/uninstall-hooks.mjs'], repo, env)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}

test('uninstall restores default Git hooks and can be repeated before reinstalling', async (t) => {
  const repo = await fixture(t)
  const source = await readFile(join(repo, '.husky/pre-commit'), 'utf8')
  await mkdir(join(repo, '.git/hooks'), { recursive: true })
  const defaultHook = join(repo, '.git/hooks/pre-commit')
  await writeFile(defaultHook, '#!/bin/sh\nnode default-hook.mjs\n')
  await chmod(defaultHook, 0o755)
  await writeFile(
    join(repo, 'default-hook.mjs'),
    "import { writeFileSync } from 'node:fs'\nwriteFileSync('default-hook-ran', 'yes')\n",
  )

  uninstall(repo, { ...environment(repo), HUSKY: '0' })
  assert.equal(run('git', ['config', '--local', '--get', 'core.hooksPath'], repo).status, 1)
  await missing(join(repo, '.husky/_'))
  assert.equal(await readFile(join(repo, '.husky/pre-commit'), 'utf8'), source)
  const fallback = run('git', ['hook', 'run', 'pre-commit'], repo)
  assert.equal(fallback.status, 0, fallback.stderr || fallback.stdout)
  assert.equal(await readFile(join(repo, 'default-hook-ran'), 'utf8'), 'yes')
  uninstall(repo)

  const reinstalled = run(process.execPath, ['scripts/install-hooks.mjs'], repo)
  assert.equal(reinstalled.status, 0, reinstalled.stderr || reinstalled.stdout)
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.husky/_')
  assert.match(await readFile(join(repo, '.husky/_/h'), 'utf8'), /husky/)
  assert.equal(await readFile(defaultHook, 'utf8'), '#!/bin/sh\nnode default-hook.mjs\n')
})

test('uninstall preserves changed files, unknown files, and a replacement hook manager', async (t) => {
  const repo = await fixture(t)
  const changed = join(repo, '.husky/_/pre-commit')
  await writeFile(changed, '# custom generated-file edit\n')
  await writeFile(join(repo, '.husky/_/keep.txt'), 'user file\n')
  git(repo, ['config', 'core.hooksPath', '.custom-hooks'])
  uninstall(repo)
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.custom-hooks')
  assert.equal(await readFile(changed, 'utf8'), '# custom generated-file edit\n')
  assert.equal(await readFile(join(repo, '.husky/_/keep.txt'), 'utf8'), 'user file\n')
  await missing(join(repo, '.husky/_/h'))
  await missing(join(repo, '.husky/_/.process-list-hooks.json'))
})

test('uninstall never changes global or included Git configuration', async (t) => {
  const repo = await fixture(t)
  const globalFile = environment(repo).GIT_CONFIG_GLOBAL
  await mkdir(join(repo, '.test-config'), { recursive: true })
  const globalContent = '[core]\n\thooksPath = global-hooks\n'
  await writeFile(globalFile, globalContent)
  const included = join(repo, '.git/included-config')
  const includedContent = '[core]\n\thooksPath = included-hooks\n'
  await writeFile(included, includedContent)
  git(repo, ['config', '--local', 'include.path', 'included-config'])
  uninstall(repo)
  assert.equal(await readFile(globalFile, 'utf8'), globalContent)
  assert.equal(await readFile(included, 'utf8'), includedContent)
  assert.equal(run('git', ['config', '--local', '--no-includes', '--get', 'core.hooksPath'], repo).status, 1)
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), 'included-hooks')
})

test('prepare cleans up a removed Husky dependency without loading node_modules', async (t) => {
  const repo = await fixture(t)
  const path = join(repo, 'package.json')
  const config = JSON.parse(await readFile(path, 'utf8'))
  delete config.devDependencies.husky
  await writeJson(path, config)
  await unlink(join(repo, 'node_modules'))
  const prepared = run(process.execPath, ['scripts/install-hooks.mjs'], repo)
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout)
  await missing(join(repo, '.husky/_'))
  assert.equal(run('git', ['config', '--local', '--get', 'core.hooksPath'], repo).status, 1)
  uninstall(repo)
})

test('uninstall rejects redirected directories and invalid ownership records before mutation', async (t) => {
  const repo = await fixture(t)
  const record = join(repo, '.husky/_/.process-list-hooks.json')
  const original = await readFile(record, 'utf8')
  await writeFile(join(repo, 'keep.txt'), 'outside generated directory\n')
  await writeJson(record, { version: 1, files: { '../../keep.txt': '0'.repeat(64) } })
  let result = run(process.execPath, ['scripts/uninstall-hooks.mjs'], repo)
  assert.notEqual(result.status, 0)
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.husky/_')
  assert.equal(await readFile(join(repo, 'keep.txt'), 'utf8'), 'outside generated directory\n')
  await writeFile(record, original)
  uninstall(repo)

  const external = join(repo, 'external-hooks')
  await mkdir(external)
  await writeFile(join(external, 'h'), 'do not delete\n')
  await symlink(external, join(repo, '.husky/_'), process.platform === 'win32' ? 'junction' : 'dir')
  git(repo, ['config', 'core.hooksPath', '.husky/_'])
  result = run(process.execPath, ['scripts/uninstall-hooks.mjs'], repo)
  assert.notEqual(result.status, 0)
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.husky/_')
  assert.equal(await readFile(join(external, 'h'), 'utf8'), 'do not delete\n')
})

test('shared Git hook configuration remains until the last active worktree uninstalls', async (t) => {
  const repo = await fixture(t)
  const linked = join(repo, 'linked-checkout')
  git(repo, ['worktree', 'add', '--detach', linked, 'HEAD'])
  await symlink(
    join(root, 'node_modules'),
    join(linked, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const installed = run(process.execPath, ['scripts/install-hooks.mjs'], linked)
  assert.equal(installed.status, 0, installed.stderr || installed.stdout)
  const before = await readFile(join(linked, '.husky/_/h'), 'utf8')
  uninstall(repo)
  await missing(join(repo, '.husky/_'))
  assert.equal(git(repo, ['config', '--local', '--get', 'core.hooksPath']).trim(), '.husky/_')
  assert.equal(await readFile(join(linked, '.husky/_/h'), 'utf8'), before)
  uninstall(linked)
  await missing(join(linked, '.husky/_'))
  assert.equal(run('git', ['config', '--local', '--get', 'core.hooksPath'], repo).status, 1)
})

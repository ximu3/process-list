import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../', import.meta.url))
const generated = resolve(root, '.husky/_')
const record = resolve(generated, '.process-list-hooks.json')
const configuredPath = '.husky/_'
// Files written by the pinned Husky 9 generator. Other files in _ are never adopted.
const managedNames = new Set([
  '.gitignore',
  'h',
  'husky.sh',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-rebase',
  'post-rewrite',
  'post-checkout',
  'post-merge',
  'pre-push',
  'pre-auto-gc',
])

/** @param {string[]} args @param {number[]} [accepted] */
export function git(args, accepted = [0]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (!accepted.includes(result.status ?? -1)) throw new Error(result.stderr || `git ${args[0]} failed`)
  return result.stdout
}

/** @param {string} path */
async function info(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null
    throw error
  }
}

/** @param {string} path */
export function normalize(path) {
  const absolute = resolve(root, path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

export async function isCheckout() {
  if (!(await info(resolve(root, '.git')))) return false
  return normalize(git(['rev-parse', '--show-toplevel']).trim()) === normalize(root)
}

async function checkDirectory() {
  const base = await realpath(root)
  for (const path of [resolve(root, '.husky'), generated]) {
    const entry = await info(path)
    if (!entry) continue
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error(`Refusing to manage a redirected hook directory: ${path}`)
    const inside = relative(base, await realpath(path))
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('../') || inside.startsWith('..\\')) {
      throw new Error(`Hook directory escapes the checkout: ${path}`)
    }
  }
}

/** @param {string} path */
async function digest(path) {
  const entry = await info(path)
  if (!entry?.isFile() || entry.isSymbolicLink()) return null
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

/** Capture only the generator's known files, so cleanup works even after node_modules is removed. */
export async function recordInstallation() {
  const recordInfo = await info(record)
  if (recordInfo && (!recordInfo.isFile() || recordInfo.isSymbolicLink()))
    throw new Error('Hook installation record is not a regular file')
  /** @type {Record<string, string>} */
  const files = {}
  for (const name of managedNames) {
    const hash = await digest(resolve(generated, name))
    if (hash) files[name] = hash
  }
  await writeFile(record, `${JSON.stringify({ version: 1, files }, null, 2)}\n`)
}

export async function prepareInstallation() {
  await checkDirectory()
}

async function anotherCheckoutUsesHooks() {
  const paths = git(['worktree', 'list', '--porcelain', '-z'])
    .split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => field.slice(9))
  for (const path of paths) {
    if (normalize(path) === normalize(root)) continue
    if (await info(resolve(path, configuredPath, 'h'))) return true
  }
  return false
}

/** Remove this checkout's installation, preserving unrelated config and changed files. */
export async function uninstallHooks() {
  if (!(await isCheckout())) return
  await checkDirectory()
  /** @type {Record<string, string>} */
  let files = {}
  const recordInfo = await info(record)
  if (recordInfo) {
    if (!recordInfo.isFile() || recordInfo.isSymbolicLink())
      throw new Error('Hook installation record is not a regular file')
    const saved = JSON.parse(await readFile(record, 'utf8'))
    if (
      saved.version !== 1 ||
      !saved.files ||
      typeof saved.files !== 'object' ||
      Array.isArray(saved.files)
    ) {
      throw new Error('Invalid hook installation record')
    }
    for (const [name, hash] of Object.entries(saved.files)) {
      if (!managedNames.has(name) || typeof hash !== 'string' || !/^[a-f\d]{64}$/.test(hash)) {
        throw new Error('Invalid file in hook installation record')
      }
    }
    files = saved.files
  }

  // Read only the actual local file, never included/global/worktree config files.
  const localValues = git(
    ['config', '--local', '--no-includes', '--null', '--get-all', 'core.hooksPath'],
    [0, 1],
  )
    .split('\0')
    .filter(Boolean)
  const owned = localValues.filter((value) => value === configuredPath)
  const shared = owned.length > 0 && (await anotherCheckoutUsesHooks())
  if (!shared) {
    for (const value of new Set(owned)) {
      git(['config', '--local', '--fixed-value', '--unset-all', 'core.hooksPath', value], [0, 5])
    }
  }

  const preserved = []
  for (const [name, expected] of Object.entries(files)) {
    const path = resolve(generated, name)
    const current = await digest(path)
    if (current === expected) await unlink(path)
    else if (await info(path)) preserved.push(name)
  }
  if (recordInfo) await unlink(record)
  try {
    await rmdir(generated)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(/** @type {NodeJS.ErrnoException} */ (error).code ?? ''))
      throw error
  }
  console.log(
    shared
      ? 'Local hook files removed; shared hooksPath retained for another checkout.'
      : 'Local hook installation removed; other Git configuration preserved.',
  )
  if (!recordInfo && (await info(generated))) console.log('Unrecorded hook files preserved.')
  if (preserved.length) console.log(`Modified hook files preserved: ${preserved.join(', ')}`)
}

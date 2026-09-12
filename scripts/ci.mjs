import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { targets } from '../native/targets.js'
import { validateProject } from './package.mjs'

/** Runner selection is CI policy; the published target list remains the source of platform coverage. */
const runners = /** @type {Record<string, string>} */ ({
  'win32-x64-msvc': 'windows-2022',
  'win32-arm64-msvc': 'windows-11-arm',
  'darwin-x64': 'macos-15-intel',
  'darwin-arm64': 'macos-15',
  'linux-x64-gnu': 'ubuntu-22.04',
  'linux-arm64-gnu': 'ubuntu-22.04-arm',
  'linux-x64-musl': 'ubuntu-24.04',
  'linux-arm64-musl': 'ubuntu-24.04-arm',
})

export function platformMatrix() {
  assert.deepEqual(Object.keys(runners).sort(), targets.map((target) => target.suffix).sort())
  return {
    include: targets.map((target) => ({
      target: target.triple,
      runner: runners[target.suffix],
      musl: target.libc === 'musl',
    })),
  }
}

/** @param {string} path */
export function isDocumentation(path) {
  return (
    ['README.md', 'README.zh-CN.md', 'LICENSE'].includes(path) ||
    /^changelog\/.+\.md$/.test(path) ||
    /^\.github\/ISSUE_TEMPLATE\/[^/]+\.ya?ml$/.test(path) ||
    path === '.github/pull_request_template.md'
  )
}

/** @param {readonly string[] | null} files @param {boolean} [forceFull] */
export function requiresFullVerification(files, forceFull = false) {
  return forceFull || files === null || files.some((path) => !isDocumentation(path))
}

/**
 * @typedef {{ before?: string, pull_request?: { base?: { sha?: string } } }} Event
 * @param {string} eventName
 * @param {Event} event
 * @param {(args: string[]) => string} [git]
 * @returns {string[] | null}
 */
export function changedFiles(eventName, event, git = runGit) {
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before
  if (!['push', 'pull_request'].includes(eventName) || !base || !/^[a-f0-9]{40}$/.test(base)) return null
  if (/^0+$/.test(base)) return null
  const revisions = eventName === 'pull_request' ? [`${base}...HEAD`] : [base, 'HEAD']
  try {
    // Include both sides of renames and preserve filenames containing whitespace/newlines.
    return git(['diff', '--name-only', '--no-renames', '-z', ...revisions])
      .split('\0')
      .filter(Boolean)
  } catch {
    // Missing history must expand validation rather than silently skipping native checks.
    return null
  }
}

/** @param {string[]} args */
function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
}

/** @param {Record<string, { result?: string, outputs?: Record<string, string> }>} needs */
export function assertVerification(needs) {
  assert.equal(needs.plan?.result, 'success', 'Verification planning did not succeed')
  assert.equal(needs.quality?.result, 'success', 'Quality checks did not succeed')
  const full = needs.plan.outputs?.full
  assert.ok(full === 'true' || full === 'false', 'Missing verification scope')
  assert.equal(
    needs.platforms?.result,
    full === 'true' ? 'success' : 'skipped',
    'Platform verification did not complete as planned',
  )
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  switch (process.argv[2]) {
    case 'plan': {
      await validateProject()
      const event = process.env.GITHUB_EVENT_PATH
        ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
        : {}
      const full = requiresFullVerification(
        changedFiles(process.env.GITHUB_EVENT_NAME ?? '', event),
        process.env.FORCE_FULL === 'true',
      )
      const outputs = `full=${full}\nmatrix=${JSON.stringify(platformMatrix())}\n`
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, outputs)
      console.log(full ? 'Full platform verification' : 'Documentation and template verification')
      break
    }
    case 'result':
      assertVerification(JSON.parse(process.env.VERIFICATION_NEEDS ?? '{}'))
      console.log('All required checks passed')
      break
    default:
      throw new Error('Usage: node scripts/ci.mjs <plan|result>')
  }
}

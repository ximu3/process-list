import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  git,
  isCheckout,
  normalize,
  prepareInstallation,
  recordInstallation,
  root,
  uninstallHooks,
} from './hooks-state.mjs'

const ci = process.env.CI && !['0', 'false'].includes(process.env.CI)
if (ci || !(await isCheckout())) process.exit(0)

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (!manifest.devDependencies?.husky && !manifest.dependencies?.husky) {
  // Package removal can invoke prepare after the module is gone; cleanup needs only Node and Git.
  await uninstallHooks()
  process.exit(0)
}
if (process.env.NODE_ENV === 'production' || process.env.HUSKY === '0') process.exit(0)

const value = git(['config', '--null', '--get', 'core.hooksPath'], [0, 1])
const configured = value ? value.slice(0, -1) : null
if (configured !== null && normalize(configured) !== normalize('.husky/_')) {
  console.log('Existing core.hooksPath preserved; automatic hook installation skipped.')
  process.exit(0)
}

await prepareInstallation()
process.chdir(root)
const { default: install } = await import('husky')
const error = install()
if (error) throw new Error(error)
await recordInstallation()

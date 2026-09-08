import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { currentTarget } from './targets.js'

const require = createRequire(import.meta.url)
const { name, version } = require('../package.json')
const target = currentTarget()
const packageName = `${name}-${target.suffix}`
const localBinary = new URL(`./process-list.${target.suffix}.node`, import.meta.url)

/** @returns {typeof import('./binding.d.ts')} */
function load() {
  try {
    if (existsSync(localBinary)) return require(fileURLToPath(localBinary))
    const installed = require(`${packageName}/package.json`)
    if (installed.version !== version) {
      throw new Error(`Native package version ${installed.version} does not match ${version}`)
    }
    return require(packageName)
  } catch (cause) {
    throw Object.assign(
      new Error(
        `Cannot load ${packageName}@${version}. Install optional dependencies, or run pnpm build when working from source.`,
        { cause },
      ),
      { code: 'ERR_NATIVE_LOAD_FAILED' },
    )
  }
}

const binding = load()
export const listProcesses = binding.listProcesses
export const listProcessesSync = binding.listProcessesSync
export const getProcess = binding.getProcess
export const getProcessSync = binding.getProcessSync
export const getForeground = binding.getForeground
export const getForegroundSync = binding.getForegroundSync

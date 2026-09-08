import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

function npmCli() {
  const nodeDirectory = dirname(realpathSync(process.execPath))
  const candidates = [
    process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : '',
    join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    join(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ]
  const cli = candidates.find((path) => path && basename(path) === 'npm-cli.js' && existsSync(path))
  if (!cli) throw new Error('npm CLI not found beside Node.js. Run this script with npm run.')
  return cli
}

/** @param {string[]} args @param {string} cwd */
export function npm(args, cwd) {
  const result = spawnSync(process.execPath, [npmCli(), ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed: ${result.stderr}\n${result.stdout}`)
  return result.stdout
}

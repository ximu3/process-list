import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { manifest, root } from './package.mjs'

if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(manifest.version))
  throw new Error('Invalid package.json version')
const path = join(root, 'Cargo.toml')
const cargo = await readFile(path, 'utf8')
await writeFile(
  path,
  cargo.replace(/(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m, `$1"${manifest.version}"`),
)
console.log(`Synchronized Cargo.toml to ${manifest.version}; run cargo check to update Cargo.lock`)

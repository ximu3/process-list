import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { manifest, requireFile, root, validateProject } from './package.mjs'

await validateProject()
const tag = process.env.RELEASE_TAG
assert.match(
  manifest.version,
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z]+(?:[.-][\da-zA-Z]+)*)?$/,
)
assert.equal(tag, `v${manifest.version}`, 'Release tag must match the package version')
await requireFile(join(root, 'changelog', tag, 'en.md'))
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const outputs = {
  tag,
  sha,
  version: manifest.version,
  prerelease: String(manifest.version.includes('-')),
  dist_tag: manifest.version.includes('-') ? 'next' : 'latest',
}
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  )
}
console.log(`Validated ${tag} at ${sha}`)

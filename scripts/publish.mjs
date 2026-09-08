import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { targets } from '../native/targets.js'
import { npm } from './npm.mjs'
import { manifest, requireFile, root, validateProject } from './package.mjs'

await validateProject()
const tag = process.env.NPM_DIST_TAG
if (tag !== 'latest' && tag !== 'next') throw new Error('NPM_DIST_TAG must be latest or next')
const directories = [...targets.map((target) => target.suffix), 'main']
// Reject a stale or incomplete staging directory before the first network mutation.
for (const directory of directories) {
  const path = join(root, 'npm', directory)
  const staged = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
  assert.equal(staged.version, manifest.version)
  assert.equal(staged.name, directory === 'main' ? manifest.name : `${manifest.name}-${directory}`)
  assert.notEqual(staged.private, true)
  await requireFile(join(path, staged.main))
}
// Publish the complete dependency set before making the main package installable.
for (const directory of directories) {
  console.log(
    npm(['publish', '--access', 'public', '--provenance', '--tag', tag], join(root, 'npm', directory)),
  )
}

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { targets } from '../native/targets.ts'
import { npm } from './npm.ts'
import { manifest, requireFile, root, validateProject } from './package.ts'
import { packArtifact, publishArtifacts, readPublishedPackage } from './publication.ts'

await validateProject()
const tag = process.env.NPM_DIST_TAG
if (tag !== 'latest' && tag !== 'next') throw new Error('NPM_DIST_TAG must be latest or next')
const arguments_ = process.argv.slice(2)
if (arguments_.some((argument) => argument !== '--dry-run'))
  throw new Error('Usage: node scripts/publish.ts [--dry-run]')
const registry = manifest.publishConfig.registry
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
const temporary = await mkdtemp(join(tmpdir(), 'process-list-publish-'))
try {
  const artifacts = []
  for (const directory of directories) {
    const artifact = await packArtifact(join(root, 'npm', directory), temporary)
    assert.equal(artifact.version, manifest.version)
    assert.equal(artifact.name, directory === 'main' ? manifest.name : `${manifest.name}-${directory}`)
    artifacts.push(artifact)
  }
  await publishArtifacts(artifacts, {
    dryRun: arguments_.includes('--dry-run'),
    lookup: (artifact) => readPublishedPackage(artifact, registry),
    publish: async (artifact) => {
      // Publish the verified tarball, so npm cannot re-pack different content between checks.
      npm(
        [
          'publish',
          artifact.tarball,
          '--registry',
          registry,
          '--access',
          'public',
          '--provenance',
          '--tag',
          tag,
        ],
        root,
      )
    },
  })
} finally {
  // This is the exact temporary directory created above, never a caller-supplied path.
  await rm(temporary, { recursive: true, force: true })
}

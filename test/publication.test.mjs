import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { packArtifact, publishArtifacts, readPublishedPackage } from '../scripts/publication.mjs'

const artifacts = ['native-a', 'native-b', 'main'].map((name) => ({
  name: `@test/${name}`,
  version: '1.0.0',
  tarball: `${name}.tgz`,
  integrity: `sha512-${name}`,
}))
const quiet = { log() {}, retryDelays: [0] }

test('publication resumes after an interruption without republishing verified packages', async () => {
  const registry = new Map()
  const attempts = []
  let interrupted = false
  const options = {
    ...quiet,
    lookup: async (artifact) => registry.get(artifact.name) ?? null,
    publish: async (artifact) => {
      attempts.push(artifact.name)
      if (artifact.name === '@test/native-b' && !interrupted) {
        interrupted = true
        throw new Error('Connection failed before upload')
      }
      registry.set(artifact.name, { integrity: artifact.integrity })
    },
  }
  await assert.rejects(publishArtifacts(artifacts, options), /could not be verified/)
  assert.equal(registry.has('@test/main'), false)
  await publishArtifacts(artifacts, options)
  assert.deepEqual(attempts, ['@test/native-a', '@test/native-b', '@test/native-b', '@test/main'])
  await publishArtifacts(artifacts, options)
  assert.equal(attempts.length, 4)
})

test('a conflicting existing version aborts the complete plan before the first upload', async () => {
  let uploads = 0
  await assert.rejects(
    publishArtifacts(artifacts, {
      ...quiet,
      lookup: async (artifact) => (artifact.name === '@test/main' ? { integrity: 'sha512-different' } : null),
      publish: async () => {
        uploads++
      },
    }),
    /already exists with different content/,
  )
  assert.equal(uploads, 0)
})

test('lost upload responses are accepted only after registry integrity matches', async () => {
  const registry = new Map()
  const uploads = []
  await publishArtifacts(artifacts, {
    ...quiet,
    lookup: async (artifact) => registry.get(artifact.name) ?? null,
    publish: async (artifact) => {
      uploads.push(artifact.name)
      registry.set(artifact.name, { integrity: artifact.integrity })
      throw new Error('Response was lost after a successful upload')
    },
  })
  assert.deepEqual(
    uploads,
    artifacts.map((artifact) => artifact.name),
  )
})

test('verification tolerates bounded registry propagation without publishing the next package early', async () => {
  let uploaded = false
  let reads = 0
  const delays = []
  await publishArtifacts([artifacts[0]], {
    ...quiet,
    retryDelays: [0, 250, 1000],
    wait: async (value) => {
      delays.push(value)
    },
    lookup: async () => {
      if (!uploaded || ++reads < 3) return null
      return { integrity: artifacts[0].integrity }
    },
    publish: async () => {
      uploaded = true
    },
  })
  assert.deepEqual(delays, [250, 1000])
})

test('content conflicts after upload stop publication before the main package', async () => {
  let uploaded = false
  const uploads = []
  await assert.rejects(
    publishArtifacts(artifacts, {
      ...quiet,
      lookup: async () => (uploaded ? { integrity: 'sha512-unexpected' } : null),
      publish: async (artifact) => {
        uploads.push(artifact.name)
        uploaded = true
      },
    }),
    /different content/,
  )
  assert.deepEqual(uploads, ['@test/native-a'])
})

test('dry runs verify existing versions without publishing missing ones', async () => {
  let uploads = 0
  const messages = []
  await publishArtifacts(artifacts, {
    ...quiet,
    dryRun: true,
    log: (message) => messages.push(message),
    lookup: async (artifact) =>
      artifact.name === '@test/native-a' ? { integrity: artifact.integrity } : null,
    publish: async () => {
      uploads++
    },
  })
  assert.equal(uploads, 0)
  assert.equal(messages.filter((message) => message.startsWith('Would publish')).length, 2)
})

test('registry failures abort preflight and cannot be mistaken for absent packages', async () => {
  let uploads = 0
  await assert.rejects(
    publishArtifacts(artifacts, {
      ...quiet,
      lookup: async () => {
        throw new Error('HTTP 503')
      },
      publish: async () => {
        uploads++
      },
    }),
    /HTTP 503/,
  )
  assert.equal(uploads, 0)
})

test('registry lookup distinguishes missing versions, failures and mismatched metadata', async () => {
  const artifact = artifacts[0]
  const registry = 'https://registry.example.test/'
  assert.equal(
    await readPublishedPackage(artifact, registry, async () => new Response('', { status: 404 })),
    null,
  )
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      readPublishedPackage(artifact, registry, async () => new Response('', { status })),
      /Registry lookup failed/,
    )
  }
  const metadata = { name: artifact.name, version: artifact.version, dist: { integrity: artifact.integrity } }
  const response = (value) => async () => Response.json(value)
  assert.deepEqual(await readPublishedPackage(artifact, registry, response(metadata)), {
    integrity: artifact.integrity,
  })
  for (const value of [
    { ...metadata, name: '@test/other' },
    { ...metadata, version: '2.0.0' },
    { ...metadata, dist: {} },
    null,
  ]) {
    await assert.rejects(readPublishedPackage(artifact, registry, response(value)))
  }
  await readPublishedPackage(artifact, registry, async (url) => {
    assert.equal(url.href, 'https://registry.example.test/%40test%2Fnative-a/1.0.0')
    return Response.json(metadata)
  })
})

test('packed integrity is derived from the actual npm tarball and changes with package contents', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'process-list-publication-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const source = join(temporary, 'source')
  await mkdir(source)
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({ name: '@test/publication', version: '1.0.0', files: ['value.txt'] }),
  )
  await writeFile(join(source, 'value.txt'), 'first contents')
  const first = await packArtifact(source, temporary)
  const hash = createHash('sha512')
    .update(await readFile(first.tarball))
    .digest('base64')
  assert.equal(first.integrity, `sha512-${hash}`)
  assert.equal((await packArtifact(source, temporary)).integrity, first.integrity)
  await writeFile(join(source, 'value.txt'), 'changed contents')
  const second = await packArtifact(source, temporary)
  assert.notEqual(second.integrity, first.integrity)
  assert.equal(second.name, '@test/publication')
  assert.equal(second.version, '1.0.0')
})

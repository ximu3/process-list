import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { npm } from './npm.ts'

export interface Artifact {
  name: string
  version: string
  tarball: string
  integrity: string
}

export interface PublishedPackage {
  integrity: string
}

export interface PublicationOptions {
  lookup: (artifact: Artifact) => Promise<PublishedPackage | null>
  publish: (artifact: Artifact) => Promise<void>
  dryRun?: boolean
  log?: (message: string) => void
  retryDelays?: readonly number[]
  wait?: (milliseconds: number) => Promise<unknown>
}

export async function packArtifact(directory: string, destination: string): Promise<Artifact> {
  const [packed] = JSON.parse(
    npm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination], directory),
  )
  assert.equal(typeof packed?.filename, 'string', 'npm pack did not return a tarball')
  assert.equal(basename(packed.filename), packed.filename, 'Unexpected tarball path')
  const tarball = join(destination, packed.filename)
  const integrity = `sha512-${createHash('sha512')
    .update(await readFile(tarball))
    .digest('base64')}`
  assert.equal(integrity, packed.integrity, 'Packed tarball does not match its reported integrity')
  return { name: packed.name, version: packed.version, tarball, integrity }
}

export async function readPublishedPackage(
  artifact: Artifact,
  registry: string,
  request: typeof fetch = fetch,
): Promise<PublishedPackage | null> {
  const url = new URL(
    `${encodeURIComponent(artifact.name)}/${encodeURIComponent(artifact.version)}`,
    registry.endsWith('/') ? registry : `${registry}/`,
  )
  const response = await request(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Registry lookup failed for ${artifact.name}: HTTP ${response.status}`)
  const metadata = await response.json()
  assert.equal(metadata?.name, artifact.name, 'Registry returned a different package name')
  assert.equal(metadata?.version, artifact.version, 'Registry returned a different package version')
  assert.equal(typeof metadata?.dist?.integrity, 'string', 'Registry did not provide package integrity')
  return { integrity: metadata.dist.integrity }
}

function assertSameContent(artifact: Artifact, published: PublishedPackage) {
  if (published.integrity !== artifact.integrity) {
    throw new Error(
      `${artifact.name}@${artifact.version} already exists with different content. Reuse the original build artifacts or choose a new version.`,
    )
  }
}

export async function publishArtifacts(artifacts: readonly Artifact[], options: PublicationOptions) {
  const {
    lookup,
    publish,
    dryRun = false,
    log = console.log,
    retryDelays = [0, 250, 1000, 2000],
    wait = delay,
  } = options
  const existing = []
  for (const artifact of artifacts) {
    const published = await lookup(artifact)
    if (published) assertSameContent(artifact, published)
    existing.push(published)
  }
  for (const [index, artifact] of artifacts.entries()) {
    const id = `${artifact.name}@${artifact.version}`
    if (existing[index]) {
      log(`Verified existing ${id}; publication skipped`)
      continue
    }
    if (dryRun) {
      log(`Would publish ${id}`)
      continue
    }
    let publishError
    try {
      await publish(artifact)
    } catch (error) {
      // An upload may succeed even when the client loses the response. Verify before deciding.
      publishError = error
    }
    let verified = false
    let lookupError
    for (const milliseconds of retryDelays) {
      if (milliseconds > 0) await wait(milliseconds)
      let published
      try {
        published = await lookup(artifact)
      } catch (error) {
        lookupError = error
        continue
      }
      if (!published) continue
      assertSameContent(artifact, published)
      verified = true
      break
    }
    if (!verified) {
      throw new Error(`Publication of ${id} could not be verified. Retry with the same build artifacts.`, {
        cause: publishError ?? lookupError,
      })
    }
    log(`Verified published ${id}`)
  }
}

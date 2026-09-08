import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { targets } from '../native/targets.js'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
export const binaryName = 'process-list'

export async function validateProject() {
  assert.deepEqual(
    manifest.napi.targets,
    targets.map((target) => target.triple),
    'Native target matrix must match package.json',
  )
  assert.equal(manifest.napi.binaryName, binaryName)
  const cargo = await readFile(join(root, 'Cargo.toml'), 'utf8')
  const packageSection = cargo.split('[package]')[1]?.split(/\r?\n\[/)[0]
  const version = /^version\s*=\s*"([^"]+)"/m.exec(packageSection ?? '')?.[1]
  assert.equal(version, manifest.version, 'Rust and npm versions must agree')
}

/** @param {string} path */
export async function requireFile(path) {
  const info = await stat(path)
  assert.ok(info.isFile() && info.size > 0, `Missing or empty artifact: ${path}`)
}

/** @param {string} path @param {unknown} value */
export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** @param {string} directory */
export async function stageMain(directory) {
  await mkdir(join(directory, 'native'), { recursive: true })
  for (const file of ['README.md', 'LICENSE', ...manifest.files]) {
    await copyFile(join(root, file), join(directory, file))
  }
  const developmentKeys = new Set([
    'private',
    'devDependencies',
    'scripts',
    'packageManager',
    'napi',
    'prettier',
  ])
  const published = Object.fromEntries(Object.entries(manifest).filter(([key]) => !developmentKeys.has(key)))
  await writeJson(join(directory, 'package.json'), {
    ...published,
    optionalDependencies: Object.fromEntries(
      targets.map((target) => [`${manifest.name}-${target.suffix}`, manifest.version]),
    ),
  })
}

/** @param {string} directory @param {(typeof targets)[number]} target @param {string} source */
export async function stagePlatform(directory, target, source) {
  await requireFile(source)
  await mkdir(directory, { recursive: true })
  const filename = `${binaryName}.${target.suffix}.node`
  await copyFile(source, join(directory, filename))
  await copyFile(join(root, 'LICENSE'), join(directory, 'LICENSE'))
  await writeFile(
    join(directory, 'README.md'),
    `# ${manifest.name}-${target.suffix}\n\nNative binding for [${manifest.name}](https://www.npmjs.com/package/${manifest.name}). Install the main package to select the correct binary automatically.\n`,
  )
  await writeJson(join(directory, 'package.json'), {
    name: `${manifest.name}-${target.suffix}`,
    version: manifest.version,
    description: `${manifest.description} (${target.suffix})`,
    main: filename,
    files: [filename],
    os: [target.os],
    cpu: [target.cpu],
    ...(target.libc ? { libc: [target.libc] } : {}),
    engines: manifest.engines,
    license: manifest.license,
    repository: manifest.repository,
    publishConfig: manifest.publishConfig,
  })
}

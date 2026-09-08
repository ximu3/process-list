import { join, resolve } from 'node:path'
import { targets } from '../native/targets.js'
import { binaryName, requireFile, root, stageMain, stagePlatform, validateProject } from './package.mjs'

await validateProject()
const source = resolve(process.argv[2] ?? join(root, 'artifacts'))
// Validate the complete matrix before preparing any publishable package.
await Promise.all(targets.map((target) => requireFile(join(source, `${binaryName}.${target.suffix}.node`))))
for (const target of targets) {
  await stagePlatform(
    join(root, 'npm', target.suffix),
    target,
    join(source, `${binaryName}.${target.suffix}.node`),
  )
}
await stageMain(join(root, 'npm', 'main'))
console.log(`Prepared ${targets.length} native packages and the main package in npm/`)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { root } from './package.ts'

const readmes = ['README.md', 'README.zh-CN.md']
const sources = await Promise.all(readmes.map((file) => readFile(join(root, file), 'utf8')))
const blocks = sources.map((source) =>
  [...source.matchAll(/```(\w+)\r?\n([\s\S]*?)```/g)].map((match) => [
    match[1],
    match[2]?.replaceAll('\r\n', '\n'),
  ]),
)
assert.deepEqual(blocks[0], blocks[1], 'English and Chinese README examples must agree')
for (const [language, source] of blocks[0] ?? []) {
  if (language !== 'js') continue
  const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: source,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
}

const files = [...readmes, 'changelog/README.md']
for (const entry of await readdir(join(root, 'changelog'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  for (const file of await readdir(join(root, 'changelog', entry.name))) {
    if (file.endsWith('.md')) files.push(`changelog/${entry.name}/${file}`)
  }
}
for (const file of files) {
  const source = await readFile(join(root, file), 'utf8')
  for (const [, target] of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (!target || /^[a-z]+:|^#/i.test(target)) continue
    await access(resolve(root, dirname(file), decodeURIComponent(target.split('#')[0] ?? '')))
  }
}
console.log('Documentation links and bilingual code examples verified')

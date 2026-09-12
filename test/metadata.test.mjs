import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { manifest, root } from '../scripts/package.mjs'

const yaml = async (path) => parse(await readFile(join(root, path), 'utf8'))

test('each target owns its build-to-runtime dependency and publishing always requests full verification', async () => {
  const target = await yaml('.github/workflows/verify-target.yml')
  const verify = await yaml('.github/workflows/verify.yml')
  const publish = await yaml('.github/workflows/publish.yml')
  assert.equal(target.jobs.runtime.needs, 'build')
  assert.equal(target.jobs.build['runs-on'], target.jobs.runtime['runs-on'])
  assert.equal(target.jobs.runtime.strategy.matrix.node[0], manifest.engines.node.replace('>=', ''))
  assert.equal(verify.jobs.platforms.strategy['fail-fast'], false)
  assert.equal(verify.jobs.result.if, 'always()')
  assert.deepEqual(verify.jobs.result.needs, ['plan', 'quality', 'platforms'])
  assert.equal(publish.jobs.verify.with.full, true)
})

test('issue forms have valid unique field identifiers and keep the free-form issue entry available', async () => {
  const directory = '.github/ISSUE_TEMPLATE'
  for (const file of await readdir(join(root, directory))) {
    if (!file.endsWith('.yml') || file === 'config.yml') continue
    const form = await yaml(`${directory}/${file}`)
    assert.ok(typeof form.name === 'string' && form.name.length > 0, file)
    assert.ok(typeof form.description === 'string' && form.description.length > 0, file)
    assert.ok(Array.isArray(form.body) && form.body.length > 0, file)
    const ids = new Set()
    for (const field of form.body) {
      assert.ok(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'].includes(field.type), file)
      if (field.type === 'markdown') continue
      assert.match(field.id, /^[a-zA-Z0-9_-]+$/)
      assert.ok(!ids.has(field.id), `${file}: duplicate ${field.id}`)
      ids.add(field.id)
      assert.ok(typeof field.attributes?.label === 'string' && field.attributes.label.length > 0, file)
      if (field.validations?.required !== undefined)
        assert.equal(typeof field.validations.required, 'boolean')
    }
  }
  assert.equal((await yaml(`${directory}/config.yml`)).blank_issues_enabled, true)
})

import assert from 'node:assert/strict'

assert.ok(process.send)
process.send('ready')
process.on('message', () => process.exit(0))

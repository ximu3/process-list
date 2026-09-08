process.send('ready')
process.on('message', () => process.exit(0))

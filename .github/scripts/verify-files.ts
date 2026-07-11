import { stat } from 'node:fs/promises'

async function isNonEmptyFile(file: string) {
  try {
    const fileStat = await stat(file)
    return fileStat.isFile() && fileStat.size > 0
  } catch {
    return false
  }
}

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    throw new Error('At least one file path is required')
  }

  const checks = await Promise.all(files.map(async (file) => ({ file, valid: await isNonEmptyFile(file) })))
  const missing = checks.filter(({ valid }) => !valid).map(({ file }) => file)

  if (missing.length > 0) {
    throw new Error(`Missing or empty files: ${missing.join(', ')}`)
  }

  console.log(`Verified files: ${files.join(', ')}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

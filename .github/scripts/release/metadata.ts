import { appendFile, readFile, stat } from 'node:fs/promises'

const tagPattern = /^v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

async function setOutput(name: string, value: string | boolean) {
  const outputFile = requiredEnv('GITHUB_OUTPUT')
  await appendFile(outputFile, `${name}=${String(value)}\n`, 'utf8')
}

function readCargoPackageVersion(cargoToml: string) {
  let inPackageSection = false

  for (const line of cargoToml.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '[package]') {
      inPackageSection = true
      continue
    }
    if (inPackageSection && trimmed.startsWith('[')) {
      break
    }
    if (inPackageSection) {
      const match = /^version\s*=\s*"([^"]+)"$/u.exec(trimmed)
      if (match) {
        return match[1]
      }
    }
  }

  throw new Error('Unable to read the package version from Cargo.toml')
}

async function isNonEmptyFile(file: string) {
  try {
    const fileStat = await stat(file)
    return fileStat.isFile() && fileStat.size > 0
  } catch {
    return false
  }
}

async function main() {
  const tag = requiredEnv('RELEASE_TAG')
  const tagMatch = tagPattern.exec(tag)
  if (!tagMatch) {
    throw new Error(`Release tag must match vX.Y.Z or vX.Y.Z-prerelease: ${tag}`)
  }

  const version = tagMatch[1]
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { name?: string; version?: string }
  const cargoVersion = readCargoPackageVersion(await readFile('Cargo.toml', 'utf8'))
  const changelogFile = `changelog/v${version}/en.md`

  if (!packageJson.name || !packageJson.version) {
    throw new Error('package.json must contain name and version fields')
  }
  if (packageJson.version !== version) {
    throw new Error(`package.json version is ${packageJson.version}, but tag is ${tag}`)
  }
  if (cargoVersion !== version) {
    throw new Error(`Cargo.toml version is ${cargoVersion}, but tag is ${tag}`)
  }
  if (!(await isNonEmptyFile(changelogFile))) {
    throw new Error(`Missing or empty changelog: ${changelogFile}`)
  }

  const isPrerelease = version.includes('-')
  await setOutput('tag', tag)
  await setOutput('version', version)
  await setOutput('package_name', packageJson.name)
  await setOutput('release_name', `${packageJson.name} v${version}`)
  await setOutput('is_prerelease', isPrerelease)
  await setOutput('make_latest', !isPrerelease)

  console.log(`Validated release metadata for ${tag}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

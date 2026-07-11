import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function findPreviousTag(currentTag: string) {
  const tags = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter(Boolean)

  return tags.find((tag) => tag !== currentTag)
}

async function main() {
  const packageName = requiredEnv('PACKAGE_NAME')
  const repository = requiredEnv('GITHUB_REPOSITORY')
  const releaseTag = requiredEnv('RELEASE_TAG')
  const releaseVersion = requiredEnv('RELEASE_VERSION')
  const previousTag = findPreviousTag(releaseTag)
  const repositoryUrl = `https://github.com/${repository}`
  const changelogUrl = `${repositoryUrl}/blob/${releaseTag}/changelog/v${releaseVersion}/en.md`
  const packageUrl = `https://www.npmjs.com/package/${packageName}/v/${releaseVersion}`
  const comparison = previousTag
    ? `**Full Changelog**: [${previousTag}...${releaseTag}](${repositoryUrl}/compare/${previousTag}...${releaseTag})`
    : `**Full Changelog**: [View commits for ${releaseTag}](${repositoryUrl}/commits/${releaseTag})`

  const body = [
    '## Changelog',
    '',
    `- [English](${changelogUrl})`,
    '',
    '## Package',
    '',
    `- npm: [${packageName}](${packageUrl})`,
    '',
    '## Assets',
    '',
    '- Windows x64 native binding is attached to this release.',
    '',
    comparison,
    '',
  ].join('\n')

  await writeFile('release-body.md', body, 'utf8')
  console.log(`Created release body for ${releaseTag}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

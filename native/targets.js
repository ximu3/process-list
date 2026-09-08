/** The native distribution matrix, shared by the loader and release tooling. */
export const targets = [
  { triple: 'x86_64-pc-windows-msvc', suffix: 'win32-x64-msvc', os: 'win32', cpu: 'x64' },
  { triple: 'aarch64-pc-windows-msvc', suffix: 'win32-arm64-msvc', os: 'win32', cpu: 'arm64' },
  { triple: 'x86_64-apple-darwin', suffix: 'darwin-x64', os: 'darwin', cpu: 'x64' },
  { triple: 'aarch64-apple-darwin', suffix: 'darwin-arm64', os: 'darwin', cpu: 'arm64' },
  { triple: 'x86_64-unknown-linux-gnu', suffix: 'linux-x64-gnu', os: 'linux', cpu: 'x64', libc: 'glibc' },
  {
    triple: 'aarch64-unknown-linux-gnu',
    suffix: 'linux-arm64-gnu',
    os: 'linux',
    cpu: 'arm64',
    libc: 'glibc',
  },
  { triple: 'x86_64-unknown-linux-musl', suffix: 'linux-x64-musl', os: 'linux', cpu: 'x64', libc: 'musl' },
  {
    triple: 'aarch64-unknown-linux-musl',
    suffix: 'linux-arm64-musl',
    os: 'linux',
    cpu: 'arm64',
    libc: 'musl',
  },
]

/** @param {string} os @param {string} cpu @param {string | undefined} [libc] */
export function selectTarget(os, cpu, libc) {
  const target = targets.find((target) => target.os === os && target.cpu === cpu && target.libc === libc)
  if (!target) {
    throw Object.assign(
      new Error(`Unsupported process-list platform: ${os}/${cpu}${libc ? `/${libc}` : ''}`),
      {
        code: 'ERR_UNSUPPORTED_PLATFORM',
      },
    )
  }
  return target
}

export function currentTarget() {
  let libc
  if (process.platform === 'linux') {
    const reporting = /** @type {NodeJS.ProcessReport & { excludeNetwork: boolean }} */ (process.report)
    // Avoid DNS/network collection, and restore the caller's setting even if report generation fails.
    const previous = reporting.excludeNetwork
    try {
      reporting.excludeNetwork = true
      const report = /** @type {{ header: { glibcVersionRuntime?: string } }} */ (reporting.getReport())
      libc = report.header.glibcVersionRuntime ? 'glibc' : 'musl'
    } finally {
      reporting.excludeNetwork = previous
    }
  }
  return selectTarget(process.platform, process.arch, libc)
}

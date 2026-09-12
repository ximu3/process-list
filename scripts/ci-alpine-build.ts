import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import manifest from '../package.json' with { type: 'json' }

const env = {
  ...process.env,
  PATH: `${join(homedir(), '.cargo', 'bin')}${delimiter}${process.env.PATH ?? ''}`,
  // Native Alpine builds use the container's compiler on both architectures.
  CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER: 'cc',
  CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER: 'cc',
}
const run = (command: string, args: string[]) => execFileSync(command, args, { env, stdio: 'inherit' })

run('apk', ['add', '--no-cache', 'build-base', 'curl'])
const installer = execFileSync('curl', ['--proto', '=https', '--tlsv1.2', '-sSf', 'https://sh.rustup.rs'])
execFileSync('sh', ['-s', '--', '-y', '--profile', 'minimal', '--default-toolchain', '1.90.0'], {
  env,
  input: installer,
  stdio: ['pipe', 'inherit', 'inherit'],
})
run('rustup', ['component', 'add', 'clippy', 'rustfmt'])
run('npm', ['install', '--global', manifest.packageManager])
run('pnpm', ['install', '--frozen-lockfile'])
run('pnpm', ['check:rust-format'])
run('pnpm', ['check:rust'])
run('pnpm', ['test:rust'])
run('pnpm', [
  'exec',
  'napi',
  'build',
  '--platform',
  '--release',
  '--no-js',
  '--output-dir',
  'native',
  '--dts',
  'addon.d.ts',
  '--',
  '--locked',
])

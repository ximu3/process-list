# @ximu3/process-list

Native process queries and foreground ownership for Node.js on Windows, macOS, and Linux.

Three independent operations list processes, inspect a PID, and identify the desktop's foreground owner. Queries run on Node.js's worker pool by default; explicit synchronous variants serve scripts and dedicated workers. Runtime queries use system APIs directly, without shell commands, background polling, or JavaScript dependencies beyond the matching native package.

## Install

```sh
pnpm add @ximu3/process-list
```

Requires **Node.js 22.13 or newer** and ESM. Keep optional dependencies enabled: the package manager selects the binary for your OS, architecture, and libc. Published packages need no compiler or installation script.

## Usage

```js
import { listProcesses, getProcess, getForeground } from '@ximu3/process-list'

const processes = await listProcesses()
console.log(processes)

const ownProcess = await getProcess(process.pid)
console.log(ownProcess?.memoryBytes)

const foreground = await getForeground()
if (foreground.status === 'active') {
  const owner = await getProcess(foreground.pid)
  console.log('Foreground:', owner?.name ?? foreground.pid)
} else if (foreground.status === 'unavailable') {
  console.log('Foreground identity is unavailable:', foreground.reason)
}
```

The foreground query returns an ownership observation, not a complete `ProcessInfo`. Processes can exit between calls, so the subsequent lookup may return `null`. A multi-process application may have many other processes besides its foreground owner.

Collect only selected PIDs:

```js
const processes = await listProcesses({ pids: [process.pid, process.ppid] })
```

`listProcesses` never queries the desktop. An unsupported or failing desktop connection has no effect on process enumeration. When both observations are useful, compose them explicitly:

```js
const [processes, foreground] = await Promise.all([listProcesses(), getForeground()])
```

These remain independent observations, with no guarantee of an atomic shared state. Use `Promise.allSettled` when one result should remain usable if the other query fails.

## API

| Asynchronous              | Synchronous                   | Result                   |
| ------------------------- | ----------------------------- | ------------------------ |
| `listProcesses(options?)` | `listProcessesSync(options?)` | `readonly ProcessInfo[]` |
| `getProcess(pid)`         | `getProcessSync(pid)`         | `ProcessInfo \| null`    |
| `getForeground()`         | `getForegroundSync()`         | `ForegroundResult`       |

Asynchronous functions return promises; synchronous functions block the calling JavaScript thread. Both modes use the same data and error contracts.

`listProcesses` accepts one optional property, `pids`: an array of unsigned 32-bit integer PIDs. Omit it for all visible processes; `[]` selects none. Duplicates are removed. PID zero is valid, but its existence depends on the OS. Arguments are copied before asynchronous collection starts.

```ts
interface ProcessInfo {
  readonly pid: number
  readonly name: string | null
  readonly parentPid: number | null
  readonly executablePath: string | null
  readonly memoryBytes: number | null
  readonly startedAt: number | null
}

type ForegroundResult =
  | { readonly status: 'active'; readonly pid: number; readonly source: 'win32' | 'appkit' | 'x11' }
  | { readonly status: 'none'; readonly source: 'win32' | 'appkit' | 'x11' }
  | { readonly status: 'unavailable'; readonly reason: ForegroundUnavailableReason }
```

### Data semantics

- Every process has all six properties. An unreadable detail is `null`, never an invented zero or empty string. An absent process is `null` from `getProcess` and omitted from a list. Visibility is limited by the caller's permissions and PID namespace.
- `name` is the OS process name, not an application title. OS limits may truncate it. Names and paths use replacement characters for invalid Unicode; Linux paths retain the kernel's ` (deleted)` suffix.
- `memoryBytes` is resident memory on Linux/macOS and working set on Windows. It includes shared pages and is not private memory or the sum of a process tree. Linux values inherit procfs RSS accounting precision.
- `startedAt` is a Unix timestamp in milliseconds. The unit does not imply millisecond accuracy: Linux uses boot seconds and clock ticks; the other platforms expose finer source timestamps.
- Lists are sorted by ascending PID without duplicates. Calls return independent records. TypeScript exposes readonly views; JavaScript objects are not frozen.
- Collection is not atomic. Processes can exit, fork, or change focus during a query. A foreground PID may be absent from a separately collected list; parent PIDs may have exited or been reused. Compare PID together with `startedAt` when tracking identity over time. Neither value is a process-control handle.

### Foreground results and errors

`active` identifies the process associated with the system-reported foreground window/application. `none` means the desktop API reported no foreground object in this context, including transient gaps during activation. `unavailable` is an expected inability to establish ownership; it does not classify all processes as background processes. The `source` field identifies the provider for diagnostics.

| Unavailable reason     | Meaning                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `wayland`              | This implementation has no portable global foreground PID query for Wayland. XWayland is not treated as the full desktop.       |
| `no-display`           | No Linux X11 display is configured.                                                                                             |
| `unsupported-desktop`  | The X11 window manager does not expose usable EWMH active-window information.                                                   |
| `missing-pid`          | The foreground application/window does not expose a valid PID.                                                                  |
| `unverified-pid`       | The X11 client's hostname is absent or differs from the local hostname, so its PID cannot be joined to the local process table. |
| `changed-during-query` | Foreground ownership kept changing or its window disappeared across three observation attempts. Retry later.                    |

Windows and X11 retry changes in focus/ownership up to three observations. X11 attempts share a two-second protocol deadline after transport connection; initial connection and hostname resolution use OS network timeouts. Transport failures, protocol errors, and timeouts are exceptions, not capability states.

All three operations reject/throw `ProcessQueryError` for unexpected query failures. It has code `ERR_PROCESS_QUERY_FAILED`, the logical `operation` name, and the original native error as `cause`. Sync functions use the same logical name without the `Sync` suffix.

```js
import { getForeground, ProcessQueryError } from '@ximu3/process-list'

try {
  const foreground = await getForeground()
  // Handle active / none / unavailable as ordinary results.
} catch (error) {
  if (error instanceof ProcessQueryError) {
    console.error(error.operation, error.cause)
  } else {
    throw error
  }
}
```

Invalid arguments use `TypeError` or `RangeError` before native dispatch. Unknown options, fractional or negative PIDs, strings, and out-of-range values are rejected. Per-process detail restrictions produce nullable fields; failure to enumerate the system is a query error. Foreground ownership is observational data, not an authorization signal.

## Platforms

| Platform            | Architectures | Process queries                       | Foreground ownership                                              |
| ------------------- | ------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Windows             | x64, ARM64    | Win32 process snapshot and query APIs | Foreground window owner                                           |
| macOS               | x64, ARM64    | libproc                               | AppKit frontmost application                                      |
| Linux glibc         | x64, ARM64    | procfs                                | X11/EWMH; explicit capability states on Wayland/headless sessions |
| Linux musl / Alpine | x64, ARM64    | procfs                                | Same Linux desktop capabilities                                   |

The OS must also be supported by the selected Node.js version. Linux requires procfs at `/proc`; its native binary does not link libX11. macOS builds target macOS 11 or newer, subject to Node.js's higher requirements. Unsupported operating systems and architectures fail explicitly at load time.

CI builds all eight targets and exercises them on Node.js 22.13, 24, and 26, including isolated X11 tests and installation from real tarballs. See the [verification record and desktop acceptance checks](docs/verification.md) for the distinction between compilation, native execution, and interactive validation.

## Development

Install Node.js 24, pnpm 11.2.2, Git, Rust 1.90 or newer with `clippy` and `rustfmt`, and the platform's C/C++ toolchain (Visual Studio Build Tools, Xcode command line tools, or a Linux C compiler).

The hook toolchain uses lint-staged 17, which requires Node.js 22.22.1 or newer; development and CI builds use Node.js 24. Published library packages continue to support Node.js 22.13 or newer.

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` builds the debug binding and runs all local checks. `pnpm build` produces the optimized binary. `pnpm check` runs formatting, Rust linting, types, Rust tests, Node.js tests, tarball installation tests, and isolated Git hook tests; it requires an existing native build. Public declarations are maintained in `index.d.ts`; internal declarations in `native/binding.d.ts` are generated and verified in CI.

Husky connects Git to the scripts in `.husky/`; lint-staged selects files and manages partial staging according to `lint-staged.config.mjs`. Formatting commands come from `package.json`, so staged-file checks and CI share their definitions. Files are passed directly to Prettier by lint-staged, with no project-specific file collection or shell-escaping adapter.

- `pre-commit` runs lint-staged with read-only checks. For partially staged files, lint-staged hides unstaged edits during checking and restores them afterward. Rust changes trigger the crate-wide `cargo fmt --check` command.
- `pre-push` runs `pnpm verify` against the current working tree. CI independently validates the committed revision across platforms.
- `pnpm test:hooks` runs actual hooks in temporary repositories, including unusual filenames, valid/invalid partial commits, Rust checks, push failure propagation, and installation boundaries.

The project's `prepare` script installs Husky in local repository checkouts and linked worktrees. CI, production-only installations, `HUSKY=0`, source archives, and nested copies are skipped. An existing custom `core.hooksPath` is preserved; Husky's own `.husky/_` path can be refreshed safely. Run `pnpm hooks:install` to repeat installation. Commit the two `.husky/` entry scripts; generated files under `.husky/_/` are ignored.

### Uninstalling local hooks

```sh
pnpm hooks:uninstall
```

This removes the local `core.hooksPath` value written by this project and its recorded, unmodified generated files. It leaves tracked hook entry scripts available for `pnpm hooks:install`. Installation records file hashes in `.husky/_/.process-list-hooks.json`; changed or unrecognized files, custom hook paths, global configuration, and included configuration files are preserved. Redirected directories are rejected. If another registered worktree still uses Husky, shared Git configuration remains until the last installation is removed.

The uninstaller requires only Node.js and Git, so it also works after dependencies have been removed:

```sh
node scripts/uninstall-hooks.mjs
```

For permanent removal, run the uninstaller **before** removing the Husky dependency and its tracked `.husky/` entry scripts, `prepare`/hook commands, and installation helpers. Remove lint-staged and its config only if staged-file checks are also being retired. Package managers do not reliably run cleanup when removing dependencies: the current pnpm version does not invoke `prepare` during `pnpm remove husky`. If `prepare` runs later with no Husky dependency declared, it performs cleanup instead of importing the missing package. Using `--ignore-scripts` still requires explicit cleanup.

As long as Husky remains declared, a later `prepare` or `pnpm hooks:install` may install hooks again. `HUSKY=0` skips installation/execution, but never prevents an explicitly requested uninstall.

The source manifest is private and has no dependency on unpublished platform packages. Release assembly creates a publishable manifest with exact-version optional dependencies for all eight targets. See [releasing](docs/releasing.md) and the [design rationale](docs/design.md).

Version 0.1 replaces the previous `getProcesses`, `include`, abbreviated detail fields, and per-process `isForeground` API. The public API consists of the three independent operations above and their explicit Sync variants.

## License

MIT

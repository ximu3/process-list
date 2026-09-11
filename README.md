# @ximu3/process-list

English | [简体中文](README.zh-CN.md)

Query processes and identify the foreground process on Windows, macOS, and Linux from Node.js.

## Install

```sh
pnpm add @ximu3/process-list
```

Requires **Node.js 22.13 or newer** and ESM. Keep optional dependencies enabled so the package manager can install the native binary for your platform. Published packages require no compiler.

## Usage

```js
import { listProcesses, getProcess, getForeground } from '@ximu3/process-list'

const processes = await listProcesses()
console.log(processes)

const current = await getProcess(process.pid)
console.log(current?.memoryBytes)

const foreground = await getForeground()
if (foreground.status === 'active') {
  console.log('Foreground PID:', foreground.pid)
}
```

## API

| Asynchronous              | Synchronous                   | Result                   |
| ------------------------- | ----------------------------- | ------------------------ |
| `listProcesses(options?)` | `listProcessesSync(options?)` | `readonly ProcessInfo[]` |
| `getProcess(pid)`         | `getProcessSync(pid)`         | `ProcessInfo \| null`    |
| `getForeground()`         | `getForegroundSync()`         | `ForegroundResult`       |

Asynchronous functions return promises and perform system queries on Node.js's worker pool. Functions with a `Sync` suffix block the calling thread. Both forms use the same results and errors.

### Process queries

`listProcesses()` returns all visible processes, sorted by ascending PID. Use `pids` to select a subset:

```js
const selected = await listProcesses({ pids: [process.pid, process.ppid] })
```

An empty `pids` array returns an empty list. Duplicate PIDs are removed, and absent processes are omitted. Results retain PID order rather than input order. `getProcess(pid)` returns one process, or `null` if it is absent.

PIDs must be integers from `0` through `4294967295`; PID zero's visibility depends on the OS. Visibility also depends on permissions and the PID namespace.

Every `ProcessInfo` contains these fields. Unreadable details are `null`.

| Field            | Type             | Meaning                                                                           |
| ---------------- | ---------------- | --------------------------------------------------------------------------------- |
| `pid`            | `number`         | Process ID.                                                                       |
| `name`           | `string \| null` | OS process name, which may be truncated by the OS.                                |
| `parentPid`      | `number \| null` | Parent process ID.                                                                |
| `executablePath` | `string \| null` | Executable path.                                                                  |
| `memoryBytes`    | `number \| null` | Resident memory on Linux/macOS or working set on Windows, including shared pages. |
| `startedAt`      | `number \| null` | Unix timestamp in milliseconds; precision depends on the OS.                      |

Calls return independent records. TypeScript marks them as readonly; JavaScript objects remain mutable. Names and paths replace invalid Unicode, and Linux executable paths retain the kernel's ` (deleted)` suffix when present.

Processes can exit and PIDs can be reused between queries. Use PID together with `startedAt`, when available, to distinguish process instances over time.

### Foreground process

`getForeground()` identifies the process associated with the foreground window on Windows/X11 or the frontmost application on macOS. It returns a `ForegroundResult`:

| `status`      | Fields          | Meaning                                                                    |
| ------------- | --------------- | -------------------------------------------------------------------------- |
| `active`      | `pid`, `source` | A foreground process was identified.                                       |
| `none`        | `source`        | The desktop reports no foreground window or application.                   |
| `unavailable` | `reason`        | Foreground identity could not be established for one of the reasons below. |

`source` is `win32`, `appkit`, or `x11`. To read the identified process's details, pass its PID to `getProcess`:

```js
if (foreground.status === 'active') {
  const owner = await getProcess(foreground.pid)
  console.log(owner?.name ?? foreground.pid)
}
```

Process queries and foreground queries are independent. The system can change during and between queries, so a foreground PID may be absent from a process list or a later lookup. A multi-process application's other processes are not included in the foreground result.

| Unavailable reason     | Meaning                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `wayland`              | Foreground identification is unavailable in Wayland sessions, including those with XWayland. |
| `no-display`           | No X11 display is configured.                                                                |
| `unsupported-desktop`  | The X11 window manager does not provide usable active-window information.                    |
| `missing-pid`          | The foreground application or window does not provide a valid PID.                           |
| `unverified-pid`       | The X11 window's PID could not be attributed to the local host.                              |
| `changed-during-query` | Foreground ownership changed repeatedly during the query; a later call may succeed.          |

### Errors

Unexpected system failures reject with `ProcessQueryError`, or throw it in synchronous calls. The error exposes `code: 'ERR_PROCESS_QUERY_FAILED'`, the `operation` name (`listProcesses`, `getProcess`, or `getForeground`), and the original native error as `cause`.

Invalid argument types and unknown options produce `TypeError`; invalid PID values produce `RangeError`. Permission restrictions on individual process details produce `null` fields. Failure to enumerate processes is a query error.

## Platforms

| Platform            | Architectures | Foreground identification                                                         |
| ------------------- | ------------- | --------------------------------------------------------------------------------- |
| Windows             | x64, ARM64    | Foreground window's process.                                                      |
| macOS               | x64, ARM64    | Frontmost application's process.                                                  |
| Linux glibc         | x64, ARM64    | X11 desktops that provide EWMH active-window information and local PID ownership. |
| Linux musl / Alpine | x64, ARM64    | Same desktop requirements as Linux glibc.                                         |

Process queries work on headless Linux and Wayland. Linux requires procfs mounted at `/proc`. macOS binaries target macOS 11 or newer. The OS must also meet the requirements of the selected Node.js version.

## Development

Use Node.js 24, pnpm 11.2.2, Git, Rust 1.90 or newer with `clippy` and `rustfmt`, and your platform's C/C++ toolchain. On Alpine ARM64, set `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=cc` for native builds.

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` builds the native module and checks formatting, types, Rust code, runtime behavior, and package installation. `pnpm build` produces an optimized binary.

Local checkouts install Git hooks for commit and push checks. Run `pnpm hooks:uninstall` to remove their local installation.

CI covers all eight native targets on Node.js 22.13, 24, and 26. Changes to foreground detection also require checking repeated application switching on real desktops, including calls from a long-running Node.js process and a Worker. Run X11 protocol tests on an isolated display:

```sh
PROCESS_LIST_X11_TEST=1 xvfb-run -a cargo test --locked --no-default-features x11_window -- --ignored
```

## Releasing

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for `ximu3/process-list` and `publish.yml` on the main package and all platform packages listed in `native/targets.js`.

1. Set the version in `package.json`, run `pnpm version:sync`, then run `cargo check` to update `Cargo.lock`.
2. Add `changelog/vX.Y.Z/en.md`, run `pnpm verify`, and check foreground behavior on the supported desktops.
3. Commit the release files and push the matching `vX.Y.Z` tag.

The release workflow validates and builds the tagged revision, then publishes the native packages, the main package, and the GitHub release. Stable versions use npm's `latest` tag; prereleases use `next`. Published versions are immutable, so inspect any partially completed publication before retrying.

## License

MIT

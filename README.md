# @ximu3/process-list

English | [简体中文](README.zh-CN.md)

Query process information and identify the foreground process on Windows, macOS, and Linux from Node.js. Includes asynchronous and synchronous APIs with TypeScript declarations.

## Install

```sh
npm install @ximu3/process-list
```

Requires **Node.js 22.13 or newer** and ESM. Keep optional dependencies enabled so the package manager can install the native binary for your platform. Installing the package requires no compiler.

## Platforms

| Platform             | Architectures | Foreground identification                                                 |
| -------------------- | ------------- | ------------------------------------------------------------------------- |
| Windows              | x64, ARM64    | Foreground window's process.                                              |
| macOS                | x64, ARM64    | Frontmost application's process.                                          |
| Linux (glibc / musl) | x64, ARM64    | X11 desktops with EWMH active-window information and local PID ownership. |

Process queries also work on headless Linux and Wayland. Foreground identification is unavailable in Wayland sessions, including those with XWayland. Linux requires procfs at `/proc`. macOS binaries target macOS 11 or newer; the OS must also meet the requirements of the selected Node.js version.

## Usage

```js
import { listProcesses, getProcess, getForeground } from '@ximu3/process-list'

const processes = await listProcesses()
const currentProcess = await getProcess(process.pid)
const foreground = await getForeground()

console.log({ processes, currentProcess, foreground })
```

## API

| Asynchronous              | Synchronous                   | Result                   |
| ------------------------- | ----------------------------- | ------------------------ |
| `listProcesses(options?)` | `listProcessesSync(options?)` | `readonly ProcessInfo[]` |
| `getProcess(pid)`         | `getProcessSync(pid)`         | `ProcessInfo \| null`    |
| `getForeground()`         | `getForegroundSync()`         | `ForegroundResult`       |

Asynchronous functions return promises. Functions with a `Sync` suffix block the calling thread. Both forms use the same results and errors.

### Process queries

`listProcesses()` returns all visible processes, sorted by ascending PID. Use `pids` to select a subset:

```js
import { listProcesses } from '@ximu3/process-list'

const selected = await listProcesses({ pids: [process.pid, process.ppid] })
console.log(selected)
```

An empty `pids` array returns an empty list. Duplicate PIDs are removed, and absent processes are omitted. `getProcess(pid)` returns one process, or `null` if it is absent.

PIDs must be integers from `0` through `4294967295`. Process visibility depends on the OS, permissions, and PID namespace. Every `ProcessInfo` contains these fields; unreadable details are `null`.

| Field            | Type             | Meaning                                                                                      |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `pid`            | `number`         | Process ID.                                                                                  |
| `name`           | `string \| null` | OS process name, which may be truncated by the OS.                                           |
| `parentPid`      | `number \| null` | Parent process ID.                                                                           |
| `executablePath` | `string \| null` | Executable path. On Linux, a deleted executable may retain the kernel's ` (deleted)` suffix. |
| `memoryBytes`    | `number \| null` | Resident memory on Linux/macOS or working set on Windows, in bytes, including shared pages.  |
| `startedAt`      | `number \| null` | Process start time as a Unix timestamp in milliseconds; precision depends on the OS.         |

Calls return independent records. TypeScript marks them as readonly; JavaScript objects remain mutable. Names and paths use replacement characters for invalid Unicode.

System state can change during and between queries. Processes may exit and PIDs may be reused. Use PID together with `startedAt`, when available, to distinguish process instances over time.

### Foreground process

`getForeground()` identifies the process associated with the foreground window on Windows/X11 or the frontmost application on macOS. It returns a `ForegroundResult`:

| `status`      | Fields          | Meaning                                                          |
| ------------- | --------------- | ---------------------------------------------------------------- |
| `active`      | `pid`, `source` | A foreground process was identified.                             |
| `none`        | `source`        | The desktop reports no foreground window or application.         |
| `unavailable` | `reason`        | The foreground identity is unknown for one of the reasons below. |

`source` is `win32`, `appkit`, or `x11`. `none` and `unavailable` are normal results; unexpected query failures produce errors.

Process queries and foreground queries are independent. To read details for an identified foreground process:

```js
import { getForeground, getProcess } from '@ximu3/process-list'

const foreground = await getForeground()
if (foreground.status === 'active') {
  const owner = await getProcess(foreground.pid)
  console.log(owner?.name ?? foreground.pid)
}
```

| Unavailable reason     | Meaning                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `wayland`              | The current desktop session uses Wayland.                                           |
| `no-display`           | No X11 display is configured.                                                       |
| `unsupported-desktop`  | The X11 window manager does not provide usable active-window information.           |
| `missing-pid`          | The foreground application or window does not provide a valid PID.                  |
| `unverified-pid`       | The X11 window's PID could not be attributed to the local host.                     |
| `changed-during-query` | Foreground ownership changed repeatedly during the query; a later call may succeed. |

### Errors

Unexpected system failures reject with `ProcessQueryError`, or throw it in synchronous calls. The error exposes `code: 'ERR_PROCESS_QUERY_FAILED'`, the `operation` name (`listProcesses`, `getProcess`, or `getForeground`), and the original native error as `cause`.

Invalid argument types and unknown options produce `TypeError`; invalid PID values produce `RangeError`. These errors follow the same promise-rejection or synchronous-throw behavior. Failure to enumerate processes is a query error, rather than an empty list.

## Build from source

Use Node.js 24, pnpm 11.2.2, Git, Rust 1.90 or newer with `clippy` and `rustfmt`, and your platform's C/C++ toolchain. On Alpine ARM64, set `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=cc` for native builds.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

## License

[MIT](LICENSE)

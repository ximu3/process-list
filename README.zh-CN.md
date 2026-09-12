# @ximu3/process-list

[English](README.md) | 简体中文

在 Node.js 中查询 Windows、macOS 和 Linux 的进程信息，识别当前前台进程。提供异步、同步接口和 TypeScript 类型声明。

## 安装

```sh
npm install @ximu3/process-list
```

要求 **Node.js 22.13 或更高版本**，使用 ESM。请启用可选依赖，让包管理器安装对应平台的原生二进制。安装这个包无需编译器。

## 平台支持

| 平台                  | 架构       | 前台识别                                                   |
| --------------------- | ---------- | ---------------------------------------------------------- |
| Windows               | x64、ARM64 | 前台窗口所属的进程。                                       |
| macOS                 | x64、ARM64 | 当前最前方的应用进程。                                     |
| Linux（glibc / musl） | x64、ARM64 | 提供 EWMH 活动窗口信息，并能确认 PID 属于本机的 X11 桌面。 |

进程查询也可用于无桌面的 Linux 环境和 Wayland 会话。Wayland 会话中的前台识别不可用，包括启用了 XWayland 的会话。Linux 要求在 `/proc` 挂载 procfs。macOS 二进制的最低目标版本为 macOS 11；操作系统还须满足所选 Node.js 版本的要求。

## 用法

```js
import { listProcesses, getProcess, getForeground } from '@ximu3/process-list'

const processes = await listProcesses()
const currentProcess = await getProcess(process.pid)
const foreground = await getForeground()

console.log({ processes, currentProcess, foreground })
```

## API

| 异步接口                  | 同步接口                      | 结果                     |
| ------------------------- | ----------------------------- | ------------------------ |
| `listProcesses(options?)` | `listProcessesSync(options?)` | `readonly ProcessInfo[]` |
| `getProcess(pid)`         | `getProcessSync(pid)`         | `ProcessInfo \| null`    |
| `getForeground()`         | `getForegroundSync()`         | `ForegroundResult`       |

异步接口返回 Promise。带 `Sync` 后缀的接口会阻塞调用线程。两种形式使用相同的结果和错误约定。

### 进程查询

`listProcesses()` 返回所有可见进程，按 PID 升序排列。通过 `pids` 可以筛选其中一部分：

```js
import { listProcesses } from '@ximu3/process-list'

const selected = await listProcesses({ pids: [process.pid, process.ppid] })
console.log(selected)
```

`pids` 为空数组时返回空列表；重复的 PID 会去重，不存在的进程会省略。`getProcess(pid)` 返回一个进程；进程不存在时返回 `null`。

PID 必须是 `0` 到 `4294967295` 之间的整数。进程的可见性取决于操作系统、权限和 PID 命名空间。每条 `ProcessInfo` 都包含以下字段，无法读取的详情为 `null`。

| 字段             | 类型             | 含义                                                                                 |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `pid`            | `number`         | 进程 ID。                                                                            |
| `name`           | `string \| null` | 操作系统提供的进程名称，可能被系统截断。                                             |
| `parentPid`      | `number \| null` | 父进程 ID。                                                                          |
| `executablePath` | `string \| null` | 可执行文件路径。Linux 上已删除的可执行文件路径可能保留内核提供的 ` (deleted)` 后缀。 |
| `memoryBytes`    | `number \| null` | Linux/macOS 上的驻留内存或 Windows 上的工作集大小，单位为字节，包含共享页。          |
| `startedAt`      | `number \| null` | 进程启动时间，以 Unix 毫秒时间戳表示，精度取决于操作系统。                           |

每次调用返回独立的记录。TypeScript 将字段标为只读，JavaScript 对象仍可修改。名称和路径中的无效 Unicode 会使用替代字符。

系统状态可能在查询期间或两次查询之间变化。进程可能退出，PID 也可能被复用。持续跟踪进程时，可在 `startedAt` 可用的情况下，将它与 PID 一起用于区分进程实例。

### 前台进程

`getForeground()` 在 Windows/X11 上识别前台窗口所属的进程，在 macOS 上识别当前最前方的应用进程。它返回 `ForegroundResult`：

| `status`      | 字段            | 含义                                 |
| ------------- | --------------- | ------------------------------------ |
| `active`      | `pid`、`source` | 已识别出前台进程。                   |
| `none`        | `source`        | 桌面系统报告当前没有前台窗口或应用。 |
| `unavailable` | `reason`        | 因下述原因之一，前台身份未知。       |

`source` 为 `win32`、`appkit` 或 `x11`。`none` 和 `unavailable` 都是正常结果；非预期的查询故障会产生错误。

进程查询与前台查询相互独立。需要已识别的前台进程详情时：

```js
import { getForeground, getProcess } from '@ximu3/process-list'

const foreground = await getForeground()
if (foreground.status === 'active') {
  const owner = await getProcess(foreground.pid)
  console.log(owner?.name ?? foreground.pid)
}
```

| 不可用原因             | 含义                                         |
| ---------------------- | -------------------------------------------- |
| `wayland`              | 当前桌面会话使用 Wayland。                   |
| `no-display`           | 未配置 X11 显示连接。                        |
| `unsupported-desktop`  | X11 窗口管理器没有提供可用的活动窗口信息。   |
| `missing-pid`          | 前台应用或窗口没有提供有效的 PID。           |
| `unverified-pid`       | 无法确认 X11 窗口提供的 PID 属于本机。       |
| `changed-during-query` | 查询期间前台归属反复变化，稍后调用可能成功。 |

### 错误

发生非预期的系统查询故障时，异步接口以 `ProcessQueryError` 拒绝 Promise，同步接口直接抛出该错误。错误包含 `code: 'ERR_PROCESS_QUERY_FAILED'`、操作名 `operation`（`listProcesses`、`getProcess` 或 `getForeground`），以及作为 `cause` 保留的原生错误。

参数类型不正确或包含未知选项时，报 `TypeError`；PID 数值无效时报 `RangeError`，同样通过 Promise 拒绝或同步抛出。枚举进程失败会产生查询错误，不会返回空列表。

## 从源码构建

使用 Node.js 24、pnpm 11.2.2、Git、Rust 1.90 或更高版本，以及所在平台的 C/C++ 工具链。Rust 需安装 `clippy` 和 `rustfmt`。在 Alpine ARM64 上进行本机构建时，设置环境变量 `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=cc`。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

## 许可证

[MIT](LICENSE)

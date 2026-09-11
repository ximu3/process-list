# @ximu3/process-list

[English](README.md) | 简体中文

在 Node.js 中查询 Windows、macOS 和 Linux 的进程信息，识别当前前台进程。

## 安装

```sh
pnpm add @ximu3/process-list
```

要求 **Node.js 22.13 或更高版本**，使用 ESM。请启用可选依赖，让包管理器安装对应平台的原生二进制。安装已发布的包无需编译器。

## 用法

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

| 异步接口                  | 同步接口                      | 结果                     |
| ------------------------- | ----------------------------- | ------------------------ |
| `listProcesses(options?)` | `listProcessesSync(options?)` | `readonly ProcessInfo[]` |
| `getProcess(pid)`         | `getProcessSync(pid)`         | `ProcessInfo \| null`    |
| `getForeground()`         | `getForegroundSync()`         | `ForegroundResult`       |

异步接口返回 Promise，在 Node.js 工作线程池中执行系统查询。带 `Sync` 后缀的接口会阻塞调用线程。两种形式使用相同的结果和错误约定。

### 进程查询

`listProcesses()` 返回所有可见进程，按 PID 升序排列。通过 `pids` 可以筛选其中一部分：

```js
const selected = await listProcesses({ pids: [process.pid, process.ppid] })
```

`pids` 为空数组时返回空列表；重复的 PID 会去重，不存在的进程会省略。结果仍按 PID 排序，不与输入位置逐项对应。`getProcess(pid)` 返回一个进程；进程不存在时返回 `null`。

PID 必须是 `0` 到 `4294967295` 之间的整数。PID 为零的进程是否可见取决于操作系统。权限和 PID 命名空间也会影响进程的可见性。

每条 `ProcessInfo` 都包含以下字段，无法读取的详情为 `null`。

| 字段             | 类型             | 含义                                                                        |
| ---------------- | ---------------- | --------------------------------------------------------------------------- |
| `pid`            | `number`         | 进程 ID。                                                                   |
| `name`           | `string \| null` | 操作系统提供的进程名称，可能被系统截断。                                    |
| `parentPid`      | `number \| null` | 父进程 ID。                                                                 |
| `executablePath` | `string \| null` | 可执行文件路径。                                                            |
| `memoryBytes`    | `number \| null` | Linux/macOS 上的驻留内存或 Windows 上的工作集大小，单位为字节，包含共享页。 |
| `startedAt`      | `number \| null` | Unix 毫秒时间戳，精度取决于操作系统。                                       |

每次调用返回独立的记录。TypeScript 将字段标为只读，JavaScript 对象仍可修改。名称和路径中的无效 Unicode 会使用替代字符；Linux 内核返回的路径若带有 ` (deleted)` 后缀，会保留该后缀。

进程可能在查询之间退出，PID 也可能被复用。持续跟踪进程时，可在 `startedAt` 可用的情况下，将它与 PID 一起用于区分进程实例。

### 前台进程

`getForeground()` 在 Windows/X11 上识别前台窗口所属的进程，在 macOS 上识别当前最前方的应用进程。它返回 `ForegroundResult`：

| `status`      | 字段            | 含义                                 |
| ------------- | --------------- | ------------------------------------ |
| `active`      | `pid`、`source` | 已识别出前台进程。                   |
| `none`        | `source`        | 桌面系统报告当前没有前台窗口或应用。 |
| `unavailable` | `reason`        | 因下述原因之一，无法确定前台身份。   |

`source` 为 `win32`、`appkit` 或 `x11`。需要该进程的详细信息时，将其 PID 传给 `getProcess`：

```js
if (foreground.status === 'active') {
  const owner = await getProcess(foreground.pid)
  console.log(owner?.name ?? foreground.pid)
}
```

进程查询与前台查询相互独立。系统状态可能在查询期间或两次查询之间变化，因此前台 PID 可能不在进程列表中，后续查询也可能找不到该进程。前台结果不包含多进程应用的其他进程。

| 不可用原因             | 含义                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `wayland`              | Wayland 会话中无法识别全局前台进程，包括启用了 XWayland 的会话。 |
| `no-display`           | 未配置 X11 显示连接。                                            |
| `unsupported-desktop`  | X11 窗口管理器没有提供可用的活动窗口信息。                       |
| `missing-pid`          | 前台应用或窗口没有提供有效的 PID。                               |
| `unverified-pid`       | 无法确认 X11 窗口提供的 PID 属于本机。                           |
| `changed-during-query` | 查询期间前台归属反复变化，稍后调用可能成功。                     |

### 错误

发生非预期的系统查询故障时，异步接口以 `ProcessQueryError` 拒绝 Promise，同步接口直接抛出该错误。错误包含 `code: 'ERR_PROCESS_QUERY_FAILED'`、操作名 `operation`（`listProcesses`、`getProcess` 或 `getForeground`），以及作为 `cause` 保留的原生错误。

参数类型不正确或包含未知选项时，报 `TypeError`；PID 数值无效时报 `RangeError`。单个进程详情受权限限制时，对应字段为 `null`；无法枚举进程时，报查询错误。

## 平台支持

| 平台                | 架构       | 前台识别                                                   |
| ------------------- | ---------- | ---------------------------------------------------------- |
| Windows             | x64、ARM64 | 前台窗口所属的进程。                                       |
| macOS               | x64、ARM64 | 当前最前方的应用进程。                                     |
| Linux glibc         | x64、ARM64 | 提供 EWMH 活动窗口信息，并能确认 PID 属于本机的 X11 桌面。 |
| Linux musl / Alpine | x64、ARM64 | 与 Linux glibc 相同的桌面要求。                            |

进程查询可用于无桌面的 Linux 环境和 Wayland 会话。Linux 要求在 `/proc` 挂载 procfs。macOS 二进制的最低目标版本为 macOS 11；操作系统还须满足所选 Node.js 版本的要求。

## 开发

使用 Node.js 24、pnpm 11.2.2、Git、Rust 1.90 或更高版本，以及所在平台的 C/C++ 工具链。Rust 需安装 `clippy` 和 `rustfmt`。在 Alpine ARM64 上进行本机构建时，设置环境变量 `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=cc`。

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` 构建原生模块，并检查格式、类型、Rust 代码、运行行为和包安装。`pnpm build` 生成经过优化的二进制。

本地仓库会安装 Git 钩子，在提交和推送时执行检查。运行 `pnpm hooks:uninstall` 可移除本地安装的钩子配置和生成文件。

CI 在 Node.js 22.13、24、26 上覆盖全部八个原生目标。修改前台识别时，还需在真实桌面上反复切换应用，检查长时间运行的 Node.js 进程及 Worker 中的查询行为。X11 协议测试应在隔离的显示环境中运行：

```sh
PROCESS_LIST_X11_TEST=1 xvfb-run -a cargo test --locked --no-default-features x11_window -- --ignored
```

## 发布

为主包和 `native/targets.js` 中列出的全部平台包配置 [npm 可信发布](https://docs.npmjs.com/trusted-publishers/)，指定仓库 `ximu3/process-list` 和工作流 `publish.yml`。

1. 修改 `package.json` 中的版本号，运行 `pnpm version:sync`，再运行 `cargo check` 更新 `Cargo.lock`。
2. 添加 `changelog/vX.Y.Z/en.md`，运行 `pnpm verify`，并在支持的桌面环境上检查前台识别行为。
3. 提交发布文件，推送匹配的 `vX.Y.Z` 标签。

发布工作流验证并构建标签对应的提交，依次发布平台包、主包和 GitHub Release。稳定版使用 npm 的 `latest` 标签，预发布版使用 `next`。已发布的版本不可覆盖；若发布只完成了一部分，应先确认已发布的内容，再决定如何继续。

## 许可证

MIT

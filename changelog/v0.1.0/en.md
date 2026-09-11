# 0.1.0

- Add native process queries for Windows, macOS, and Linux, with x64 and ARM64 distributions and separate glibc/musl Linux binaries.
- Provide asynchronous `listProcesses`, `getProcess`, and `getForeground`, with explicit `Sync` counterparts. Lists return process arrays without querying the desktop.
- Return fixed-shape, nullable process details with clear memory and timestamp units; validate arguments before native conversion.
- Separate foreground identity into active, none, and unavailable states. Support Windows, macOS, and X11; report Wayland and headless limitations explicitly.
- Preserve unexpected query failures in `ProcessQueryError` with an operation name and original cause. Retry transient ownership changes within a fixed bound.

This release replaces the previous API. `getProcesses` and the `include` option are removed. The old abbreviated fields and per-process `isForeground` flag are replaced by documented process records and foreground results. Requires ESM and Node.js 22.13 or newer.

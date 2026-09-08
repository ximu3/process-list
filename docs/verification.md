# Verification

## Local verification of the 0.1.0 rewrite — 2026-09-07

| Check                                                        | Observed result                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Optimized Windows x64 build                                  | Passed; native binary is 477,696 bytes                                                         |
| Windows x64 / Node.js 22.13.0, 24.11.1, 26.8.1               | 15 integration tests passed on each runtime; 3 Linux-only cases were skipped                   |
| Real npm tarball installation and runtime API                | Passed on those three Node.js versions, including version-mismatch and corrupt-binary failures |
| Rust tests on Windows                                        | 9 passed, including procfs parsers and bounded foreground race handling                        |
| Rust checking and Clippy                                     | Passed for all eight configured targets; this is not foreign-platform execution                |
| Clean pnpm installation, frozen lockfiles, formatting, types | Passed                                                                                         |
| GitHub Actions static validation                             | Passed with actionlint 1.7.12                                                                  |

Native Linux, macOS, Windows ARM64, Alpine, Xvfb, and interactive desktop acceptance were **not executed on this Windows x64 host**. The configured CI and desktop checks below remain necessary before claiming runtime validation on those systems. No release was published as part of this local verification.

## Hook migration — 2026-09-08

Husky 9.1.7 and lint-staged 17.5.0 replace the previous hook manager and the project's file-argument adapter. On Windows with Node.js 24.11.1, all seven hook integration tests passed: unusual filenames; invalid and valid partially staged content; Rust formatting failures; pre-push command/error propagation; repeatable installation with custom-path preservation; and installation skips for CI, production, explicit opt-out, and nested copies.

A fresh installation from the frozen pnpm lockfile also passed in a nested source copy without altering the parent repository's hooks. The repository uses `.husky/_`. No project files were staged or committed by these tests.

The hooks use the development Node.js 24 environment. lint-staged 17's Node.js 22.22.1 minimum applies to development tooling, not to the published library's Node.js 22.13 runtime contract. Native API implementation files were not changed for this migration. Hook execution on macOS and Linux remains covered by the configured CI matrix rather than this local run.

## Hook cleanup — 2026-09-08

The hook suite now has 13 passing Windows tests. Added cases verify uninstall/reinstall, restoration of default Git hooks, preservation of changed/unknown files, protection of global and included config, cleanup without node_modules, rejection of redirected paths or corrupt ownership records, and shared configuration across linked worktrees.

A separate real pnpm removal test confirmed that `pnpm remove husky` does not execute `prepare`: the Git setting remains until cleanup is explicitly invoked. Running `node scripts/uninstall-hooks.mjs` after package removal successfully removes the owned local setting and generated files. Documentation therefore requires explicit uninstall rather than promising automatic package-manager cleanup.

The actual project checkout also completed uninstall → inspection → reinstall. During inspection the local `core.hooksPath` was absent and `.husky/_` had been removed. Three obsolete generated Lefthook backup files were deleted; Git's sample hooks were retained. Husky was then reinstalled and is the active project hook manager.

## Automated checks

`pnpm verify` builds the debug binding and runs `pnpm check`. Checks include formatting, Rust linting, strict JavaScript/TypeScript checking, Rust core tests, Node.js integration tests, real npm tarball installation, and isolated Git hook tests. `pnpm build` produces the optimized binding with the locked Rust dependencies.

The shared CI workflow builds Windows and macOS on x64 and ARM64 hosts, Linux glibc using the baseline cross toolchain, and Linux musl in Alpine containers. Runtime jobs exercise the package on Node.js 22.13, 24, and 26, including installation through the optional native dependency.

Foreground error tests cover both layers: a Node.js module mock verifies that all six public operations retain the original error as `ProcessQueryError.cause`, while Linux subprocess tests verify normal headless/Wayland results and an actual invalid-display error. Rust tests distinguish focus changes from failures and bound the retry count. The X11 fixture includes a window destroyed during ownership lookup.

`pnpm test:hooks` creates independent temporary Git repositories and runs their actual pre-commit and pre-push hooks. It verifies file handling, both directions of partial staging, Rust checks, push failures, and installation boundaries. Host Git configuration and Husky startup files are isolated from these fixtures. It does not stage or commit the user's project files.

The X11 protocol test needs an isolated display because it sets EWMH properties on its root window. CI uses Xvfb. On a Linux development machine:

```sh
PROCESS_LIST_X11_TEST=1 xvfb-run -a cargo test --locked --no-default-features x11_window -- --ignored
```

Rust target checking verifies compilation only. It does not execute the binary or prove that the target SDK links successfully. A passing Windows run does not imply macOS or Linux runtime success.

## Desktop acceptance

Run these checks on each intended desktop before a release. Hosted runners may not have an interactive user desktop, and protocol fixtures do not reproduce every window manager or macOS event-loop behavior.

1. In a long-lived Node.js process, sample `getForeground()` every 250 ms while switching between two real applications. Confirm the reported PID changes both ways and stays correct after repeated switches. Run the same exercise using `getForegroundSync()`. Handle `ProcessQueryError` separately from ordinary result states.
2. On macOS, use ordinary Node.js without an AppKit event loop, then repeat inside a Node.js Worker. Confirm focus does not remain stuck on the first application. No Accessibility prompt or application window should be created by the library.
3. On Windows, include a regular application and an elevated or protected process. Foreground identity may be visible while some process details are `null`. Confirm handle counts do not grow continually during repeated queries.
4. On X11, verify a normal local window and a window without `_NET_WM_PID`. A remote or unidentifiable client hostname must not be joined to a local PID. Disconnecting the configured X server should produce `ProcessQueryError`, while process queries remain usable. Repeated focus changes may return `changed-during-query` after the bounded retries.
5. On Wayland, including a session with XWayland, verify `unavailable` with reason `wayland`; process enumeration and PID lookup should still work. In a headless Linux environment without `DISPLAY`, expect `no-display`.
6. Start and stop short-lived applications while querying. The library should tolerate disappearing processes and preserve its nullable-field contract. Do not assume separately collected lists and foreground observations are atomic or have identical process counts.

These are release acceptance steps. Their presence is not evidence that they have already been performed on a particular machine.

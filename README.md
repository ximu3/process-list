# process-list

A lightweight, high-performance Node.js library for retrieving system process information. Built with Rust and N-API.

## Features

- **High Performance**: Built with Rust and direct platform APIs for minimal overhead.
- **Lightweight**: Zero runtime dependencies (except the native binary itself).
- **Windows Support**: Windows is the only officially supported platform at this stage.
- **Background & Foreground**: Detect background and foreground processes.
- **TypeScript**: First-class TypeScript support with generated definitions.

## Installation

```bash
pnpm add @ximu3/process-list
```

## Usage

### Basic Usage

Get a list of all running processes with core information (PID, Name, Path, Foreground Status).

```typescript
import { getProcesses } from '@ximu3/process-list'

const processes = getProcesses()

console.log(`Found ${processes.length} processes`)

// Find the current foreground process
const foregroundApp = processes.find((p) => p.isForeground)
if (foregroundApp) {
  console.log(`Foreground App: ${foregroundApp.name} (PID: ${foregroundApp.pid})`)
}
```

### Advanced Usage

Retrieve additional details like Parent PID, Memory Usage, and Start Time.

```typescript
import { getProcesses } from '@ximu3/process-list'

// Request optional fields using the options object
const detailedProcesses = getProcesses({
  include: ['ppid', 'memory', 'startTime'],
})

detailedProcesses.forEach((proc) => {
  if (proc.memory) {
    console.log(`${proc.name}: ${(proc.memory / 1024 / 1024).toFixed(2)} MB`)
  }
})
```

### Get Single Process

Fetch information for a specific PID.

```typescript
import { getProcess } from '@ximu3/process-list'

const myProcess = getProcess(process.pid)

if (myProcess) {
  console.log(myProcess)
}
```

## API Reference

### `getProcesses(options?)`

Returns an array of `ProcessInfo` objects.

**Options:**

- `include`: Array of optional fields to fetch. values: `'ppid' | 'memory' | 'startTime'`.

### `getProcess(pid, options?)`

Returns a single `ProcessInfo` object or `null` if the PID is not found.

### `ProcessInfo` Interface

```typescript
interface ProcessInfo {
  /** Process ID */
  pid: number
  /** Process name */
  name: string
  /** Full path to the executable (may be null if not accessible) */
  path: string | null
  /** Whether this process owns the foreground window */
  isForeground: boolean

  // Optional Fields
  /** Parent process ID (requires include: ["ppid"]) */
  ppid?: number | null
  /** Memory usage in bytes (requires include: ["memory"]) */
  memory?: number | null
  /** Process start time as Unix timestamp in ms (requires include: ["startTime"]) */
  startTime?: number | null
}
```

## Platform Support

This project currently supports **Windows only**.

`macOS` and `Linux` code paths are placeholder implementations and are not officially supported yet.

| Platform | Status      |
| -------- | ----------- |
| Windows  | Supported   |
| macOS    | Placeholder |
| Linux    | Placeholder |

## License

MIT

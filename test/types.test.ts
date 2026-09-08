import {
  getProcess,
  listProcesses,
  getForeground,
  ProcessQueryError,
  type ProcessInfo,
  type QueryOperation,
} from '@ximu3/process-list'

const processes: readonly ProcessInfo[] = await listProcesses({ pids: [process.pid] as const })
const ownProcess: ProcessInfo | null = await getProcess(process.pid)
const foreground = await getForeground()
if (foreground.status === 'active') {
  const pid: number = foreground.pid
  await getProcess(pid)
} else if (foreground.status === 'unavailable') {
  const reason: string = foreground.reason
  void reason
  // @ts-expect-error An unavailable state cannot claim a PID.
  foreground.pid
}
if (ownProcess !== null) {
  const nullable: number | null = ownProcess.memoryBytes
  void nullable
  // @ts-expect-error Details may be unreadable.
  const required: string = ownProcess.executablePath
  void required
}
// @ts-expect-error Lists expose a readonly view.
processes.push(ownProcess)
// @ts-expect-error PIDs are numbers.
await getProcess('123')
// @ts-expect-error Unknown query options are rejected.
await listProcesses({ include: ['memory'] })
// @ts-expect-error Desktop querying is not a list option.
await listProcesses({ foreground: false })
try {
  await getForeground()
} catch (error) {
  if (error instanceof ProcessQueryError) {
    const operation: QueryOperation = error.operation
    const code: 'ERR_PROCESS_QUERY_FAILED' = error.code
    const cause: Error = error.cause
    void operation
    void code
    void cause
  }
}

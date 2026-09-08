import { parentPort } from 'node:worker_threads'
import { getProcess } from '@ximu3/process-list'
parentPort.postMessage(await getProcess(process.pid))

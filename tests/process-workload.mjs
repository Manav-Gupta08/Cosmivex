import { fork } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { availableParallelism } from 'node:os'

if (process.argv.includes('--resource-probe')) {
  let memory = new Uint8Array(16 * 1024 * 1024)
  memory.fill(1)
  let workers = []
  process.on('disconnect', () => process.exit(0))
  process.on('message', async command => {
    if (command === 'cpu-on' && workers.length === 0) {
      const count = Math.min(8, Math.max(1, Math.ceil(availableParallelism() * 0.15)))
      workers = Array.from({ length: count }, () => new Worker('let value = 1; while (true) { value = Math.imul(value + 1, 1664525); }', { eval: true }))
    } else if (command === 'cpu-off') {
      await Promise.all(workers.map(worker => worker.terminate()))
      workers = []
    } else if (command === 'memory-up') {
      memory = new Uint8Array(384 * 1024 * 1024)
      memory.fill(2)
    } else if (command === 'stop') process.exit(0)
    process.send?.({ command })
  })
  setInterval(() => { memory[0] = (memory[0] + 1) & 255 }, 1000)
  setTimeout(() => process.exit(0), 90000)
  process.send?.({ command: 'ready' })
} else {
  const child = process.argv.includes('--child') ? null : fork(new URL(import.meta.url), ['--child'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  if (child) console.log(JSON.stringify({ pid: process.pid, childPid: child.pid }))
  else process.on('disconnect', () => process.exit(0))
  const memory = new Uint8Array(64 * 1024 * 1024)
  memory.fill(1)
  let cursor = 0
  const timer = setInterval(() => {
    const deadline = performance.now() + 15
    while (performance.now() < deadline) {
      cursor = (cursor + 4096) % memory.length
      memory[cursor] = (memory[cursor] + 1) & 255
    }
  }, 100)
  setTimeout(() => { clearInterval(timer); child?.kill(); process.exit(0) }, 120000)
}
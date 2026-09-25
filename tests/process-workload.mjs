import { fork } from 'node:child_process'

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
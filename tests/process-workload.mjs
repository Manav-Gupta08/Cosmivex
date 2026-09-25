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
setTimeout(() => { clearInterval(timer) }, 120000)
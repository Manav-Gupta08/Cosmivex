import { chromium, expect } from '@playwright/test'
import { rolldown } from 'rolldown'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const seconds = Number(process.argv[2] ?? 60)
const disabled = process.argv.includes('--disabled')
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) throw new Error('Pressure duration must be 5-120 seconds')
await mkdir('artifacts', { recursive: true })
const sources = []
for (const input of ['shared/protocol/stream.ts', 'node_modules/@tauri-apps/api/core.js']) {
  const bundle = await rolldown({ input, platform: 'browser', plugins: [{
    name: 'qualification-csp-validation',
    transform(code, id) {
      if (/\/shared\/protocol\/(core|stream)\.ts$/.test(id.replaceAll('\\', '/'))) return { code: code.replace("import { z } from 'zod'", "import { z } from 'zod'\nz.config({ jitless: true })"), map: null }
    },
  }] })
  const { output } = await bundle.generate({ format: 'iife', name: input.startsWith('shared/') ? 'pressureProtocol' : 'pressureApi', codeSplitting: false })
  sources.push(...output.filter(item => item.type === 'chunk').map(item => ({ code: item.code })))
  await bundle.close()
}
const listener = createServer()
await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(9225, '127.0.0.1', () => listener.close(resolve)) })
const application = spawn('apps/desktop/src-tauri/target/release/universe-os.exe', [], { stdio: 'ignore', env: {
  ...process.env, UOS_QUALIFICATION: disabled ? '0' : '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1',
} })
let browser
try {
  await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:9225') }).toPass({ timeout: 20000 })
  const page = browser.contexts()[0].pages()[0]
  await expect(page.getByTestId('connection-status')).toHaveText('Native core connected')
  const session = await page.context().newCDPSession(page)
  for (const source of sources) {
    const evaluated = await session.send('Runtime.evaluate', { expression: source.code })
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text)
  }
  const report = disabled ? await page.evaluate(async () => {
    const { Channel, invoke } = window.pressureApi
    for (const [command, args] of [['pressure_run', { onFrame: new Channel(() => {}), seconds: 5 }], ['pressure_ack', { transferId: '1', chunkIndex: 0 }]]) {
      let rejected = false
      try { await invoke(command, args) } catch (error) { rejected = String(error) === 'Isolated qualification is disabled' }
      if (!rejected) throw new Error(`${command} did not enforce the opt-in gate`)
    }
    return { ordinaryLaunchRejectedQualification: true }
  }) : await page.evaluate(async seconds => {
    const { Channel, invoke } = window.pressureApi
    const { ChunkAssembler, applyPacket, wireSchema } = window.pressureProtocol
    const assembler = new ChunkAssembler()
    let frame = null
    let cursor = 0n
    let gaps = 0n
    let delivered = 0
    let bytes = 0
    let pendingAcks = 0
    let maximumPending = 0
    let failure = null
    const timings = []
    const heap = []
    const encoder = new TextEncoder()
    const memoryTimer = setInterval(() => heap.push({ atUnixMs: Date.now(), usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null }), 1000)
    const onFrame = new Channel(raw => {
      try {
        const started = performance.now()
        const chunk = wireSchema.parse(raw)
        if (chunk.kind !== 'chunk') throw new Error(chunk.message)
        bytes += encoder.encode(JSON.stringify(chunk)).byteLength
        const assembled = assembler.push(chunk)
        if (assembled?.packet) {
          frame = applyPacket(frame, assembled.packet)
          const events = assembled.packet.events
          if (events.rows.length > 256 || BigInt(events.throughSequence) < cursor) throw new Error('Unbounded or regressing event window')
          delivered += events.rows.filter(row => BigInt(row.sequence) > cursor).length
          gaps += BigInt(events.gapCount)
          cursor = BigInt(events.throughSequence)
          timings.push(performance.now() - started)
        }
        pendingAcks += 1
        maximumPending = Math.max(maximumPending, pendingAcks)
        setTimeout(() => {
          pendingAcks -= 1
          void invoke('pressure_ack', { transferId: chunk.transferId, chunkIndex: chunk.chunkIndex }).catch(error => { failure = String(error) })
        }, 250)
      } catch (error) { failure = String(error) }
    })
    try {
      const native = await invoke('pressure_run', { onFrame, seconds })
      if (failure) throw new Error(failure)
      if (native.generated !== seconds * 50000 || native.acknowledgedCursor !== native.generated || cursor !== BigInt(native.generated)) throw new Error('Producer or final consumer cursor mismatch')
      if (native.pendingTransfers !== 0 || maximumPending !== 1 || pendingAcks !== 0) throw new Error('Single-flight or drain invariant failed')
      if (delivered + Number(gaps) !== native.generated) throw new Error('Delivered events and explicit gaps do not cover generated events')
      const sorted = timings.sort((left, right) => left - right)
      return { native, seconds, synthetic: true, producer: 'Rust isolated lifecycle/PID-reuse generator; not OS scans', consumer: 'production assembler and graph validation; separate from live store and SQLite',
        ackDelayMs: 250, delivered, gaps: gaps.toString(), maximumPending, bytes, bytesPerSecond: bytes / native.producerSeconds,
        parseApplyP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], heap }
    } finally { clearInterval(memoryTimer) }
  }, seconds)
  const resultName = disabled ? 'pressure-disabled' : 'pressure-release'
  await writeFile(`artifacts/${resultName}.json`, JSON.stringify(report, null, 2))
  await writeFile(`artifacts/${resultName}-${Date.now()}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  if (application.exitCode === null) application.kill()
}
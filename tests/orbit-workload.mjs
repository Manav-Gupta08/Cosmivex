import { chromium, expect } from '@playwright/test'

const seconds = Number(process.argv[2] ?? 100)
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 600) throw new Error('Orbit duration must be 5-600 seconds')
const endpoint = process.env.UOS_TEST_ENDPOINT ?? 'http://127.0.0.1:9224'
const inputMode = process.env.UOS_ORBIT_INPUT ?? 'cdp'
if (!['cdp', 'local'].includes(inputMode)) throw new Error('Unknown orbit input mode')
let browser
try {
  await expect(async () => { browser = await chromium.connectOverCDP(endpoint) }).toPass({ timeout: 20000 })
  const page = browser.contexts()[0].pages()[0]
  await expect(page.getByTestId('connection-status')).toHaveText('Native core connected', { timeout: 15000 })
  await page.setViewportSize({ width: 1360, height: 820 })
  await page.getByRole('button', { name: 'Universe view', exact: true }).click()
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'Engine diagnostics' }).click()
  const beforeFrames = Number(await page.getByTestId('frames-rendered').innerText())
  await expect.poll(async () => Number(await page.getByTestId('total-bytes-received').innerText())).toBeGreaterThan(0)
  const beforeBytes = Number(await page.getByTestId('total-bytes-received').innerText())
  await page.evaluate(() => {
    const value = document.querySelector('[data-testid="total-bytes-received"]')
    const readings = [{ atUnixMs: Date.now(), bytes: Number(value.textContent) }]
    const observer = new MutationObserver(() => readings.push({ atUnixMs: Date.now(), bytes: Number(value.textContent) }))
    observer.observe(value, { characterData: true, childList: true, subtree: true })
    window.__orbitReadings = { readings, observer }
  })
  const before = await canvas.screenshot()
  const until = performance.now() + seconds * 1000
  const startedAt = performance.now()
  let drags = 0
  await page.mouse.move(650, 400)
  await page.mouse.down()
  try {
    if (inputMode === 'local') {
      console.log('ORBIT_READY')
      drags = await page.evaluate(duration => new Promise(resolve => {
        const canvas = document.querySelector('canvas')
        const started = performance.now()
        const move = now => {
          const elapsed = now - started
          if (elapsed >= duration * 1000) { resolve(Math.floor(elapsed / 600)); return }
          const phase = elapsed % 600 / 600
          const fraction = phase < 0.5 ? phase * 2 : (1 - phase) * 2
          canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1,
            clientX: 650 + 180 * fraction, clientY: 400 + 70 * fraction }))
          requestAnimationFrame(move)
        }
        requestAnimationFrame(move)
      }), seconds)
    } else {
    while (performance.now() < until) {
      await page.mouse.move(830, 470, { steps: 8 })
      await page.mouse.move(650, 400, { steps: 8 })
      drags += 1
      if (drags === 1) console.log('ORBIT_READY')
    }
    }
  } finally {
    await page.mouse.up()
  }
  const changed = !(await canvas.screenshot()).equals(before)
  await page.waitForTimeout(1100)
  const ipcReadings = await page.evaluate(() => { window.__orbitReadings.observer.disconnect(); return window.__orbitReadings.readings })
  const frames = Number(await page.getByTestId('frames-rendered').innerText()) - beforeFrames
  const afterBytes = Number(await page.getByTestId('total-bytes-received').innerText())
  const submissionP95Ms = Number.parseFloat(await page.getByTestId('submission-p95').innerText())
  const movingCadenceP95Ms = Number.parseFloat(await page.getByTestId('moving-cadence-p95').innerText())
  const parseApplyP95Ms = Number.parseFloat(await page.getByTestId('parse-apply-p95').innerText())
  const validationP95Ms = Number.parseFloat(await page.getByTestId('validation-p95').innerText())
  const assemblyP95Ms = Number.parseFloat(await page.getByTestId('assembly-p95').innerText())
  const reconstructionP95Ms = Number.parseFloat(await page.getByTestId('reconstruction-p95').innerText())
  const storeUpdateP95Ms = Number.parseFloat(await page.getByTestId('store-update-p95').innerText())
  const frameCpuP95Ms = Number.parseFloat(await page.getByTestId('frame-cpu-p95').innerText())
  const frameWorkText = await page.getByTestId('frame-work-p95').innerText()
  const frameWorkP95Ms = Number.isFinite(Number.parseFloat(frameWorkText)) ? Number.parseFloat(frameWorkText) : null
  const gpuText = await page.getByTestId('gpu-p95').innerText()
  const gpuP95Ms = Number.isFinite(Number.parseFloat(gpuText)) ? Number.parseFloat(gpuText) : null
  const completionText = await page.getByTestId('completion-p95').innerText()
  const completionUpperBoundP95Ms = Number.isFinite(Number.parseFloat(completionText)) ? Number.parseFloat(completionText) : null
  if (!changed || frames <= drags) throw new Error(`Orbit did not produce sufficient rendering: ${drags} drags, ${frames} frames, changed=${changed}`)
  if (![submissionP95Ms, movingCadenceP95Ms, parseApplyP95Ms, validationP95Ms, assemblyP95Ms, reconstructionP95Ms, storeUpdateP95Ms].every(Number.isFinite) || afterBytes < beforeBytes) throw new Error('Missing renderer or IPC diagnostics')
  console.log(JSON.stringify({ endpoint, seconds, inputMode, drags, frames, changed, submissionP95Ms, movingCadenceP95Ms, frameCpuP95Ms, frameWorkP95Ms, gpuP95Ms, gpuStatus: gpuText, completionUpperBoundP95Ms, parseApplyP95Ms, validationP95Ms, assemblyP95Ms, reconstructionP95Ms, storeUpdateP95Ms, ipcByteScope: 'serialized snapshot JSON envelopes; excludes acknowledgements and WebView framing', ipcBytesPerSecond: (afterBytes - beforeBytes) / ((performance.now() - startedAt) / 1000), ipcReadings }))
} finally {
  if (browser) await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000))])
}
process.exit(0)
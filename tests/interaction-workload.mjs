import { chromium, expect } from '@playwright/test'

const seconds = Number(process.argv[2] ?? 105)
const workload = process.argv[3]
if (!['selection', 'focus', 'replay'].includes(workload) || !Number.isFinite(seconds) || seconds < 5 || seconds > 600) throw new Error('Invalid interaction workload')
let browser
try {
  await expect(async () => { browser = await chromium.connectOverCDP(process.env.UOS_TEST_ENDPOINT ?? 'http://127.0.0.1:9224') }).toPass({ timeout: 20000 })
  const page = browser.contexts()[0].pages()[0]
  await page.setViewportSize({ width: 1360, height: 820 })
  await expect(page.getByTestId('connection-status')).toHaveText('Native core connected')
  if (workload === 'replay') {
    await page.getByRole('button', { name: 'Historical replay' }).click()
    await expect(page.getByRole('complementary', { name: 'Recorded details' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('slider', { name: 'Replay checkpoint' })).toBeEnabled()
  } else {
    await page.getByRole('button', { name: 'Process list', exact: true }).click()
    await expect(page.locator('.process-name').first()).toBeVisible()
    if (workload === 'focus') await page.locator('.process-name').first().click()
  }
  const samples = []
  const end = performance.now() + seconds * 1000
  let step = 0
  console.log('INTERACTION_READY')
  while (performance.now() < end) {
    const started = performance.now()
    if (workload === 'replay') {
      const slider = page.getByRole('slider', { name: 'Replay checkpoint' })
      const maximum = Number(await slider.getAttribute('max'))
      await slider.fill(String(step % (maximum + 1)))
      await expect(page.getByRole('complementary', { name: 'Recorded details' })).toBeVisible()
    } else if (workload === 'selection') {
      if (await page.getByRole('button', { name: 'Close process details' }).count()) await page.getByRole('button', { name: 'Close process details' }).click()
      if (!(await page.locator('.process-name').count())) await page.getByRole('button', { name: 'Process list', exact: true }).click()
      const rows = page.locator('.process-name')
      await rows.nth(step % Math.min(10, await rows.count())).click()
      await expect(page.getByTestId('process-pid')).toBeVisible()
    } else {
      await page.locator('canvas').focus()
      await page.keyboard.press('ArrowLeft')
      await page.getByRole('button', { name: 'Focus process', exact: true }).click()
      await expect(page.getByTestId('process-status')).toHaveText('Observed')
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    samples.push({ atUnixMs: Date.now(), milliseconds: performance.now() - started })
    step += 1
    await page.waitForTimeout(750)
  }
  await page.screenshot({ path: `artifacts/${workload}-release.png` })
  const sorted = samples.map(sample => sample.milliseconds).sort((left, right) => left - right)
  const percentile = value => sorted[Math.ceil(sorted.length * value) - 1]
  console.log(JSON.stringify({ workload, seconds, operations: samples.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    timingScope: 'automation action through expected UI state and two animation frames; includes CDP latency, not GPU completion', samples }))
} finally {
  await browser?.close()
}
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const native = process.argv.includes('--native')
const endpoint = process.env.UOS_TEST_ENDPOINT ?? (native ? 'http://127.0.0.1:9223' : 'http://127.0.0.1:1420')
await mkdir('artifacts', { recursive: true })
let browser
if (native) {
  await expect(async () => { browser = await chromium.connectOverCDP(endpoint) }).toPass({ timeout: 30000 })
} else {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
}
const page = native ? browser.contexts()[0].pages()[0] : await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))

async function canvasIsVisible() {
  const screenshot = await page.locator('canvas').screenshot()
  const pixels = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 80
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, 128, 80)
    image.close()
    const data = context.getImageData(0, 0, 128, 80).data
    let lit = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] > 100) lit += 1
    }
    return lit
  }, [...screenshot])
  expect(pixels).toBeGreaterThan(20)
  return { screenshot, pixels }
}

try {
  if (!native) await page.goto(endpoint)
  await expect(page.getByTestId('connection-status')).toHaveText(native ? 'Native core connected' : 'Browser preview', { timeout: 20000 })
  await page.setViewportSize({ width: 1360, height: 820 })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 20000 })
  const desktop = await canvasIsVisible()
  await page.screenshot({ path: `artifacts/${native ? 'native' : 'browser'}-desktop.png` })
  await page.mouse.move(600, 430)
  await page.mouse.down()
  await page.mouse.move(820, 490, { steps: 16 })
  await page.mouse.up()
  await expect(async () => {
    expect((await page.locator('canvas').screenshot()).equals(desktop.screenshot)).toBe(false)
  }).toPass({ timeout: 5000 })
  await page.getByRole('button', { name: 'Reset camera' }).click()
  await page.getByRole('button', { name: 'Engine diagnostics' }).click()
  await expect(page.getByRole('complementary')).toBeVisible()
  if (native) {
    for (const [profile, interval] of [['Eco', '5000 ms'], ['Cinematic', '2000 ms'], ['Normal', '2000 ms']]) {
      await page.getByRole('button', { name: `${profile} profile` }).click()
      await expect(page.getByRole('button', { name: `${profile} profile` })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('health-interval')).toHaveText(interval)
    }
    const sequence = BigInt(await page.getByTestId('sequence').innerText())
    await expect.poll(async () => BigInt(await page.getByTestId('sequence').innerText()) > sequence, { timeout: 8000 }).toBe(true)
    await page.reload()
    await expect(page.getByTestId('connection-status')).toHaveText('Native core connected')
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
  } else {
    await expect(page.getByRole('button', { name: 'Eco profile' })).toBeDisabled()
    await expect(page.getByTestId('sequence')).toHaveText('Unavailable')
  }
  let previousFrames = ''
  let stableSamples = 0
  await expect.poll(async () => {
    const current = await page.getByTestId('frames-rendered').innerText()
    stableSamples = current === previousFrames ? stableSamples + 1 : 0
    previousFrames = current
    return stableSamples
  }, { timeout: 15000, intervals: [1000] }).toBeGreaterThanOrEqual(3)
  await page.screenshot({ path: `artifacts/${native ? 'native' : 'browser'}-diagnostics.png` })
  await page.getByRole('button', { name: 'Close diagnostics' }).click()
  await page.setViewportSize({ width: 400, height: 740 })
  const mobile = await canvasIsVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `artifacts/${native ? 'native' : 'browser'}-narrow.png` })
  await page.getByRole('button', { name: 'Engine diagnostics' }).click()
  const overflow = await page.getByRole('complementary').evaluate(element => element.scrollWidth > element.clientWidth)
  expect(overflow).toBe(false)
  await page.screenshot({ path: `artifacts/${native ? 'native' : 'browser'}-narrow-diagnostics.png` })
  await page.getByRole('button', { name: 'Close diagnostics' }).click()
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext())
  await expect(page.getByRole('alert').filter({ hasText: 'Graphics context lost' })).toBeVisible()
  await expect(page.getByTestId('connection-status')).toHaveText(native ? 'Native core connected' : 'Browser preview')
  await page.getByRole('button', { name: 'Retry renderer' }).click()
  await expect(page.locator('canvas')).toBeVisible()
  await canvasIsVisible()
  expect(errors).toEqual([])
  console.log(JSON.stringify({ mode: native ? 'native-webview2' : 'browser-preview', desktopLitPixels: desktop.pixels, narrowLitPixels: mobile.pixels, idleFramesStable: true, cameraInteractive: true, rendererRecovery: true, pageErrors: errors }, null, 2))
} finally {
  await browser.close()
}
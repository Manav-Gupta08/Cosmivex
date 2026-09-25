import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

await mkdir('artifacts', { recursive: true })
const listener = createServer()
await new Promise((resolve, reject) => {
  listener.once('error', reject)
  listener.listen(9224, '127.0.0.1', () => listener.close(error => error ? reject(error) : resolve()))
})
const application = spawn('apps/desktop/src-tauri/target/release/universe-os.exe', [], {
  stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1' },
})
let browser
try {
  await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:9224') }).toPass({ timeout: 20000 })
  const page = browser.contexts()[0].pages()[0]
  await expect(page.getByTestId('connection-status')).toHaveText('Native core connected', { timeout: 15000 })
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  await session.send('Profiler.enable')
  async function measure(label) {
    const before = await session.send('Performance.getMetrics')
    await session.send('Profiler.start')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 15000)))
    const { profile } = await session.send('Profiler.stop')
    const after = await session.send('Performance.getMetrics')
    await writeFile(`artifacts/${label}.cpuprofile`, JSON.stringify(profile))
    const previous = new Map(before.metrics.map(metric => [metric.name, metric.value]))
    const durations = Object.fromEntries(after.metrics.filter(metric => /Duration|Timestamp/.test(metric.name)).map(metric => [metric.name, metric.value - previous.get(metric.name)]))
    const samples = new Map()
    for (const id of profile.samples ?? []) samples.set(id, (samples.get(id) ?? 0) + 1)
    const hot = profile.nodes.map(node => ({ name: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber, hits: samples.get(node.id) ?? 0 }))
      .sort((left, right) => right.hits - left.hits).slice(0, 15)
    console.log(JSON.stringify({ label, durations, hot }, null, 2))
  }
  await measure('resources-on')
  await page.getByRole('button', { name: 'Engine diagnostics' }).click()
  console.log('AFTER FRESH LAUNCH', await page.getByRole('complementary').innerText())
  await page.getByRole('checkbox', { name: 'Resource visuals' }).uncheck()
  await page.getByRole('button', { name: 'Close diagnostics' }).click()
  await measure('resources-off')
  await page.getByRole('button', { name: 'Engine diagnostics' }).click()
  console.log('AFTER DISABLING', await page.getByRole('complementary').innerText())
  await session.detach()
} finally {
  await browser?.close()
  if (application.exitCode === null) application.kill()
}
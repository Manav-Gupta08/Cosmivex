import { chromium, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const appPid = Number(process.env.UOS_TEST_APP_PID)
if (!Number.isSafeInteger(appPid) || appPid <= 0) throw new Error('Native app PID required')
const endpoint = process.env.UOS_TEST_ENDPOINT ?? 'http://127.0.0.1:9223'

let browser
try {
  await expect(async () => { browser = await chromium.connectOverCDP(endpoint) }).toPass({ timeout: 20000 })
  const page = browser.contexts()[0].pages()[0]
  await expect(page.getByTestId('connection-status')).toHaveText('Native core connected', { timeout: 15000 })
  const windowHandle = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${appPid}).MainWindowHandle.ToInt64().ToString()`], { windowsHide: true, encoding: 'utf8' }).trim()
  if (!/^[1-9][0-9]*$/.test(windowHandle)) throw new Error('Native app window missing')
  const setWindow = async command => {
    await expect(() => expect(execFileSync('powershell.exe', ['-NoProfile', '-Command', `
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle); }'
      $window = [IntPtr]::new(${windowHandle})
      [NativeWindow]::ShowWindowAsync($window, ${command}) | Out-Null
      [NativeWindow]::IsIconic($window) -eq ${command === 6 ? '$true' : '$false'}
    `], { windowsHide: true, encoding: 'utf8' }).trim()).toBe('True')).toPass({ timeout: 10000 })
    await expect.poll(() => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }))).toBe(command === 6)
  }
  await page.setViewportSize({ width: 1360, height: 820 })
  if (process.argv.includes('--minimize-only')) {
    await setWindow(6)
    try { await page.waitForTimeout(1500) } finally { await setWindow(9) }
  } else if (!process.argv.includes('--connect-only')) {
    await page.getByRole('button', { name: 'Universe view', exact: true }).click()
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
    await setWindow(6)
    try {
      await page.waitForTimeout(1500)
      const hiddenFrames = Number(await page.getByTestId('frames-rendered').innerText())
      await page.waitForTimeout(3000)
      expect(Number(await page.getByTestId('frames-rendered').innerText()) - hiddenFrames).toBe(0)
    } finally {
      await setWindow(9)
    }
    await page.getByRole('button', { name: 'Close diagnostics' }).click()
    const canvas = page.locator('canvas')
    const before = await canvas.screenshot()
    await canvas.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(async () => { expect((await canvas.screenshot()).equals(before)).toBe(false) }).toPass({ timeout: 5000 })
    console.log(JSON.stringify({ minimizedFramesStable: true, restoredCameraInteractive: true }))
  }
} finally {
  await browser?.close()
}
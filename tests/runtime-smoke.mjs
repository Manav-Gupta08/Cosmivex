import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { spawn, fork } from 'node:child_process'
import { PerspectiveCamera, Vector3 } from 'three'
import { createServer, createConnection } from 'node:net'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { verifyFilesystem } from './filesystem-smoke.mjs'

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

async function selectedStarPixels() {
  const screenshot = await page.screenshot({ clip: { x: 520, y: 250, width: 320, height: 320 } })
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 320
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const data = context.getImageData(0, 0, 320, 320).data
    let area = 0
    let brightness = 0
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index], green = data[index + 1], blue = data[index + 2]
      if (red > 60 && red > green * 1.12 && green > blue * 0.95) { area += 1; brightness += red + green + blue }
    }
    return { area, brightness: area ? brightness / area : 0 }
  }, [...screenshot])
}

async function verifyHistory() {
  const checkbox = page.getByRole('checkbox', { name: 'Record local history' })
  await expect(checkbox).not.toBeChecked()
  await checkbox.click()
  await expect(checkbox).toBeChecked({ timeout: 10000 })
  const sessions = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('history_sessions'))
  await expect.poll(async () => (await sessions()).find(session => session.endedMs === null)?.id, { timeout: 10000 }).not.toBeUndefined()
  const session = (await sessions()).find(row => row.endedMs === null)
  expect(session).toBeDefined()
  const workload = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { windowsHide: true })
  try {
    await expect.poll(async () => {
      const rows = await page.evaluate(id => window.__TAURI_INTERNALS__.invoke('history_events', { session: id, sinceMs: 0 }), session.id)
      return rows.some(row => row.payloadJson.includes(`"pid":${workload.pid}`))
    }, { timeout: 12000 }).toBe(true)
  } finally {
    if (workload.exitCode === null) workload.kill()
    await checkbox.click()
  }
  await expect(checkbox).not.toBeChecked({ timeout: 10000 })
  await expect.poll(async () => (await sessions()).find(row => row.id === session.id)?.endedMs, { timeout: 10000 }).toBeGreaterThan(0)
  console.log(JSON.stringify({ historyOptIn: true, recordedPid: workload.pid, sessionClosed: true }))
}

async function verifyResources() {
  const probe = fork(new URL('./process-workload.mjs', import.meta.url), ['--resource-probe'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true })
  const command = value => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Resource workload command timed out: ${value}`)), 10000)
    probe.once('message', message => { clearTimeout(timer); resolve(message) })
    if (value !== 'ready') probe.send(value)
  })
  try {
    await command('ready')
    const pid = String(probe.pid)
    await page.getByRole('textbox', { name: 'Search processes' }).fill(pid)
    await expect(page.getByRole('complementary', { name: 'Process list' }).getByRole('button', { name: 'node.exe', exact: true })).toBeVisible({ timeout: 8000 })
    await page.getByRole('textbox', { name: 'Search processes' }).press('Enter')
    await expect(page.getByTestId('process-pid')).toHaveText(pid)
    await expect.poll(async () => Number.parseInt(await page.getByTestId('cpu-level').innerText()), { timeout: 10000 }).toBe(0)
    const initialMemory = Number.parseInt(await page.getByTestId('memory-level').innerText())
    await expect.poll(async () => (await selectedStarPixels()).area, { timeout: 5000 }).toBeGreaterThan(1000)
    const quiet = await selectedStarPixels()
    await command('cpu-on')
    await expect.poll(async () => Number.parseFloat(await page.getByTestId('process-cpu').innerText()), { timeout: 15000 }).toBeGreaterThanOrEqual(10)
    await expect.poll(async () => (await selectedStarPixels()).brightness, { timeout: 6000 }).toBeGreaterThan(quiet.brightness * 1.15)
    const busy = await selectedStarPixels()
    await page.screenshot({ path: 'artifacts/native-resource-cpu.png' })
    await page.getByRole('button', { name: 'Recent activity', exact: true }).click()
    const spike = page.locator(`li[data-kind="RESOURCE_SPIKE"][data-pid="${pid}"]`)
    await expect(spike).toBeVisible({ timeout: 12000 })
    await expect(spike).toContainText('10% threshold')
    await page.screenshot({ path: 'artifacts/native-resource-spike.png' })
    expect(await spike.count()).toBe(1)
    await command('cpu-off')
    await page.getByRole('button', { name: 'Close activity' }).click()
    await expect.poll(async () => Number.parseInt(await page.getByTestId('cpu-level').innerText()), { timeout: 12000 }).toBe(0)
    const small = await selectedStarPixels()
    await command('memory-up')
    await expect.poll(async () => Number.parseInt(await page.getByTestId('memory-level').innerText()), { timeout: 10000 }).toBeGreaterThan(initialMemory + 3)
    await expect.poll(async () => (await selectedStarPixels()).area, { timeout: 6000 }).toBeGreaterThan(small.area * 1.25)
    const large = await selectedStarPixels()
    const largeMemory = await page.getByTestId('process-memory').innerText()
    await page.screenshot({ path: 'artifacts/native-resource-memory.png' })
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
    await page.getByRole('checkbox', { name: 'Resource visuals' }).uncheck()
    await expect.poll(async () => (await selectedStarPixels()).area, { timeout: 5000 }).toBeLessThan(large.area * 0.75)
    await page.getByRole('checkbox', { name: 'Resource visuals' }).check()
    await page.getByRole('button', { name: 'Close diagnostics' }).click()
    expect(Number.parseFloat(await page.getByTestId('process-memory').innerText())).toBeGreaterThan(300)
    await page.setViewportSize({ width: 400, height: 740 })
    expect(await page.getByRole('complementary', { name: 'Process details' }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
    await page.screenshot({ path: 'artifacts/native-narrow-resources.png' })
    await page.setViewportSize({ width: 1360, height: 820 })
    await page.getByRole('button', { name: 'Close process details' }).click()
    console.log(JSON.stringify({ resourceProbePid: pid, cpuBrightnessBefore: quiet.brightness, cpuBrightnessAfter: busy.brightness, memoryAreaBefore: small.area, memoryAreaAfter: large.area, workingSet: largeMemory, resourceToggleVerified: true }))
  } finally { if (probe.exitCode === null) probe.kill() }
}

async function verifyNetwork() {
  let accepted
  const server = createServer(socket => { accepted = socket; socket.on('error', () => {}) })
  const udp = createSocket('udp4')
  let client
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    udp.bind(0, '127.0.0.1')
    await once(udp, 'listening')
    const serverPort = server.address().port
    const udpPort = udp.address().port
    client = createConnection({ host: '127.0.0.1', port: serverPort })
    client.on('error', () => {})
    await once(client, 'connect')
    const clientPort = client.localPort
    await page.getByRole('button', { name: 'Network view', exact: true }).click()
    await expect.poll(async () => Number(await page.getByTestId('connection-count').innerText()), { timeout: 10000 }).toBeGreaterThan(0)
    await page.getByRole('textbox', { name: 'Search network' }).fill(String(clientPort))
    const tcp = page.getByRole('button', { name: `TCP 127.0.0.1:${clientPort} to 127.0.0.1:${serverPort}, PID ${process.pid}`, exact: true })
    await expect(tcp).toBeVisible({ timeout: 10000 })
    await tcp.click()
    await expect(page.getByTestId('network-state')).toHaveText('ESTABLISHED')
    await expect(page.getByTestId('network-local')).toHaveText(`127.0.0.1:${clientPort}`)
    await expect(page.getByTestId('network-remote')).toHaveText(`127.0.0.1:${serverPort}`)
    await expect(page.getByTestId('network-pid')).toHaveText(String(process.pid))
    await page.screenshot({ path: 'artifacts/native-network-connection.png' })
    await page.getByRole('button', { name: 'Close network details' }).click()
    const networkCamera = new PerspectiveCamera(48, 1360 / 820, 0.1, 600)
    networkCamera.position.set(4, 2, 5)
    networkCamera.lookAt(0, 0, 0)
    networkCamera.updateMatrixWorld()
    const endpointPoint = new Vector3(0.45, 0, 0).project(networkCamera)
    await expect(async () => {
      await page.mouse.click((endpointPoint.x + 1) * 680, (1 - endpointPoint.y) * 410)
      await expect(page.getByTestId('network-local')).toHaveText(`127.0.0.1:${clientPort}`, { timeout: 500 })
    }).toPass({ timeout: 8000 })
    await page.getByRole('button', { name: `Open process (${process.pid})`, exact: true }).click()
    await expect(page.getByTestId('process-pid')).toHaveText(String(process.pid))
    await page.getByRole('button', { name: 'Close process details' }).click()
    await page.getByRole('button', { name: 'Network view', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search network' }).fill(String(udpPort))
    const bound = page.getByRole('button', { name: `UDP 127.0.0.1:${udpPort}, PID ${process.pid}`, exact: true })
    await expect(bound).toBeVisible({ timeout: 10000 })
    await bound.click()
    await expect(page.getByTestId('network-state')).toHaveText('BOUND')
    await expect(page.getByTestId('network-remote')).toHaveText('Not observed')
    udp.close()
    await expect(page.getByTestId('network-status')).toHaveText('No longer observed', { timeout: 10000 })
    await page.getByRole('button', { name: 'Close network details' }).click()
    await page.getByRole('textbox', { name: 'Search network' }).fill('')
    await page.getByRole('button', { name: 'Close network list' }).click()
    await page.getByRole('button', { name: 'Reset camera' }).click()
    await canvasIsVisible()
    await page.screenshot({ path: 'artifacts/native-network.png' })
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
    await expect.poll(async () => Number(await page.getByTestId('network-bridges').innerText())).toBeGreaterThan(0)
    await expect(page.getByTestId('process-instances')).toHaveText('0')
    await expect(page.getByTestId('camera-motion')).toHaveText('Still', { timeout: 10000 })
    const sequence = BigInt(await page.getByTestId('sequence').innerText())
    const before = Number(await page.getByTestId('frames-rendered').innerText())
    await expect.poll(async () => BigInt(await page.getByTestId('sequence').innerText()) >= sequence + 4n, { timeout: 10000 }).toBe(true)
    expect(Number(await page.getByTestId('frames-rendered').innerText()) - before).toBeLessThan(24)
    await page.getByRole('button', { name: 'Close diagnostics' }).click()
    await page.getByRole('button', { name: 'Network list', exact: true }).click()
    expect(await page.getByRole('row').count()).toBeLessThanOrEqual(51)
    await page.getByRole('tab', { name: 'Interfaces' }).click()
    await page.getByRole('table').locator('tbody button').first().click()
    await expect(page.getByText('Interface / all processes', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 400, height: 740 })
    expect(await page.getByRole('complementary', { name: 'Network details' }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
    await page.screenshot({ path: 'artifacts/native-narrow-interface.png' })
    await page.getByRole('button', { name: 'Close network details' }).click()
    await page.getByRole('button', { name: 'Reset camera' }).click()
    await canvasIsVisible()
    await page.screenshot({ path: 'artifacts/native-narrow-network.png' })
    await page.setViewportSize({ width: 1360, height: 820 })
    await page.getByRole('checkbox', { name: 'Network collection' }).click()
    await expect(page.getByRole('checkbox', { name: 'Network collection' })).not.toBeChecked({ timeout: 6000 })
    await expect(page.getByTestId('connection-count')).toHaveText('0')
    await page.getByRole('button', { name: 'Universe view', exact: true }).click()
    await expect.poll(async () => Number(await page.getByTestId('process-count').innerText())).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Network view', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Network collection' }).click()
    await expect(page.getByRole('checkbox', { name: 'Network collection' })).toBeChecked({ timeout: 6000 })
    await page.getByRole('button', { name: 'Universe view', exact: true }).click()
    console.log(JSON.stringify({ realTcpOwner: process.pid, clientPort, serverPort, udpPort, udpRemovalVerified: true, networkToggleIndependent: true }))
  } finally {
    client?.destroy()
    accepted?.destroy()
    server.close()
    try { udp.close() } catch {}
  }
}

try {
  if (!native) await page.goto(endpoint)
  await expect(page.getByTestId('connection-status')).toHaveText(native ? 'Native core connected' : 'Browser preview', { timeout: 20000 })
  if (native) await expect.poll(async () => Number(await page.getByTestId('process-count').innerText()), { timeout: 10000 }).toBeGreaterThan(0)
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
    for (const [profile, interval] of [['Eco', '2000 ms'], ['Cinematic', '1000 ms'], ['Normal', '1000 ms']]) {
      await page.getByRole('button', { name: `${profile} profile` }).click()
      await expect(page.getByRole('button', { name: `${profile} profile` })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('health-interval')).toHaveText(interval)
    }
    const sequence = BigInt(await page.getByTestId('sequence').innerText())
    await expect.poll(async () => BigInt(await page.getByTestId('sequence').innerText()) > sequence, { timeout: 8000 }).toBe(true)
    await page.reload()
    await expect(page.getByTestId('connection-status')).toHaveText('Native core connected')
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
    await expect.poll(async () => Number(await page.getByTestId('process-instances').innerText()), { timeout: 6000 }).toBeGreaterThan(0)
    await expect.poll(async () => Number(await page.getByTestId('delta-batches').innerText()), { timeout: 6000 }).toBeGreaterThan(0)
    const fullStates = Number(await page.getByTestId('full-snapshots').innerText())
    await page.getByRole('button', { name: 'Resync stream', exact: true }).click()
    await expect.poll(async () => Number(await page.getByTestId('full-snapshots').innerText())).toBeGreaterThan(fullStates)
    const debuggerSession = await page.context().newCDPSession(page)
    await debuggerSession.send('Debugger.enable')
    await debuggerSession.send('Debugger.pause')
    const transient = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 4500)'], { stdio: 'ignore', windowsHide: true })
    const transientPid = transient.pid
    try {
      await expect.poll(() => transient.exitCode, { timeout: 8000, intervals: [250] }).toBe(0)
      await debuggerSession.send('Debugger.resume')
      await debuggerSession.detach()
      await expect(page.getByTestId('connection-status')).toHaveText('Native core connected', { timeout: 8000 })
      await page.getByRole('button', { name: 'Close diagnostics' }).click()
      await page.getByRole('button', { name: 'Recent activity', exact: true }).click()
      await expect(page.locator(`li[data-kind="PROCESS_CREATED"][data-pid="${transientPid}"]`)).toBeVisible({ timeout: 6000 })
      await expect(page.locator(`li[data-kind="PROCESS_TERMINATED"][data-pid="${transientPid}"]`)).toBeVisible({ timeout: 6000 })
      await page.screenshot({ path: 'artifacts/native-lifecycle.png' })
      await page.setViewportSize({ width: 400, height: 740 })
      expect(await page.getByRole('complementary', { name: 'Recent activity' }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      await page.screenshot({ path: 'artifacts/native-narrow-activity.png' })
      await page.setViewportSize({ width: 1360, height: 820 })
      await page.getByRole('button', { name: 'Close activity' }).click()
      await page.getByRole('button', { name: 'Engine diagnostics' }).click()
      console.log(JSON.stringify({ heldAcknowledgementRecovery: true, transientPid, lifecycleRetained: true }))
    } finally {
      if (transient.exitCode === null) transient.kill()
      await debuggerSession.send('Debugger.resume').catch(() => {})
      await debuggerSession.detach().catch(() => {})
    }
    await page.getByRole('button', { name: 'Close diagnostics' }).click()
    const workloadPid = process.env.UOS_TEST_PID
    if (workloadPid) {
      await page.getByRole('textbox', { name: 'Search processes' }).fill(workloadPid)
      await page.getByRole('textbox', { name: 'Search processes' }).press('Enter')
      await expect(page.getByTestId('process-pid')).toHaveText(workloadPid)
      await expect(page.getByTestId('process-parent-pid')).toHaveText(process.env.UOS_TEST_PARENT_PID)
      await expect.poll(async () => Number.parseFloat(await page.getByTestId('process-cpu').innerText()), { timeout: 10000 }).toBeGreaterThan(0)
      await expect.poll(async () => Number.parseFloat(await page.getByTestId('process-memory').innerText()), { timeout: 10000 }).toBeGreaterThan(32)
      const observedCpu = Number.parseFloat(await page.getByTestId('process-cpu').innerText())
      const observedMemory = Number.parseFloat(await page.getByTestId('process-memory').innerText())
      const referenceCpu = Number(process.env.UOS_TEST_CPU)
      const referenceMemory = Number(process.env.UOS_TEST_MEMORY_MIB)
      expect(Math.abs(observedCpu - referenceCpu)).toBeLessThan(Math.max(1, referenceCpu))
      expect(Math.abs(observedMemory - referenceMemory)).toBeLessThan(32)
      await page.screenshot({ path: 'artifacts/native-process.png' })
      console.log(JSON.stringify({ workloadPid, observedCpu, referenceCpu, observedMemoryMiB: observedMemory, referenceMemoryMiB: referenceMemory }))
      await page.getByRole('button', { name: 'Close process details' }).click()
      await page.getByRole('textbox', { name: 'Search processes' }).fill(workloadPid)
      await page.getByRole('button', { name: 'Close process list' }).click()
      await expect(async () => {
        const viewport = page.viewportSize()
        await page.mouse.click(viewport.width / 2, viewport.height / 2)
        await expect(page.getByTestId('process-pid')).toHaveText(workloadPid, { timeout: 500 })
      }).toPass({ timeout: 8000 })
      await page.getByRole('textbox', { name: 'Search processes' }).fill('')
      await page.getByRole('button', { name: 'Close process list' }).click()
      await page.setViewportSize({ width: 400, height: 740 })
      expect(await page.getByRole('complementary', { name: 'Process details' }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      await page.screenshot({ path: 'artifacts/native-narrow-process.png' })
      await page.setViewportSize({ width: 1360, height: 820 })
      await expect(page.getByTestId('parent-evidence')).toHaveText('verified')
      await page.getByRole('button', { name: 'Open galaxy', exact: true }).click()
      await expect(page.getByTestId('galaxy-root-pid')).toHaveText(workloadPid)
      await expect(page.getByTestId('galaxy-member-count')).toHaveText('2')
      await page.screenshot({ path: 'artifacts/native-galaxy.png' })
      const childPid = process.env.UOS_TEST_CHILD_PID
      await page.getByRole('button', { name: `node.exe, PID ${childPid}`, exact: true }).click()
      await expect(page.getByTestId('process-pid')).toHaveText(childPid)
      await expect(page.getByTestId('process-parent-pid')).toHaveText(workloadPid)
      await expect(page.getByTestId('parent-evidence')).toHaveText('verified')
      await page.getByRole('button', { name: `Open parent (${workloadPid})`, exact: true }).click()
      await expect(page.getByTestId('process-pid')).toHaveText(workloadPid)
      await page.getByRole('button', { name: 'Open galaxy', exact: true }).click()
      await page.setViewportSize({ width: 400, height: 740 })
      expect(await page.getByRole('complementary', { name: 'Galaxy details' }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      await page.screenshot({ path: 'artifacts/native-narrow-galaxy.png' })
      await page.setViewportSize({ width: 1360, height: 820 })
      await page.getByRole('button', { name: 'Close galaxy details' }).click()
      const radius = 1.6 + Math.sqrt(2) * 0.5
      const camera = new PerspectiveCamera(48, 1360 / 820, 0.1, 600)
      camera.position.set(8, 4, 10)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      const ringPoint = new Vector3(radius * 0.98, -0.3, 0).project(camera)
      await expect(async () => {
        await page.mouse.click((ringPoint.x + 1) * 680, (1 - ringPoint.y) * 410)
        await expect(page.getByTestId('galaxy-root-pid')).toHaveText(workloadPid, { timeout: 500 })
      }).toPass({ timeout: 8000 })
      await page.getByRole('button', { name: `node.exe, PID ${workloadPid}`, exact: true }).click()
      process.kill(Number(workloadPid))
      await expect(page.getByTestId('process-status')).toHaveText('No longer observed', { timeout: 6000 })
      await page.getByRole('button', { name: 'Close process details' }).click()
    }
    await verifyResources()
    await verifyNetwork()
    await verifyFilesystem(page, canvasIsVisible)
    await page.getByRole('button', { name: 'Process list', exact: true }).click()
    await expect(page.getByRole('table')).toBeVisible()
    expect(await page.getByRole('row').count()).toBeLessThanOrEqual(51)
    await page.setViewportSize({ width: 400, height: 740 })
    expect(await page.getByRole('table').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
    await page.screenshot({ path: 'artifacts/native-narrow-list.png' })
    await page.setViewportSize({ width: 1360, height: 820 })
    await page.getByRole('button', { name: 'Close process list' }).click()
    await page.getByRole('button', { name: 'Galaxy list', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Galaxy list' })).toBeVisible()
    expect(await page.getByRole('row').count()).toBeLessThanOrEqual(51)
    await page.getByRole('button', { name: 'Close galaxy list' }).click()
    await page.getByRole('button', { name: 'Hierarchy view', exact: true }).click()
    await page.getByRole('button', { name: 'Reset camera' }).click()
    await canvasIsVisible()
    await page.screenshot({ path: 'artifacts/native-hierarchy.png' })
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
    await expect.poll(async () => Number(await page.getByTestId('parent-links').innerText()), { timeout: 5000 }).toBeGreaterThan(0)
    await expect(page.getByTestId('galaxy-instances')).toHaveText('0')
    await page.getByRole('button', { name: 'Close diagnostics' }).click()
    await page.setViewportSize({ width: 400, height: 740 })
    await canvasIsVisible()
    await page.screenshot({ path: 'artifacts/native-narrow-hierarchy.png' })
    await page.setViewportSize({ width: 1360, height: 820 })
    await page.getByRole('button', { name: 'Universe view', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Process collection' }).click()
    await expect(page.getByRole('checkbox', { name: 'Process collection' })).not.toBeChecked({ timeout: 6000 })
    await expect(page.getByTestId('process-count')).toHaveText('0')
    await expect(page.getByTestId('galaxy-count')).toHaveText('0')
    await page.getByRole('checkbox', { name: 'Process collection' }).click()
    await expect(page.getByRole('checkbox', { name: 'Process collection' })).toBeChecked({ timeout: 6000 })
    await expect.poll(async () => Number(await page.getByTestId('process-count').innerText())).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Reset camera' }).click()
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
  } else {
    await expect(page.getByRole('button', { name: 'Eco profile' })).toBeDisabled()
    await expect(page.getByTestId('sequence')).toHaveText('Unavailable')
    await expect(page.getByRole('checkbox', { name: 'Record local history' })).toBeDisabled()
  }
  if (native) {
    await expect(page.getByTestId('camera-motion')).toHaveText('Still', { timeout: 10000 })
    const sequence = BigInt(await page.getByTestId('sequence').innerText())
    const before = Number(await page.getByTestId('frames-rendered').innerText())
    await expect.poll(async () => BigInt(await page.getByTestId('sequence').innerText()) >= sequence + 4n, { timeout: 10000 }).toBe(true)
    const dataFrames = Number(await page.getByTestId('frames-rendered').innerText()) - before
    expect(dataFrames).toBeLessThan(24)
    console.log(JSON.stringify({ dataDrivenFramesAcrossFourSamples: dataFrames }))
    await page.getByRole('checkbox', { name: 'Resource visuals' }).uncheck()
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
  if (native) console.log(await page.getByRole('complementary').innerText())
  if (native) await page.getByRole('checkbox', { name: 'Resource visuals' }).check()
  if (native) await verifyHistory()
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
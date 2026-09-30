import { chromium, expect } from '@playwright/test'
import { rolldown } from 'rolldown'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

const seconds = Number(process.argv[2] ?? 10)
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 60) throw new Error('Scale duration must be 5-60 seconds per count')
const bundle = await rolldown({ input: 'qualification-entry', platform: 'browser', plugins: [{
  name: 'isolated-scale',
  resolveId(id) { if (id === 'qualification-entry') return id },
  load(id) { if (id === 'qualification-entry') return `export * from 'three'; export { buildLayout, selectLodIds } from './apps/desktop/universe/layout.ts'; export { GpuTimer } from './apps/desktop/universe/gpu-timer.ts';` },
}] })
const { output } = await bundle.generate({ format: 'iife', name: 'scaleApi', codeSplitting: false })
const source = output.find(item => item.type === 'chunk').code
await bundle.close()
await mkdir('artifacts', { recursive: true })
const listener = createServer()
await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(9226, '127.0.0.1', () => listener.close(resolve)) })
const application = spawn('apps/desktop/src-tauri/target/release/universe-os.exe', [], { stdio: 'ignore', env: {
  ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9226 --remote-debugging-address=127.0.0.1',
} })
let browser
try {
  await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:9226') }).toPass({ timeout: 20000 })
  const page = browser.contexts()[0].pages()[0]
  await page.exposeFunction('captureScale', async count => { await page.screenshot({ path: `artifacts/scale-${count}-${page.viewportSize().width}.png` }) })
  await expect(page.getByTestId('connection-status')).toHaveText('Native core connected')
  await page.getByRole('checkbox', { name: 'Process collection', exact: true }).click()
  await page.getByRole('button', { name: 'Network view', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Network collection', exact: true }).click()
  const cdp = await page.context().newCDPSession(page)
  const loaded = await cdp.send('Runtime.evaluate', { expression: source })
  if (loaded.exceptionDetails) throw new Error(loaded.exceptionDetails.text)
  const results = []
  for (const viewport of [{ width: 1360, height: 820 }, { width: 400, height: 740 }]) {
    await page.setViewportSize(viewport)
    const report = await page.evaluate(async seconds => {
      const { Scene, PerspectiveCamera, WebGLRenderer, InstancedMesh, SphereGeometry, MeshBasicMaterial, Object3D, Color, Raycaster, Vector2, buildLayout, selectLodIds, GpuTimer } = window.scaleApi
      const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'low-power' })
      renderer.setPixelRatio(1)
      renderer.setSize(innerWidth, innerHeight)
      Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '9999' })
      renderer.domElement.dataset.testid = 'synthetic-canvas'
      renderer.domElement.setAttribute('aria-label', 'Isolated synthetic scale qualification')
      document.body.append(renderer.domElement)
      const reports = []
      try {
        for (const count of [10000, 50000, 100000]) {
          const ids = Array.from({ length: count }, (_, index) => `${index + 1}:1`)
          const selected = ids.at(-1)
          const snapshot = { rows: ids.map(id => ({ id, parentId: null, galaxyId: 'g:1:1', depth: 0 })), galaxies: [{ id: 'g:1:1', rootId: '1:1', processCount: count }] }
          let started = performance.now()
          const layout = buildLayout(snapshot)
          const topologyMs = performance.now() - started
          started = performance.now()
          const visible = selectLodIds(ids, selected, 1024)
          const selectionMs = performance.now() - started
          if (visible.length !== 1024 || !visible.includes(selected)) throw new Error('Aggregate selection failed')
          const scene = new Scene()
          scene.background = new Color('#090c0e')
          const camera = new PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 600)
          const center = layout.galaxyPositions.get('g:1:1')
          const mesh = new InstancedMesh(new SphereGeometry(0.19, 8, 6), new MeshBasicMaterial(), 1024)
          const transform = new Object3D()
          const tint = new Color()
          visible.forEach((id, index) => {
            transform.position.set(...layout.universe.get(id))
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
            mesh.setColorAt(index, tint.set(id === selected ? '#e7a194' : '#adcfbd'))
          })
          mesh.instanceMatrix.needsUpdate = true
          mesh.instanceColor.needsUpdate = true
          mesh.computeBoundingSphere()
          scene.add(mesh)
          const cpu = [], gpu = [], intervals = []
          const timer = new GpuTimer(renderer.getContext(), milliseconds => { gpu.push(milliseconds) })
          let previous = null
          const begin = performance.now()
          await new Promise(resolve => {
            const draw = now => {
              if (now - begin >= seconds * 1000) { resolve(); return }
              if (previous !== null) intervals.push(now - previous)
              previous = now
              const radius = 18 * Math.max(1, 1.15 / camera.aspect)
              camera.position.set(center[0] + Math.cos((now - begin) / 1800) * radius, center[1] + 10, center[2] + Math.sin((now - begin) / 1800) * radius)
              camera.lookAt(...center)
              const started = performance.now()
              timer.begin(started)
              renderer.render(scene, camera)
              timer.end()
              cpu.push(performance.now() - started)
              requestAnimationFrame(draw)
            }
            requestAnimationFrame(draw)
          })
          const pixels = new Uint8Array(innerWidth * innerHeight * 4)
          renderer.render(scene, camera)
          renderer.getContext().readPixels(0, 0, innerWidth, innerHeight, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels)
          let litPixels = 0
          for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] > 40 || pixels[offset + 1] > 40 || pixels[offset + 2] > 40) litPixels++
          if (litPixels < 100 || cpu.length < seconds * 10) throw new Error('Blank or stalled aggregate renderer')
          await window.captureScale(count)
          const selectedPosition = layout.universe.get(selected)
          camera.position.set(selectedPosition[0], selectedPosition[1], selectedPosition[2] + 0.5)
          camera.lookAt(...selectedPosition)
          camera.updateMatrixWorld()
          scene.updateMatrixWorld(true)
          const ray = new Raycaster()
          ray.setFromCamera(new Vector2(0, 0), camera)
          const selectedPickable = ray.intersectObject(mesh).some(hit => visible[hit.instanceId] === selected)
          if (!selectedPickable) throw new Error('Selected aggregate member is not pickable')
          const percentile = samples => samples.length ? [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1] : null
          reports.push({ count, displayed: visible.length, topologyMs, selectionMs, frames: cpu.length, cpuSubmissionP95Ms: percentile(cpu), gpuP95Ms: percentile(gpu), movingIntervalP95Ms: percentile(intervals), litPixels, selectedPickable })
          timer.dispose()
          mesh.geometry.dispose()
          mesh.material.dispose()
          mesh.dispose()
        }
        return reports
      } finally {
        renderer.dispose()
        renderer.forceContextLoss()
        renderer.domElement.remove()
      }
    }, seconds)
    results.push({ viewport, report })
  }
  await writeFile('artifacts/scale-release.json', JSON.stringify({ synthetic: true, secondsPerCount: seconds, liveProcessCap: 4096, renderedAggregateLimit: 1024, results }, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  if (application.exitCode === null) application.kill()
}
import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import type { RootState } from '@react-three/fiber'
import { afterEach, expect, it, vi } from 'vitest'
import { GpuTimer } from '../../apps/desktop/universe/gpu-timer'
import { RenderBudget } from '../../apps/desktop/universe/RenderBudget'

const renderer = vi.hoisted(() => ({
  state: null as unknown as RootState,
  frames: new Map<number, (state: RootState) => void>(),
  native: { isMinimized: vi.fn(), onFocusChanged: vi.fn(), onResized: vi.fn() },
}))
vi.mock('@react-three/fiber', () => ({
  useThree: () => renderer.state,
  useFrame: (callback: (state: RootState) => void, priority: number) => renderer.frames.set(priority, callback),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => renderer.native }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); renderer.frames.clear() })

function renderState() {
  renderer.state = {
    gl: { domElement: document.createElement('canvas'), getContext: () => ({ getExtension: () => null }), render: vi.fn(), info: { render: { calls: 1, triangles: 8 } } },
    setFrameloop: vi.fn(), invalidate: vi.fn(),
  } as unknown as RootState
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  return renderer.state
}

it('bounds pending GPU queries, polls without blocking, and deletes every query', () => {
  let available = false
  let disjoint = false
  const context = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }),
    isContextLost: () => false,
    getParameter: () => disjoint,
    createQuery: vi.fn(() => ({})), beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(),
    getQueryParameter: (_query: unknown, field: number) => field === 1 ? available : 2e6,
  }
  const record = vi.fn()
  const timer = new GpuTimer(context as unknown as WebGL2RenderingContext, record)
  for (let index = 0; index < 20; index++) { timer.begin(performance.now()); timer.end() }
  expect(context.createQuery).toHaveBeenCalledTimes(4)
  expect(record).not.toHaveBeenCalled()
  available = true
  timer.begin(performance.now())
  timer.end()
  expect(record).toHaveBeenCalledTimes(4)
  expect(record).toHaveBeenCalledWith(2, expect.any(Number), expect.any(Number))
  disjoint = true
  timer.begin(performance.now())
  expect(context.deleteQuery).toHaveBeenCalledTimes(5)
  timer.dispose()
  expect(context.deleteQuery).toHaveBeenCalledTimes(5)
})

it('does not submit queries when GPU timers are unavailable', () => {
  const context = { getExtension: () => null, createQuery: vi.fn() }
  const timer = new GpuTimer(context as unknown as WebGL2RenderingContext, vi.fn())
  expect(timer.supported).toBe(false)
  timer.begin(0)
  timer.end()
  timer.dispose()
  expect(context.createQuery).not.toHaveBeenCalled()
})

it('ignores stale minimize replies and releases native and context listeners', async () => {
  const state = renderState()
  vi.stubGlobal('__TAURI_INTERNALS__', {})
  const pending: ((minimized: boolean) => void)[] = []
  renderer.native.isMinimized.mockImplementation(() => new Promise<boolean>(resolve => pending.push(resolve)))
  const unlistenFocus = vi.fn()
  const unlistenResize = vi.fn()
  renderer.native.onFocusChanged.mockResolvedValue(unlistenFocus)
  renderer.native.onResized.mockResolvedValue(unlistenResize)
  const failure = vi.fn()
  const view = render(createElement(RenderBudget, { profile: 'normal', onFailure: failure }))
  document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => pending[1](true))
  expect(state.setFrameloop).toHaveBeenLastCalledWith('never')
  await act(async () => pending[0](false))
  expect(state.setFrameloop).toHaveBeenCalledTimes(1)
  document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => pending[2](false))
  expect(state.setFrameloop).toHaveBeenLastCalledWith('demand')
  expect(state.invalidate).toHaveBeenCalledTimes(1)
  const lost = new Event('webglcontextlost', { cancelable: true })
  state.gl.domElement.dispatchEvent(lost)
  expect(lost.defaultPrevented).toBe(true)
  expect(failure).toHaveBeenCalledTimes(1)
  document.dispatchEvent(new Event('visibilitychange'))
  view.unmount()
  await act(async () => pending[3](true))
  expect(state.setFrameloop).toHaveBeenCalledTimes(2)
  expect(unlistenFocus).toHaveBeenCalledTimes(1)
  expect(unlistenResize).toHaveBeenCalledTimes(1)
  state.gl.domElement.dispatchEvent(new Event('webglcontextlost'))
  expect(failure).toHaveBeenCalledTimes(1)
})

it('caps Eco submissions while preserving a pending redraw', () => {
  const state = renderState()
  let now = 100
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  render(createElement(RenderBudget, { profile: 'eco', onFailure: vi.fn() }))
  const draw = () => { renderer.frames.get(-100)!(state); renderer.frames.get(1)!(state) }
  draw()
  now += 16
  draw()
  expect(state.gl.render).toHaveBeenCalledTimes(1)
  expect(state.invalidate).toHaveBeenCalledTimes(2)
  now += 17
  draw()
  expect(state.gl.render).toHaveBeenCalledTimes(2)
})
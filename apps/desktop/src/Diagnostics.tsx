import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useCoreStore } from './state/core'
import { renderMetrics } from '../universe/metrics'

export function Diagnostics({ close }: { close: () => void }) {
  const frame = useCoreStore(state => state.frame)
  const status = useCoreStore(state => state.status)
  const [metrics, setMetrics] = useState({ fps: 0, bytesPerSecond: 0, ...renderMetrics })
  useEffect(() => {
    let previousTime = performance.now()
    let previousFrames = renderMetrics.frames
    let previousBytes = useCoreStore.getState().bytesReceived
    const timer = setInterval(() => {
      const now = performance.now()
      const bytes = useCoreStore.getState().bytesReceived
      const seconds = (now - previousTime) / 1000
      setMetrics({ ...renderMetrics, fps: (renderMetrics.frames - previousFrames) / seconds, bytesPerSecond: Math.max(0, bytes - previousBytes) / seconds })
      previousFrames = renderMetrics.frames
      previousBytes = bytes
      previousTime = now
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  return <aside className="diagnostics" aria-label="Performance and core details">
    <div className="panel-heading"><h2>Engine diagnostics</h2><button className="icon-button" aria-label="Close diagnostics" title="Close diagnostics" onClick={close}><X size={17} /></button></div>
    <div className="panel-section"><h3>Native core</h3><dl>
      <dt>Connection</dt><dd>{status}</dd>
      <dt>ABI / protocol</dt><dd>{frame ? `${frame.abiVersion} / ${frame.protocolVersion}` : 'Unavailable'}</dd>
      <dt>Sequence</dt><dd data-testid="sequence">{frame?.sequence ?? 'Unavailable'}</dd>
      <dt>Core uptime</dt><dd>{frame ? `${(frame.uptimeMs / 1000).toFixed(0)} s` : 'Unavailable'}</dd>
      <dt>Health interval</dt><dd data-testid="health-interval">{frame ? `${frame.intervalMs} ms` : 'Unavailable'}</dd>
      <dt>Collectors enabled</dt><dd>{frame?.enabledCollectors ?? 'Unavailable'}</dd>
    </dl></div>
    <div className="panel-section"><h3>Renderer & transport</h3><dl>
      <dt>Render cadence</dt><dd>{metrics.fps < 0.5 ? 'Idle' : `${metrics.fps.toFixed(0)} fps`}</dd>
      <dt>Frames rendered</dt><dd data-testid="frames-rendered">{metrics.frames}</dd>
      <dt>Last draw calls</dt><dd>{metrics.drawCalls}</dd>
      <dt>CPU submission</dt><dd>{metrics.frames ? `${metrics.submissionMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>GPU frame time</dt><dd>Unavailable</dd>
      <dt>Visible entities</dt><dd>0</dd>
      <dt>Health payload RX</dt><dd>{status === 'connected' ? `${metrics.bytesPerSecond.toFixed(0)} B/s` : 'Unavailable'}</dd>
      <dt>Telemetry events</dt><dd>Not collected</dd>
      <dt>Core / frontend CPU</dt><dd>Not measured</dd>
      <dt>Memory</dt><dd>Not measured</dd>
    </dl></div>
    <div className="panel-section"><h3>Collection permissions</h3><p>Standard user. No collectors enabled. History off.</p></div>
  </aside>
}
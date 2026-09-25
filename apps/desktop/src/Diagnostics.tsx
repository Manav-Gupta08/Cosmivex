import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useCoreStore } from './state/core'
import { renderMetrics } from '../universe/metrics'
import { resyncCore } from './transport'

export function Diagnostics({ close }: { close: () => void }) {
  const frame = useCoreStore(state => state.frame)
  const status = useCoreStore(state => state.status)
  const lastDelivery = useCoreStore(state => state.lastDelivery)
  const fullSnapshots = useCoreStore(state => state.fullSnapshots)
  const deltaBatches = useCoreStore(state => state.deltaBatches)
  const changedRows = useCoreStore(state => state.changedRows)
  const cursor = useCoreStore(state => state.eventCursor)
  const evictions = useCoreStore(state => state.evictedEvents)
  const resourceVisuals = useCoreStore(state => state.resourceVisuals)
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
      <dt>Process collector</dt><dd>{frame ? frame.enabledCollectors ? 'On' : 'Off' : 'Unavailable'}</dd>
      <dt>Network collector</dt><dd>{frame ? frame.network.enabled ? 'On' : 'Off' : 'Unavailable'}</dd>
    </dl></div>
    <div className="panel-section"><h3>Renderer & transport</h3><dl>
      <dt>Render cadence</dt><dd>{metrics.fps < 0.5 ? 'Idle' : `${metrics.fps.toFixed(0)} fps`}</dd>
      <dt>Camera motion</dt><dd data-testid="camera-motion">{metrics.cameraMoving ? 'Moving' : 'Still'}</dd>
      <dt>Frames rendered</dt><dd data-testid="frames-rendered">{metrics.frames}</dd>
      <dt>Last draw calls</dt><dd>{metrics.drawCalls}</dd>
      <dt>CPU submission</dt><dd>{metrics.frames ? `${metrics.submissionMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>GPU frame time</dt><dd>Unavailable</dd>
      <dt>Process instances</dt><dd data-testid="process-instances">{metrics.processInstances}</dd>
      <dt>Galaxy instances</dt><dd data-testid="galaxy-instances">{metrics.galaxyInstances}</dd>
      <dt>Parent links</dt><dd data-testid="parent-links">{metrics.parentLinks}</dd>
      <dt>Snapshot payload RX</dt><dd>{status === 'connected' ? `${metrics.bytesPerSecond.toFixed(0)} B/s` : 'Unavailable'}</dd>
      <dt>Last delivery</dt><dd data-testid="last-delivery">{lastDelivery ?? 'Unavailable'}</dd>
      <dt>Full states</dt><dd data-testid="full-snapshots">{fullSnapshots}</dd>
      <dt>Delta batches</dt><dd data-testid="delta-batches">{deltaBatches}</dd>
      <dt>Changed process rows</dt><dd data-testid="changed-rows">{changedRows}</dd>
      <dt>Event cursor</dt><dd data-testid="event-cursor">{cursor}</dd>
      <dt>Journal evictions</dt><dd>{evictions}</dd>
      <dt>Lifecycle effects</dt><dd>{metrics.lifecycleEffects}</dd>
      <dt>Unknown-memory stars</dt><dd>{metrics.unknownMemoryInstances}</dd>
      <dt>Instance matrix edits</dt><dd data-testid="matrix-edits">{metrics.resourceMatrixEdits}</dd>
      <dt>Instance color edits</dt><dd data-testid="color-edits">{metrics.resourceColorEdits}</dd>
      <dt>Network endpoints</dt><dd data-testid="network-instances">{metrics.networkInstances}</dd>
      <dt>TCP bridges</dt><dd data-testid="network-bridges">{metrics.networkBridges}</dd>
      <dt>Network scan</dt><dd>{frame?.network.observedAtUnixMs ? `${frame.network.collectionMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>Collector duration</dt><dd>{frame?.processes.observedAtUnixMs ? `${frame.processes.collectionMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>Model build</dt><dd>{frame?.processes.observedAtUnixMs ? `${frame.processes.modelBuildMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>Logical processors</dt><dd>{frame?.processes.observedAtUnixMs ? frame.processes.logicalCpus : 'Unavailable'}</dd>
      <dt>Core / frontend CPU</dt><dd>Not measured</dd>
      <dt>Memory</dt><dd>Not measured</dd>
    </dl></div>
    <button className="focus-process" disabled={status !== 'connected'} onClick={() => { void resyncCore().catch((error: unknown) => useCoreStore.getState().fail(String(error))) }}><RefreshCw size={15} /> Resync stream</button>
    <label className="activity-filter"><input type="checkbox" aria-label="Resource visuals" checked={resourceVisuals} onChange={event => useCoreStore.getState().setResourceVisuals(event.target.checked)} /> Resource visuals</label>
    <div className="panel-section"><h3>Collection permissions</h3><p>Standard user. {frame?.enabledCollectors || frame?.network.enabled ? 'Metadata only. No packet payloads.' : 'Collection off.'} History off.</p></div>
  </aside>
}
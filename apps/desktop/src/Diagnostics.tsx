import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useCoreStore } from './state/core'
import { assemblyP95, movingCadenceP95, parseApplyP95, reconstructionP95, renderMetrics, storeUpdateP95, submissionP95, validationP95 } from '../universe/metrics'
import { completionP95, frameCpuP95, frameWorkP95, gpuP95, gpuStatus } from '../universe/metrics'
import { readHistorySessions, readRecordingStatus, resyncCore, setRecording, type HistorySession, type RecordingStatus } from './transport'

function sampleFrameMetrics() {
  return { frameCpuP95Ms: frameCpuP95(), gpuP95Ms: gpuP95(), frameWorkP95Ms: frameWorkP95(), completionP95Ms: completionP95(), gpuSupported: gpuStatus.supported }
}

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
  const [metrics, setMetrics] = useState(() => ({ fps: 0, bytesPerSecond: 0, totalBytes: 0, submissionP95Ms: null as number | null, movingCadenceP95Ms: null as number | null, parseApplyP95Ms: null as number | null, validationP95Ms: null as number | null, assemblyP95Ms: null as number | null, reconstructionP95Ms: null as number | null, storeUpdateP95Ms: null as number | null, ...renderMetrics, ...sampleFrameMetrics() }))
  const [recording, setRecordingState] = useState<RecordingStatus>({ enabled: false, error: null })
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [sessions, setSessions] = useState<HistorySession[]>([])
  useEffect(() => {
    if (status !== 'connected') return
    let active = true
    const refresh = () => { void readRecordingStatus().then(value => { if (active) setRecordingState(value) }).catch((error: unknown) => { if (active) setRecordingState({ enabled: false, error: String(error) }) }) }
    refresh()
    void readHistorySessions().then(value => { if (active) setSessions(value) }).catch(() => {})
    const timer = setInterval(refresh, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [status])
  useEffect(() => {
    let previousTime = performance.now()
    let previousFrames = renderMetrics.frames
    let previousBytes = useCoreStore.getState().bytesReceived
    const timer = setInterval(() => {
      const now = performance.now()
      const bytes = useCoreStore.getState().bytesReceived
      const seconds = (now - previousTime) / 1000
      setMetrics({ ...renderMetrics, ...sampleFrameMetrics(), fps: (renderMetrics.frames - previousFrames) / seconds, bytesPerSecond: Math.max(0, bytes - previousBytes) / seconds, totalBytes: bytes, submissionP95Ms: submissionP95(), movingCadenceP95Ms: movingCadenceP95(), parseApplyP95Ms: parseApplyP95(), validationP95Ms: validationP95(), assemblyP95Ms: assemblyP95(), reconstructionP95Ms: reconstructionP95(), storeUpdateP95Ms: storeUpdateP95() })
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
      <dt>CPU submission p95 (recent frames)</dt><dd data-testid="submission-p95">{metrics.submissionP95Ms === null ? 'Unavailable' : `${metrics.submissionP95Ms.toFixed(2)} ms`}</dd>
      <dt>Moving frame interval p95</dt><dd data-testid="moving-cadence-p95">{metrics.movingCadenceP95Ms === null ? 'Unavailable' : `${metrics.movingCadenceP95Ms.toFixed(2)} ms`}</dd>
      <dt>CPU frame work p95 (ms)</dt><dd data-testid="frame-cpu-p95">{metrics.frameCpuP95Ms?.toFixed(2) ?? 'Unavailable'}</dd>
      <dt>GPU execution p95 (ms)</dt><dd data-testid="gpu-p95">{metrics.gpuP95Ms?.toFixed(2) ?? (metrics.gpuSupported ? 'Pending' : 'Unavailable')}</dd>
      <dt>CPU + GPU work p95 (ms)</dt><dd data-testid="frame-work-p95">{metrics.frameWorkP95Ms?.toFixed(2) ?? 'Unavailable'}</dd>
      <dt>Completion upper bound p95 (ms)</dt><dd data-testid="completion-p95">{metrics.completionP95Ms?.toFixed(2) ?? 'Unavailable'}</dd>
      <dt>Process instances</dt><dd data-testid="process-instances">{metrics.processInstances}</dd>
      <dt>Galaxy instances</dt><dd data-testid="galaxy-instances">{metrics.galaxyInstances}</dd>
      <dt>Parent links</dt><dd data-testid="parent-links">{metrics.parentLinks}</dd>
      <dt>Snapshot JSON envelopes RX</dt><dd>{status === 'connected' ? `${metrics.bytesPerSecond.toFixed(0)} B/s` : 'Unavailable'}</dd>
      <dt>Snapshot JSON envelopes total RX</dt><dd data-testid="total-bytes-received">{metrics.totalBytes}</dd>
      <dt>Frontend parse + apply p95</dt><dd data-testid="parse-apply-p95">{metrics.parseApplyP95Ms === null ? 'Unavailable' : `${metrics.parseApplyP95Ms.toFixed(2)} ms`}</dd>
      <dt>Packet validation p95</dt><dd data-testid="validation-p95">{metrics.validationP95Ms === null ? 'Unavailable' : `${metrics.validationP95Ms.toFixed(2)} ms`}</dd>
      <dt>Chunk assembly p95</dt><dd data-testid="assembly-p95">{metrics.assemblyP95Ms === null ? 'Unavailable' : `${metrics.assemblyP95Ms.toFixed(2)} ms`}</dd>
      <dt>Frame reconstruction p95</dt><dd data-testid="reconstruction-p95">{metrics.reconstructionP95Ms === null ? 'Unavailable' : `${metrics.reconstructionP95Ms.toFixed(2)} ms`}</dd>
      <dt>Store update p95</dt><dd data-testid="store-update-p95">{metrics.storeUpdateP95Ms === null ? 'Unavailable' : `${metrics.storeUpdateP95Ms.toFixed(2)} ms`}</dd>
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
      <dt>Filesystem watch</dt><dd>{frame?.filesystem.watching ? 'On' : 'Off'}</dd>
      <dt>Filesystem entries</dt><dd>{metrics.filesystemEntries}</dd>
      <dt>Filesystem revision</dt><dd data-testid="filesystem-revision">{frame?.filesystem.revision ?? 'Unavailable'}</dd>
      <dt>Directory scan</dt><dd>{frame?.filesystem.root ? `${frame.filesystem.scanMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>Collector duration</dt><dd>{frame?.processes.observedAtUnixMs ? `${frame.processes.collectionMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>Model build</dt><dd>{frame?.processes.observedAtUnixMs ? `${frame.processes.modelBuildMs.toFixed(2)} ms` : 'Unavailable'}</dd>
      <dt>Logical processors</dt><dd>{frame?.processes.observedAtUnixMs ? frame.processes.logicalCpus : 'Unavailable'}</dd>
      <dt>Core / frontend CPU</dt><dd>Not measured</dd>
      <dt>Memory</dt><dd>Not measured</dd>
    </dl></div>
    <button className="focus-process" disabled={status !== 'connected'} onClick={() => { void resyncCore().catch((error: unknown) => useCoreStore.getState().fail(String(error))) }}><RefreshCw size={15} /> Resync stream</button>
    <label className="activity-filter"><input type="checkbox" aria-label="Resource visuals" checked={resourceVisuals} onChange={event => useCoreStore.getState().setResourceVisuals(event.target.checked)} /> Resource visuals</label>
    <div className="panel-section"><h3>Local history</h3>
      <label className="activity-filter"><input type="checkbox" aria-label="Record local history" checked={recording.enabled} disabled={status !== 'connected' || recordingBusy} onChange={event => {
        setRecordingBusy(true)
        void setRecording(event.target.checked).then(value => {
          setRecordingState(value)
          return readHistorySessions().then(setSessions)
        }).catch((error: unknown) => setRecordingState({ enabled: false, error: String(error) })).finally(() => setRecordingBusy(false))
      }} /> Record local history</label>
      {sessions.length > 0 && <><div className="panel-heading"><h3>Recorded sessions ({sessions.length}{sessions.length === 50 ? '+' : ''})</h3><button className="icon-button" title="Refresh recorded sessions" aria-label="Refresh recorded sessions" onClick={() => { void readHistorySessions().then(setSessions).catch((error: unknown) => setRecordingState({ ...recording, error: String(error) })) }}><RefreshCw size={15} /></button></div>
        <ul className="history-sessions">{sessions.map(session => <li key={session.id}><time dateTime={new Date(session.startedMs).toISOString()}>{new Date(session.startedMs).toLocaleString()}</time><span>{session.endedMs === null ? 'Active' : 'Closed'}</span></li>)}</ul></>}
      {recording.error && <p role="alert">Recording stopped: {recording.error}</p>}
    </div>
    <div className="panel-section"><h3>Collection permissions</h3><p>Standard user. {frame?.enabledCollectors || frame?.network.enabled ? 'Metadata only. No packet payloads.' : 'Collection off.'} History {recording.enabled ? 'on' : 'off'}.</p></div>
  </aside>
}
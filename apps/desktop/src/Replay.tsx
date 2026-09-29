import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw, X } from 'lucide-react'
import type { CoreFrame } from '../../../shared/protocol/core'
import { readHistoryCheckpoint, readHistoryCheckpoints, readHistoryEvents, readHistorySessions, type HistoryEvent, type HistorySession } from './transport'

const ReplayScene = lazy(() => import('../universe/ReplayScene').then(module => ({ default: module.ReplayScene })))

export function Replay({ close }: { close: () => void }) {
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [session, setSession] = useState('')
  const [times, setTimes] = useState<number[]>([])
  const [index, setIndex] = useState(0)
  const [frame, setFrame] = useState<CoreFrame | null>(null)
  const [observedMs, setObservedMs] = useState<number | null>(null)
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [gap, setGap] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  function resetView() {
    setPlaying(false)
    setFrame(null)
    setTimes([])
    setObservedMs(null)
    setEvents([])
    setError(null)
  }

  useEffect(() => {
    let active = true
    void readHistorySessions().then(rows => {
      if (!active) return
      setSessions(rows)
      setSession(previous => rows.some(row => row.id === previous) ? previous : rows[0]?.id ?? '')
    }).catch(failure => { if (active) setError(String(failure)) })
    return () => { active = false }
  }, [refresh])

  useEffect(() => {
    if (!session) return
    let active = true
    void readHistoryCheckpoints(session).then(values => {
      if (!active) return
      setTimes(values)
      setIndex(Math.max(0, values.length - 1))
      setError(null)
    }).catch(failure => { if (active) setError(String(failure)) })
    return () => { active = false }
  }, [session, refresh])

  useEffect(() => {
    const atMs = times[index]
    if (!session || atMs === undefined) return
    let active = true
    void Promise.all([readHistoryCheckpoint(session, atMs), readHistoryEvents(session, times[Math.max(0, index - 1)])]).then(([checkpoint, rows]) => {
      if (!active) return
      if (!checkpoint || checkpoint.observedMs !== atMs) throw new Error('Checkpoint unavailable at selected time')
      setFrame(checkpoint.frame)
      setObservedMs(checkpoint.observedMs)
      setGap(checkpoint.gap)
      setEvents(rows.filter(row => row.observedMs <= atMs))
      setError(null)
    }).catch(failure => { if (active) setError(String(failure)) })
    return () => { active = false }
  }, [session, times, index])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setIndex(current => {
      if (current + 1 >= times.length) { setPlaying(false); return current }
      return current + 1
    }), 1200)
    return () => clearInterval(timer)
  }, [playing, times.length])

  const displayed = observedMs === times[index] ? frame : null
  const selected = displayed?.processes.rows.find(row => row.id === selectedId)
  const listed = displayed?.processes.rows.filter(row => row.name.toLowerCase().includes(query.toLowerCase()) || String(row.pid) === query.trim()).slice(0, 50) ?? []
  return <main className="app-shell replay-shell" aria-label="Historical replay">
    {displayed && <Suspense fallback={null}><ReplayScene frame={displayed} selectedId={selectedId} select={setSelectedId} /></Suspense>}
    <header className="topbar replay-topbar"><div className="brand"><h1>UNIVERSE OS</h1><span className="version">REPLAY / 09</span></div><span className="replay-indicator">Recorded metadata / read-only</span><button className="icon-button" title="Return to live" aria-label="Return to live" onClick={close}><X size={18} /></button></header>
    <div className="replay-heading"><span className="eyebrow">HISTORICAL OBSERVATIONS</span><h2>Session timeline</h2><p>{observedMs === null ? 'Select a recorded checkpoint' : `Snapshot observed ${new Date(observedMs).toLocaleString()}`}</p></div>
    <div className="replay-select"><label htmlFor="replay-session">Session</label><select id="replay-session" aria-label="History session" value={session} onChange={event => { resetView(); setSession(event.target.value) }}><option value="">No session</option>{sessions.map(row => <option key={row.id} value={row.id}>{new Date(row.startedMs).toLocaleString()} / {row.endedMs === null ? 'Open' : 'Closed'}</option>)}</select><button className="icon-button" title="Refresh history" aria-label="Refresh history" onClick={() => { resetView(); setRefresh(value => value + 1) }}><RefreshCw size={16} /></button></div>
    {error && <p className="replay-error" role="alert">{error}</p>}
    {!displayed && !error && <p className="replay-empty">{session ? 'Loading recorded snapshot' : 'No recorded sessions'}</p>}
    {displayed && <aside className="replay-details" aria-label="Recorded details">
      {gap && <p className="activity-gap" role="status">Incomplete interval: some observations were not recorded.</p>}
      <h3>At recorded state</h3><dl><dt>Processes</dt><dd>{displayed.processes.rows.length}</dd><dt>Galaxies</dt><dd>{displayed.processes.galaxies.length}</dd><dt>Network endpoints</dt><dd>{displayed.network.connections.length}</dd><dt>Directory entries</dt><dd>{displayed.filesystem.entries.length}</dd></dl>
      {selected && <section className="replay-selection"><h3>{selected.name}</h3><dl><dt>PID</dt><dd>{selected.pid}</dd><dt>CPU</dt><dd>{selected.cpuPercent === null ? 'Unavailable' : `${selected.cpuPercent.toFixed(2)}%`}</dd><dt>Memory</dt><dd>{selected.workingSetBytes === null ? 'Unavailable' : `${(Number(selected.workingSetBytes) / 1048576).toFixed(1)} MiB`}</dd></dl></section>}
      <input aria-label="Search recorded processes" placeholder="Name or PID" value={query} onChange={event => setQuery(event.target.value)} />
      <ul className="replay-list">{listed.map(row => <li key={row.id}><button className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)}>{row.name}<span>{row.pid}</span></button></li>)}</ul>
      <h3>Recorded changes {events.length === 100 ? '/ first 100' : ''}</h3>
      <ul className="replay-events">{events.map(row => <li key={`${row.observedMs}/${row.sequence}`}><time>{new Date(row.observedMs).toLocaleTimeString()}</time><span>{row.kind.replaceAll('_', ' ')}</span></li>)}</ul>
    </aside>}
    <div className="replay-timeline" aria-label="Checkpoint timeline"><button className="icon-button" title={playing ? 'Pause replay' : 'Play checkpoints'} aria-label={playing ? 'Pause replay' : 'Play checkpoints'} disabled={times.length < 2} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button className="icon-button" title="Previous checkpoint" aria-label="Previous checkpoint" disabled={index === 0} onClick={() => { setPlaying(false); setIndex(value => value - 1) }}><ChevronLeft size={16} /></button><input type="range" aria-label="Replay checkpoint" min="0" max={Math.max(0, times.length - 1)} step="1" value={index} disabled={times.length < 2} onChange={event => { setPlaying(false); setIndex(Number(event.target.value)) }} /><button className="icon-button" title="Next checkpoint" aria-label="Next checkpoint" disabled={index >= times.length - 1} onClick={() => { setPlaying(false); setIndex(value => value + 1) }}><ChevronRight size={16} /></button><span>{times.length ? `${index + 1} / ${times.length}` : 'No checkpoints'}</span></div>
  </main>
}
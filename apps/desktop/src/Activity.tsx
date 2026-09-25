import { useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useCoreStore } from './state/core'
import type { ProcessEvent } from '../../../shared/protocol/stream'

const labels: Record<ProcessEvent['kind'], string> = {
  BASELINE: 'Observation baseline', PROCESS_CREATED: 'First observed', PROCESS_TERMINATED: 'No longer observed',
  PROCESS_UPDATED: 'Observation updated', EVENT_GAP: 'Observation gap', COLLECTION_PAUSED: 'Collection paused',
  RESOURCE_SPIKE: 'Sustained CPU spike',
}

export function Activity({ close }: { close: () => void }) {
  const events = useCoreStore(state => state.events)
  const missing = useCoreStore(state => state.missedEvents)
  const frame = useCoreStore(state => state.frame)
  const [all, setAll] = useState(false)
  const [page, setPage] = useState(0)
  const filtered = events.filter(event => all || event.kind !== 'PROCESS_UPDATED').slice().reverse()
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1))
  const currentIds = new Set(frame?.processes.rows.map(row => row.id))
  return <aside className="process-browser activity-panel" aria-label="Recent activity">
    <div className="panel-heading"><h2>Recent activity</h2><button className="icon-button" aria-label="Close activity" title="Close activity" onClick={close}><X size={17} /></button></div>
    <label className="activity-filter"><input type="checkbox" checked={all} onChange={event => { setAll(event.target.checked); setPage(0) }} /> Include metadata updates</label>
    {missing !== '0' && <p className="activity-gap" role="status">Missed journal entries: {missing}</p>}
    <ol className="event-list">{filtered.slice(currentPage * 25, (currentPage + 1) * 25).map(event => <li key={event.sequence} data-kind={event.kind} data-pid={event.pid}>
      <time title={event.previousObservedAtUnixMs ? `Observed between ${new Date(event.previousObservedAtUnixMs).toLocaleString()} and ${new Date(event.observedAtUnixMs).toLocaleString()}` : new Date(event.observedAtUnixMs).toLocaleString()}>{new Date(event.observedAtUnixMs).toLocaleTimeString()}</time>
      <span>{labels[event.kind]}</span>
      {event.kind === 'RESOURCE_SPIKE' && <small>{event.resourceValue?.toFixed(2)}% CPU / {event.resourceThreshold}% threshold</small>}
      {event.processId ? <button disabled={!currentIds.has(event.processId)} title={`${event.name} / PID ${event.pid}`} onClick={() => useCoreStore.getState().select(event.processId)}>{event.name} <span>{event.pid}</span></button> : <small>{event.reason}</small>}
    </li>)}</ol>
    {!filtered.length && <p className="empty-results">No recent lifecycle observations.</p>}
    <div className="pagination"><span>{events.length} / 256 retained</span><button className="icon-button" aria-label="Previous events" title="Previous events" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}</span><button className="icon-button" aria-label="Next events" title="Next events" disabled={(currentPage + 1) * 25 >= filtered.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
  </aside>
}
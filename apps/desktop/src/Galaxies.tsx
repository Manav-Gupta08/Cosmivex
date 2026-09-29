import { useState } from 'react'
import { ChevronLeft, ChevronRight, Crosshair, X } from 'lucide-react'
import { useCoreStore } from './state/core'
import { galaxyColor } from '../universe/layout'

export function GalaxyBrowser({ close }: { close: () => void }) {
  const frame = useCoreStore(state => state.frame)
  const visibleIds = useCoreStore(state => state.processIds)
  const [page, setPage] = useState(0)
  const visible = new Set(visibleIds)
  const groupIds = new Set(frame?.processes.rows.filter(row => visible.has(row.id)).map(row => row.galaxyId))
  const groups = frame?.processes.galaxies.filter(group => groupIds.has(group.id)).sort((left, right) => right.processCount - left.processCount || left.label.localeCompare(right.label) || left.id.localeCompare(right.id)) ?? []
  const currentPage = Math.min(page, Math.max(0, Math.ceil(groups.length / 50) - 1))
  return <aside className="process-browser galaxy-browser" aria-label="Galaxy list">
    <div className="panel-heading"><h2>Galaxies <span className="count">{groups.length}</span></h2><button className="icon-button" aria-label="Close galaxy list" title="Close galaxy list" onClick={close}><X size={17} /></button></div>
    <div className="process-table-scroll"><table><thead><tr><th>Inferred group</th><th>Processes</th><th>Root PID</th></tr></thead><tbody>
      {groups.slice(currentPage * 50, (currentPage + 1) * 50).map(group => <tr key={group.id}><td><button className="process-name" title={group.label} onClick={() => { useCoreStore.getState().selectGalaxy(group.id); useCoreStore.getState().setQuery(''); close() }}><span className="galaxy-swatch" style={{ background: galaxyColor(group.id) }} />{group.label}</button></td><td>{group.processCount}</td><td>{group.rootId.split(':')[0]}</td></tr>)}
    </tbody></table>{groups.length === 0 && <p className="empty-results">No matching galaxy observations.</p>}</div>
    <div className="pagination"><span>Same-image ancestry</span><button className="icon-button" aria-label="Previous galaxies" title="Previous galaxies" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {Math.max(1, Math.ceil(groups.length / 50))}</span><button className="icon-button" aria-label="Next galaxies" title="Next galaxies" disabled={(currentPage + 1) * 50 >= groups.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
  </aside>
}

export function GalaxyInspector({ close = () => useCoreStore.getState().selectGalaxy(null) }: { close?: () => void }) {
  const group = useCoreStore(state => state.selectedGalaxy)
  const frame = useCoreStore(state => state.frame)
  const connection = useCoreStore(state => state.status)
  const [page, setPage] = useState(0)
  if (!group) return null
  const present = frame?.processes.galaxies.some(row => row.id === group.id)
  const members = frame?.processes.rows.filter(row => row.galaxyId === group.id) ?? []
  const currentPage = Math.min(page, Math.max(0, Math.ceil(members.length / 12) - 1))
  const status = connection !== 'connected' ? 'Last observation / stream stale' : frame?.enabledCollectors === 0 ? 'Collection off'
    : frame?.processes.error ? 'Collection unavailable' : present ? 'Inferred galaxy' : 'No longer observed'
  return <aside className="diagnostics galaxy-inspector" aria-label="Galaxy details">
    <div className="panel-heading"><h2>{group.label}</h2><button className="icon-button" aria-label="Close galaxy details" title="Close galaxy details" onClick={close}><X size={17} /></button></div>
    <span className="process-status" data-testid="galaxy-status">{status}</span>
    <div className="panel-section"><h3>Observed membership</h3><dl>
      <dt>Root PID</dt><dd data-testid="galaxy-root-pid">{group.rootId.split(':')[0]}</dd>
      <dt>Processes</dt><dd data-testid="galaxy-member-count">{group.processCount}</dd>
      <dt>CPU sum / machine</dt><dd>{group.cpuPercent === null ? 'Unavailable' : `${group.cpuPercent.toFixed(2)}%`}</dd>
      <dt>CPU sample coverage</dt><dd>{group.cpuSampleCount} / {group.processCount}</dd>
      <dt>Working-set sum</dt><dd>{group.workingSetBytes === null ? 'Unavailable' : `${(Number(group.workingSetBytes) / 1048576).toFixed(1)} MiB`}</dd>
      <dt>Memory coverage</dt><dd>{group.memorySampleCount} / {group.processCount}</dd>
      <dt>Image access</dt><dd>{group.imageError ? `Win32 ${group.imageError}` : 'Available'}</dd>
    </dl></div>
    <div className="panel-section"><h3>Observed image path</h3><p className="image-path">{group.executablePath ?? 'Unavailable'}</p></div>
    {present && <button className="focus-process" onClick={() => useCoreStore.getState().selectGalaxy(group.id)}><Crosshair size={15} /> Focus galaxy</button>}
    <div className="panel-section"><h3>Member processes</h3><div className="member-list">
      {members.slice(currentPage * 12, (currentPage + 1) * 12).map(row => <button key={row.id} aria-label={`${row.name}, PID ${row.pid}`} onClick={() => useCoreStore.getState().select(row.id)}><span>{row.name}</span><span>{row.pid}</span></button>)}
    </div>{members.length > 12 && <div className="pagination"><button className="icon-button" aria-label="Previous members" title="Previous members" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1}</span><button className="icon-button" aria-label="Next members" title="Next members" disabled={(currentPage + 1) * 12 >= members.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>}</div>
  </aside>
}
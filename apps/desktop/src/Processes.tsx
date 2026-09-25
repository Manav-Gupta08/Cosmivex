import { useState } from 'react'
import { ArrowDownUp, ChevronLeft, ChevronRight, Crosshair, GitFork, Orbit, X } from 'lucide-react'
import type { ProcessRecord } from '../../../shared/protocol/core'
import { useCoreStore } from './state/core'

function formatMemory(bytes: string | null): string {
  if (bytes === null) return 'Unavailable'
  return `${(Number(bytes) / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
}

export function ProcessBrowser({ close }: { close: () => void }) {
  const frame = useCoreStore(state => state.frame)
  const ids = useCoreStore(state => state.processIds)
  const query = useCoreStore(state => state.query)
  const mode = useCoreStore(state => state.viewMode)
  const order = useCoreStore(state => state.layout.hierarchyOrder)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<'pid' | 'cpu' | 'memory' | 'name' | 'tree'>(mode === 'hierarchy' ? 'tree' : 'cpu')
  const idSet = new Set(ids)
  const rows = frame?.processes.rows.filter(process => idSet.has(process.id)) ?? []
  const ranks = new Map(order.map((id, index) => [id, index]))
  rows.sort((left, right) => sort === 'tree' ? (ranks.get(left.id) ?? 0) - (ranks.get(right.id) ?? 0)
    : sort === 'name' ? left.name.localeCompare(right.name) || left.pid - right.pid
    : sort === 'pid' ? left.pid - right.pid
    : sort === 'memory' ? Number(right.workingSetBytes ?? -1) - Number(left.workingSetBytes ?? -1) || left.pid - right.pid
    : (right.cpuPercent ?? -1) - (left.cpuPercent ?? -1) || left.pid - right.pid)
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1))
  function choose(process: ProcessRecord) {
    useCoreStore.getState().select(process.id)
    useCoreStore.getState().setQuery('')
    close()
  }
  return <aside className="process-browser" aria-label="Process list">
    <div className="panel-heading"><h2>{query ? 'Search results' : 'Processes'} <span className="count">{rows.length}</span></h2><button className="icon-button" aria-label="Close process list" title="Close process list" onClick={close}><X size={17} /></button></div>
    <button className="tree-order" aria-pressed={sort === 'tree'} onClick={() => { setSort('tree'); setPage(0) }}><GitFork size={13} /> Hierarchy order</button>
    <div className="process-table-scroll"><table><thead><tr>
      {(['name', 'pid', 'cpu', 'memory'] as const).map(column => <th key={column} scope="col"><button aria-label={`Sort by ${column}`} onClick={() => { setSort(column); setPage(0) }}>{column === 'name' ? 'Process' : column.toUpperCase()}{sort === column && <ArrowDownUp size={10} />}</button></th>)}
    </tr></thead><tbody>
      {rows.slice(currentPage * 50, (currentPage + 1) * 50).map(process => <tr key={process.id}>
        <td><button className="process-name" title={`${process.name} / depth ${process.depth}`} style={sort === 'tree' ? { paddingLeft: Math.min(process.depth, 5) * 8 } : undefined} onClick={() => choose(process)}>{sort === 'tree' && process.parentId ? <span className="tree-marker">/ </span> : null}{process.name || 'Unnamed process'}</button></td>
        <td>{process.pid}</td><td>{process.cpuPercent === null ? '--' : `${process.cpuPercent.toFixed(1)}%`}</td>
        <td>{process.workingSetBytes === null ? '--' : (Number(process.workingSetBytes) / 1048576).toFixed(1)}</td>
      </tr>)}
    </tbody></table>{rows.length === 0 && <p className="empty-results">{frame?.enabledCollectors === 0 ? 'Process collection is off.' : frame?.processes.error ? `Collection failed (Win32 ${frame.processes.error}).` : 'No matching observations.'}</p>}</div>
    <div className="pagination"><span>Working set: MiB</span><button className="icon-button" aria-label="Previous processes" title="Previous processes" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {Math.max(1, Math.ceil(rows.length / 50))}</span><button className="icon-button" aria-label="Next processes" title="Next processes" disabled={(currentPage + 1) * 50 >= rows.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
  </aside>
}

export function ProcessInspector() {
  const process = useCoreStore(state => state.selected)
  const frame = useCoreStore(state => state.frame)
  const connection = useCoreStore(state => state.status)
  if (!process) return null
  const present = frame?.processes.rows.some(row => row.id === process.id) ?? false
  const parent = frame?.processes.rows.find(row => row.id === process.parentId)
  const group = frame?.processes.galaxies.find(row => row.id === process.galaxyId)
  const state = connection !== 'connected' ? 'Last observation / stream stale' : frame?.enabledCollectors === 0 ? 'Collection off'
    : frame?.processes.error ? 'Collection unavailable' : present ? 'Observed' : 'No longer observed'
  return <aside className="diagnostics process-inspector" aria-label="Process details">
    <div className="panel-heading"><h2 title={process.name}>{process.name || 'Unnamed process'}</h2><button className="icon-button" aria-label="Close process details" title="Close process details" onClick={() => useCoreStore.getState().select(null)}><X size={17} /></button></div>
    <span className="process-status" data-testid="process-status">{state}</span>
    <div className="panel-section"><h3>Process observation</h3><dl>
      <dt>PID</dt><dd data-testid="process-pid">{process.pid}</dd>
      <dt>Parent PID</dt><dd data-testid="process-parent-pid">{process.parentPid}</dd>
      <dt>Parent evidence</dt><dd data-testid="parent-evidence">{process.parentStatus}</dd>
      <dt>Hierarchy depth</dt><dd>{process.depth}</dd>
      <dt>CPU / machine</dt><dd data-testid="process-cpu">{process.cpuPercent === null ? 'Unavailable' : `${process.cpuPercent.toFixed(2)}%`}</dd>
      <dt>Working set</dt><dd data-testid="process-memory">{formatMemory(process.workingSetBytes)}</dd>
      <dt>Thread count</dt><dd>{process.threadCount}</dd>
      <dt>Created</dt><dd>{process.createdAtUnixMs === null ? 'Unavailable' : new Date(process.createdAtUnixMs).toLocaleString()}</dd>
      <dt>Identity</dt><dd>{process.creationFiletime === null ? 'Observation only' : 'Creation verified'}</dd>
      <dt>Timing access</dt><dd>{process.timingError ? `Win32 ${process.timingError}` : 'Available'}</dd>
      <dt>Memory access</dt><dd>{process.memoryError ? `Win32 ${process.memoryError}` : 'Available'}</dd>
    </dl></div>
    {present && <button className="focus-process" onClick={() => useCoreStore.getState().select(process.id)}><Crosshair size={15} /> Focus process</button>}
    {present && parent && <button className="focus-process" onClick={() => useCoreStore.getState().select(parent.id)}><GitFork size={15} /> Open parent ({parent.pid})</button>}
    {present && group && <button className="focus-process" onClick={() => useCoreStore.getState().selectGalaxy(group.id)}><Orbit size={15} /> Open galaxy</button>}
  </aside>
}
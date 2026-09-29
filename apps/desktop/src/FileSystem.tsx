import { useState } from 'react'
import { ArrowUp, Check, ChevronLeft, ChevronRight, FolderOpen, Square, X } from 'lucide-react'
import { useCoreStore } from './state/core'
import { navigateFilesystem, openFilesystemRoot, stopFilesystem } from './transport'

function failure(error: unknown) { useCoreStore.getState().fail(String(error)) }
export function FolderControls() {
  const snapshot = useCoreStore(state => state.frame?.filesystem)
  const status = useCoreStore(state => state.status)
  const [path, setPath] = useState('')
  return <div className="folder-controls">
    <form className="folder-path" onSubmit={event => { event.preventDefault(); void openFilesystemRoot(path).catch(failure) }}>
      <FolderOpen size={15} /><input aria-label="Filesystem root path" placeholder="C:\Users\..." value={path} onChange={event => setPath(event.target.value)} />
      <button className="icon-button" aria-label="Open folder" title="Open folder" disabled={status !== 'connected' || !path.trim()}><Check size={17} /></button>
    </form>
    <div className="folder-location"><button className="icon-button" aria-label="Parent folder" title="Parent folder" disabled={!snapshot?.relative || !!snapshot.error} onClick={() => { if (snapshot) void navigateFilesystem(snapshot.scope, '0').catch(failure) }}><ArrowUp size={16} /></button><span title={snapshot?.root}>{snapshot?.relative || snapshot?.root || 'No folder selected'}</span><button className="icon-button" aria-label="Stop filesystem watch" title="Stop filesystem watch" disabled={!snapshot?.root} onClick={() => void stopFilesystem().catch(failure)}><Square size={13} /></button></div>
  </div>
}

export function FileSystemBrowser({ close }: { close: () => void }) {
  const snapshot = useCoreStore(state => state.frame?.filesystem)
  const [tab, setTab] = useState<'entries' | 'events'>('entries')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const entries = snapshot?.entries.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase())) ?? []
  const events = snapshot?.events.slice().reverse() ?? []
  const count = tab === 'entries' ? entries.length : events.length
  const currentPage = Math.min(page, Math.max(0, Math.ceil(count / 50) - 1))
  return <aside className="process-browser filesystem-browser" aria-label="Filesystem list">
    <div className="panel-heading"><h2>Directory <span className="count">{count}</span></h2><button className="icon-button" aria-label="Close filesystem list" title="Close filesystem list" onClick={close}><X size={17} /></button></div>
    <div className="network-tabs" role="tablist" aria-label="Filesystem records"><button role="tab" aria-selected={tab === 'entries'} onClick={() => { setTab('entries'); setPage(0) }}>Entries</button><button role="tab" aria-selected={tab === 'events'} onClick={() => { setTab('events'); setPage(0) }}>Changes</button></div>
    {snapshot?.error || snapshot?.watchError ? <p className="activity-gap">Directory error {snapshot.error} / watch error {snapshot.watchError}</p> : null}
    {snapshot?.truncated && <p className="activity-gap">Directory listing truncated.</p>}
    {tab === 'entries' && <input className="file-search" aria-label="Search files" placeholder="File or directory name" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} />}
    <div className="process-table-scroll">{tab === 'entries' ? <table><thead><tr><th>Name</th><th>Type</th><th>Bytes</th></tr></thead><tbody>
      {entries.slice(currentPage * 50, (currentPage + 1) * 50).map(entry => <tr key={entry.id}><td><button className="process-name" title={entry.name} onClick={() => { useCoreStore.getState().selectFile(entry.id); close() }}>{entry.name}</button></td><td>{entry.reparse ? 'Reparse' : entry.directory ? 'Directory' : 'File'}</td><td>{entry.size ?? '--'}</td></tr>)}
    </tbody></table> : <ol className="event-list">{events.slice(currentPage * 50, (currentPage + 1) * 50).map(event => <li key={event.sequence} data-kind={event.kind} data-name={event.name}><time>{new Date(event.observedAtUnixMs).toLocaleTimeString()}</time><span>{event.kind.replaceAll('_', ' ')}</span><small>{event.previousName ? `${event.previousName} -> ` : ''}{event.name}</small></li>)}</ol>}
      {count === 0 && <p className="empty-results">{snapshot?.root ? 'No matching observations.' : 'No folder selected.'}</p>}
    </div>
    <div className="pagination"><span>Read-only / direct children</span><button className="icon-button" aria-label="Previous file records" title="Previous file records" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {Math.max(1, Math.ceil(count / 50))}</span><button className="icon-button" aria-label="Next file records" title="Next file records" disabled={(currentPage + 1) * 50 >= count} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
  </aside>
}

export function FileInspector({ close = () => useCoreStore.getState().selectFile(null) }: { close?: () => void }) {
  const entry = useCoreStore(state => state.selectedFile)
  const snapshot = useCoreStore(state => state.frame?.filesystem)
  const status = useCoreStore(state => state.status)
  if (!entry || !snapshot) return null
  const present = snapshot.entries.some(row => row.id === entry.id)
  const label = status !== 'connected' ? 'Last observation / stream stale' : snapshot.error ? 'Directory unavailable' : present ? 'Observed' : 'No longer observed'
  return <aside className="diagnostics file-inspector" aria-label="File details"><div className="panel-heading"><h2>{entry.name}</h2><button className="icon-button" aria-label="Close file details" title="Close file details" onClick={close}><X size={17} /></button></div>
    <span className="process-status" data-testid="file-status">{label}</span>
    <div className="panel-section"><h3>Directory entry</h3><dl><dt>Type</dt><dd>{entry.directory ? 'Directory' : 'File'}</dd><dt>Bytes</dt><dd data-testid="file-size">{entry.size ?? 'Not a recursive size'}</dd><dt>Modified</dt><dd>{entry.modifiedUnixMs ? new Date(entry.modifiedUnixMs).toLocaleString() : 'Unavailable'}</dd><dt>File ID</dt><dd>{entry.fileId === '0' ? 'Unavailable' : entry.fileId}</dd><dt>Attributes</dt><dd>{entry.attributes}</dd><dt>Reparse point</dt><dd>{entry.reparse ? 'Not traversed' : 'No'}</dd></dl></div>
    {entry.directory && <button className="focus-process" disabled={!present || entry.reparse || !!snapshot.error} onClick={() => void navigateFilesystem(snapshot.scope, entry.token).catch(failure)}><FolderOpen size={15} /> Open directory</button>}
  </aside>
}
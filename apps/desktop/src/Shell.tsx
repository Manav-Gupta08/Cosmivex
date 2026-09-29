import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Activity as ActivityIcon, Aperture, Crosshair, FolderOpen, Gauge, GitFork, History, Leaf, List, Network, Orbit, Play, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { connectCore, setNativeProfile, setProcessCollection, setNetworkCollection } from './transport'
import { useCoreStore } from './state/core'
import { Diagnostics } from './Diagnostics'
import type { Profile } from '../../../shared/protocol/core'
import { ProcessBrowser, ProcessInspector } from './Processes'
import { GalaxyBrowser, GalaxyInspector } from './Galaxies'
import { Activity } from './Activity'
import { NetworkBrowser, NetworkInspector } from './Network'
import { FileInspector, FileSystemBrowser, FolderControls } from './FileSystem'
import { Replay } from './Replay'

const UniverseScene = lazy(() => import('../universe/Scene').then(module => ({ default: module.UniverseScene })))

class RendererBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <div className="renderer-fallback" role="alert"><h2>Renderer unavailable</h2><p>Native core status remains available.</p><button onClick={() => this.setState({ failed: false })}>Retry renderer</button></div>
      : this.props.children
  }
}

const profiles = [
  { id: 'eco', label: 'Eco', Icon: Leaf },
  { id: 'normal', label: 'Normal', Icon: Gauge },
  { id: 'cinematic', label: 'Cinematic', Icon: Aperture },
] as const

export default function Shell() {
  const frame = useCoreStore(state => state.frame)
  const status = useCoreStore(state => state.status)
  const error = useCoreStore(state => state.error)
  const query = useCoreStore(state => state.query)
  const focusRevision = useCoreStore(state => state.focusRevision)
  const mode = useCoreStore(state => state.viewMode)
  const selectedGalaxyId = useCoreStore(state => state.selectedGalaxy?.id)
  const [diagnostics, setDiagnostics] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [galaxiesOpen, setGalaxiesOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [panelRevision, setPanelRevision] = useState(0)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [reset, setReset] = useState(0)
  const [pending, setPending] = useState(false)
  const [replaying, setReplaying] = useState(false)
  useEffect(() => connectCore(), [connectionAttempt])
  const showDiagnostics = diagnostics && panelRevision === focusRevision
  const showList = listOpen && panelRevision === focusRevision
  const showGalaxies = galaxiesOpen && panelRevision === focusRevision
  const showActivity = activityOpen && panelRevision === focusRevision

  async function changeProfile(profile: Profile) {
    setPending(true)
    try { await setNativeProfile(profile) }
    catch (error) { useCoreStore.getState().fail(String(error)) }
    finally { setPending(false) }
  }

  async function toggleCollection(enabled: boolean) {
    setPending(true)
    try { if (mode === 'network') await setNetworkCollection(enabled); else await setProcessCollection(enabled) }
    catch (error) { useCoreStore.getState().fail(String(error)) }
    finally { setPending(false) }
  }

  const collectionState = !frame ? 'Awaiting native telemetry' : status !== 'connected' ? 'Last process observations' : frame.enabledCollectors === 0 ? 'Process collection off'
    : frame.processes.error ? `Collection error / Win32 ${frame.processes.error}`
    : frame.processes.observedAtUnixMs === 0 ? 'Collecting processes' : frame.processes.truncated ? 'Process snapshot truncated' : 'Live process observations'
  const networkState = !frame ? 'Awaiting native telemetry' : status !== 'connected' ? 'Last network observations' : !frame.network.enabled ? 'Network collection off'
    : frame.network.truncated ? 'Network snapshot truncated' : frame.network.tableErrors.some(error => error !== 0) || frame.network.interfaceError ? 'Partial network observations'
    : frame.network.observedAtUnixMs === 0 ? 'Collecting network metadata' : 'Live network observations'
  const filesystemState = !frame?.filesystem.root ? 'No folder selected' : frame.filesystem.error ? `Directory error / Win32 ${frame.filesystem.error}`
    : frame.filesystem.watchError ? `Watch error / Win32 ${frame.filesystem.watchError}` : frame.filesystem.watching ? 'Watching direct children' : 'Watch stopped'

  if (replaying) return <Replay close={() => setReplaying(false)} />

  return <main className="app-shell" data-view={mode}>
    <RendererBoundary><Suspense fallback={<div className="renderer-fallback">Opening viewport</div>}><UniverseScene profile={frame?.profile ?? 'eco'} reset={reset} /></Suspense></RendererBoundary>
    <header className="topbar">
      <div className="brand"><Orbit size={27} strokeWidth={1.2} /><h1>UNIVERSE OS</h1><span className="version">0.9</span></div>
      <div className={`connection-status ${status}`} role="status" data-testid="connection-status"><span className="status-dot" />{status === 'connected' ? 'Native core connected' : status === 'disconnected' ? 'Browser preview' : status === 'connecting' ? 'Connecting' : 'Core unavailable'}</div>
      <div className="profiles" role="group" aria-label="Resource profile">
        {profiles.map(({ id, label, Icon }) => <button key={id} className={frame?.profile === id ? 'active' : ''} disabled={status !== 'connected' || pending} aria-pressed={frame?.profile === id} aria-label={`${label} profile`} title={`${label} profile`} onClick={() => void changeProfile(id)}><Icon size={15} /><span>{label}</span></button>)}
      </div>
    </header>
    <div className="view-heading"><span className="eyebrow">LOCAL OBSERVATORY / 07</span><h2>{mode === 'filesystem' ? 'Filesystem space' : mode === 'network' ? 'Network space' : mode === 'universe' ? 'Computer universe' : 'Process hierarchy'}</h2><div className="view-state"><span className="thin-line" />{mode === 'filesystem' ? filesystemState : mode === 'network' ? networkState : collectionState}</div></div>
    <div className="view-modes" role="group" aria-label="Spatial view"><button aria-label="Universe view" aria-pressed={mode === 'universe'} onClick={() => useCoreStore.getState().setViewMode('universe')}><Orbit size={14} /> Universe</button><button aria-label="Hierarchy view" aria-pressed={mode === 'hierarchy'} onClick={() => useCoreStore.getState().setViewMode('hierarchy')}><GitFork size={14} /> Hierarchy</button><button aria-label="Network view" aria-pressed={mode === 'network'} onClick={() => useCoreStore.getState().setViewMode('network')}><Network size={14} /> Network</button><button aria-label="Filesystem view" aria-pressed={mode === 'filesystem'} onClick={() => useCoreStore.getState().setViewMode('filesystem')}><FolderOpen size={14} /> Files</button></div>
    {mode === 'filesystem' ? <FolderControls /> : <form className="process-search" role="search" onSubmit={event => {
      event.preventDefault()
      const id = (mode === 'network' ? useCoreStore.getState().networkIds : useCoreStore.getState().processIds)[0]
      if (id) { if (mode === 'network') useCoreStore.getState().selectConnection(id); else useCoreStore.getState().select(id); useCoreStore.getState().setQuery(''); setListOpen(false) }
    }}><Search size={15} /><input aria-label={mode === 'network' ? 'Search network' : 'Search processes'} placeholder={mode === 'network' ? 'IP address, port or PID' : 'Process name or PID'} value={query} onChange={event => { useCoreStore.getState().setQuery(event.target.value); setListOpen(true); setGalaxiesOpen(false); setActivityOpen(false); setDiagnostics(false); setPanelRevision(focusRevision) }} /><button className="icon-button" aria-label="Search and focus" title="Search and focus" type="submit"><Crosshair size={15} /></button></form>}
    <nav className="view-tools" aria-label="Universe tools">
      {(mode === 'universe' || mode === 'hierarchy') && <button className={`icon-button ${showGalaxies ? 'selected' : ''}`} aria-label="Galaxy list" title="Galaxy list" aria-expanded={showGalaxies} onClick={() => { setGalaxiesOpen(!showGalaxies); setListOpen(false); setActivityOpen(false); setDiagnostics(false); setPanelRevision(focusRevision) }}><Orbit size={19} /></button>}
      <button className={`icon-button ${showList ? 'selected' : ''}`} aria-label={mode === 'filesystem' ? 'Filesystem list' : mode === 'network' ? 'Network list' : 'Process list'} title="Observed records" aria-expanded={showList} onClick={() => { setListOpen(!showList); setGalaxiesOpen(false); setActivityOpen(false); setDiagnostics(false); setPanelRevision(focusRevision) }}><List size={19} /></button>
      <button className={`icon-button ${showActivity ? 'selected' : ''}`} aria-label="Recent activity" title="Recent activity" aria-expanded={showActivity} onClick={() => { setActivityOpen(!showActivity); setListOpen(false); setGalaxiesOpen(false); setDiagnostics(false); setPanelRevision(focusRevision) }}><History size={19} /></button>
      <button className="icon-button" aria-label="Historical replay" title="Historical replay" disabled={status !== 'connected'} onClick={() => setReplaying(true)}><Play size={19} /></button>
      <span className="tool-divider" />
      <button className="icon-button" aria-label="Reset camera" title="Reset camera" onClick={() => { useCoreStore.getState().select(null); useCoreStore.getState().selectFile(null); setReset(value => value + 1) }}><Crosshair size={19} /></button>
      <button className={`icon-button ${showDiagnostics ? 'selected' : ''}`} aria-label="Engine diagnostics" title="Engine diagnostics" aria-expanded={showDiagnostics} onClick={() => { setDiagnostics(!showDiagnostics); setListOpen(false); setGalaxiesOpen(false); setActivityOpen(false); setPanelRevision(focusRevision) }}><ActivityIcon size={19} /></button>
    </nav>
    <div className="origin-label" aria-hidden="true"><span>ORIGIN</span><span>00 / 00 / 00</span></div>
    {showDiagnostics && <Diagnostics close={() => setDiagnostics(false)} />}
    {showList && (mode === 'filesystem' ? <FileSystemBrowser key={frame?.filesystem.scope} close={() => setListOpen(false)} /> : mode === 'network' ? <NetworkBrowser close={() => setListOpen(false)} /> : <ProcessBrowser key={mode} close={() => setListOpen(false)} />)}
    {showGalaxies && (mode === 'universe' || mode === 'hierarchy') && <GalaxyBrowser close={() => setGalaxiesOpen(false)} />}
    {showActivity && <Activity close={() => setActivityOpen(false)} />}
    {!showDiagnostics && !showList && !(showGalaxies && (mode === 'universe' || mode === 'hierarchy')) && !showActivity && (mode === 'filesystem' ? <FileInspector /> : mode === 'network' ? <NetworkInspector /> : <><ProcessInspector /><GalaxyInspector key={selectedGalaxyId} /></>)}
    {error && <div className="connection-notice" role="alert"><span>{error}</span>{status !== 'disconnected' && <button className="icon-button" aria-label="Reconnect core" title="Reconnect core" onClick={() => setConnectionAttempt(value => value + 1)}><RefreshCw size={17} /></button>}</div>}
    <footer className="statusbar">
      {mode === 'filesystem' ? <><div><span className="footer-label">DIRECTORY ENTRIES</span><strong data-testid="file-count">{frame?.filesystem.entries.length ?? 0}</strong></div><span className="footer-label">READ-ONLY / METADATA</span><span className="footer-label">{frame?.filesystem.watching ? 'WATCHING' : 'NOT WATCHING'}</span></> : <>
      <div><span className="footer-label">{mode === 'network' ? 'OBSERVED ENDPOINTS' : 'OBSERVED PROCESSES'}</span><strong data-testid={mode === 'network' ? 'connection-count' : 'process-count'}>{mode === 'network' ? frame?.network.connections.length ?? 0 : frame?.processes.rows.length ?? 0}</strong></div>
      <div className="galaxy-count"><span className="footer-label">{mode === 'network' ? 'INTERFACES' : 'GALAXIES'}</span><strong data-testid={mode === 'network' ? 'interface-count' : 'galaxy-count'}>{mode === 'network' ? frame?.network.interfaces.length ?? 0 : frame?.processes.galaxies.length ?? 0}</strong></div>
      <label className="collection-toggle"><input type="checkbox" aria-label={mode === 'network' ? 'Network collection' : 'Process collection'} checked={mode === 'network' ? frame?.network.enabled ?? false : frame?.enabledCollectors === 1} disabled={status !== 'connected' || pending} onChange={event => void toggleCollection(event.target.checked)} /><span>{mode === 'network' ? 'Network collection' : 'Process collection'}</span></label>
      <div className="privacy"><ShieldCheck size={14} /><span>Read-only</span><span className="footer-divider">/</span><span>History off</span></div>
      </>}
    </footer>
  </main>
}
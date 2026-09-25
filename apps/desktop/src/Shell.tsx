import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Activity, Aperture, Box, Crosshair, Gauge, Leaf, Orbit, RefreshCw, ShieldCheck } from 'lucide-react'
import { connectCore, setNativeProfile } from './transport'
import { useCoreStore } from './state/core'
import { Diagnostics } from './Diagnostics'
import type { Profile } from '../../../shared/protocol/core'

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
  const [diagnostics, setDiagnostics] = useState(false)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [reset, setReset] = useState(0)
  const [pending, setPending] = useState(false)
  useEffect(() => connectCore(), [connectionAttempt])

  async function changeProfile(profile: Profile) {
    setPending(true)
    try { await setNativeProfile(profile) }
    catch (error) { useCoreStore.getState().fail(String(error)) }
    finally { setPending(false) }
  }

  return <main className="app-shell">
    <RendererBoundary><Suspense fallback={<div className="renderer-fallback">Opening viewport</div>}><UniverseScene profile={frame?.profile ?? 'eco'} reset={reset} /></Suspense></RendererBoundary>
    <header className="topbar">
      <div className="brand"><Orbit size={27} strokeWidth={1.2} /><h1>UNIVERSE OS</h1><span className="version">0.1</span></div>
      <div className={`connection-status ${status}`} role="status" data-testid="connection-status"><span className="status-dot" />{status === 'connected' ? 'Native core connected' : status === 'disconnected' ? 'Browser preview' : status === 'connecting' ? 'Connecting' : 'Core unavailable'}</div>
      <div className="profiles" role="group" aria-label="Resource profile">
        {profiles.map(({ id, label, Icon }) => <button key={id} className={frame?.profile === id ? 'active' : ''} disabled={status !== 'connected' || pending} aria-pressed={frame?.profile === id} aria-label={`${label} profile`} title={`${label} profile`} onClick={() => void changeProfile(id)}><Icon size={15} /><span>{label}</span></button>)}
      </div>
    </header>
    <div className="view-heading"><span className="eyebrow">LOCAL OBSERVATORY / 01</span><h2>Computer universe</h2><div className="view-state"><span className="thin-line" />{frame ? 'No collectors enabled' : 'Awaiting native telemetry'}</div></div>
    <nav className="view-tools" aria-label="Universe tools">
      <span className="icon-button selected" role="img" aria-label="Universe view" title="Universe view"><Box size={19} /></span>
      <span className="tool-divider" />
      <button className="icon-button" aria-label="Reset camera" title="Reset camera" onClick={() => setReset(value => value + 1)}><Crosshair size={19} /></button>
      <button className={`icon-button ${diagnostics ? 'selected' : ''}`} aria-label="Engine diagnostics" title="Engine diagnostics" aria-expanded={diagnostics} onClick={() => setDiagnostics(value => !value)}><Activity size={19} /></button>
    </nav>
    <div className="origin-label" aria-hidden="true"><span>ORIGIN</span><span>00 / 00 / 00</span></div>
    {diagnostics && <Diagnostics close={() => setDiagnostics(false)} />}
    {error && <div className="connection-notice" role="alert"><span>{error}</span>{status !== 'disconnected' && <button className="icon-button" aria-label="Reconnect core" title="Reconnect core" onClick={() => setConnectionAttempt(value => value + 1)}><RefreshCw size={17} /></button>}</div>}
    <footer className="statusbar">
      <div><span className="footer-label">OBSERVED ENTITIES</span><strong>0</strong></div>
      <span className="footer-context">PHASE 01 <span>/</span> FOUNDATION</span>
      <div className="privacy"><ShieldCheck size={14} /><span>Read-only</span><span className="footer-divider">/</span><span>History off</span></div>
    </footer>
  </main>
}
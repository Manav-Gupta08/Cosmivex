import { useState } from 'react'
import { ChevronLeft, ChevronRight, Crosshair, X } from 'lucide-react'
import { useCoreStore } from './state/core'
import { connectionOwner } from '../universe/network-layout'

function endpoint(address: string, port: number) { return `${address.includes(':') ? `[${address}]` : address}:${port}` }
function rate(value: number | null) { return value === null ? 'Unavailable' : `${(value / 1024).toFixed(1)} KiB/s` }

export function NetworkBrowser({ close }: { close: () => void }) {
  const network = useCoreStore(state => state.frame?.network)
  const ids = useCoreStore(state => state.networkIds)
  const [tab, setTab] = useState<'connections' | 'interfaces'>('connections')
  const [page, setPage] = useState(0)
  const visible = new Set(ids)
  const rows = network?.connections.filter(row => visible.has(row.id)) ?? []
  const interfaces = network?.interfaces ?? []
  const count = tab === 'connections' ? rows.length : interfaces.length
  const currentPage = Math.min(page, Math.max(0, Math.ceil(count / 50) - 1))
  const errors = network?.tableErrors.some(error => error !== 0) || network?.interfaceError
  return <aside className="process-browser network-browser" aria-label="Network list">
    <div className="panel-heading"><h2>Network <span className="count">{count}</span></h2><button className="icon-button" aria-label="Close network list" title="Close network list" onClick={close}><X size={17} /></button></div>
    <div className="network-tabs" role="tablist" aria-label="Network records"><button role="tab" aria-selected={tab === 'connections'} onClick={() => { setTab('connections'); setPage(0) }}>Endpoints</button><button role="tab" aria-selected={tab === 'interfaces'} onClick={() => { setTab('interfaces'); setPage(0) }}>Interfaces</button></div>
    {errors ? <p className="activity-gap">Partial collection: TCP4/TCP6/UDP4/UDP6 {network?.tableErrors.join('/')} / interfaces {network?.interfaceError}</p> : null}
    {network?.truncated && <p className="activity-gap">Network snapshot truncated.</p>}
    <div className="process-table-scroll"><table><thead><tr>{tab === 'connections' ? <><th>Endpoint</th><th>State</th><th>PID</th></> : <><th>Interface</th><th>RX</th><th>TX</th></>}</tr></thead><tbody>
      {tab === 'connections' ? rows.slice(currentPage * 50, (currentPage + 1) * 50).map(row => {
        const label = `${row.protocol} ${endpoint(row.localAddress, row.localPort)}${row.remoteAddress ? ` to ${endpoint(row.remoteAddress, row.remotePort!)}` : ''}, PID ${row.pid}`
        return <tr key={row.id}><td><button className="process-name" title={label} aria-label={label} onClick={() => { useCoreStore.getState().selectConnection(row.id); close() }}>{row.remoteAddress ? endpoint(row.remoteAddress, row.remotePort!) : endpoint(row.localAddress, row.localPort)}<small>{row.protocol} / IPv{row.family}</small></button></td><td>{row.state}</td><td>{row.pid}</td></tr>
      }) : interfaces.slice(currentPage * 50, (currentPage + 1) * 50).map(row => <tr key={row.id}><td><button className="process-name" title={row.name} onClick={() => { useCoreStore.getState().selectInterface(row.id); close() }}>{row.name || `Interface ${row.index}`}<small>{row.up ? 'Up' : 'Down'}</small></button></td><td>{row.receiveRate === null ? '--' : (row.receiveRate / 1024).toFixed(1)}</td><td>{row.sendRate === null ? '--' : (row.sendRate / 1024).toFixed(1)}</td></tr>)}
    </tbody></table>{count === 0 && <p className="empty-results">{network?.enabled ? 'No matching observations.' : 'Network collection is off.'}</p>}</div>
    <div className="pagination"><span>{tab === 'interfaces' ? 'Interface rates: KiB/s' : 'Observed socket metadata'}</span><button className="icon-button" aria-label="Previous network records" title="Previous network records" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {Math.max(1, Math.ceil(count / 50))}</span><button className="icon-button" aria-label="Next network records" title="Next network records" disabled={(currentPage + 1) * 50 >= count} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
  </aside>
}

export function NetworkInspector() {
  const connection = useCoreStore(state => state.selectedConnection)
  const networkInterface = useCoreStore(state => state.selectedInterface)
  const frame = useCoreStore(state => state.frame)
  const status = useCoreStore(state => state.status)
  if (!connection && !networkInterface) return null
  const network = frame?.network
  const present = connection ? network?.connections.some(row => row.id === connection.id) : network?.interfaces.some(row => row.id === networkInterface?.id)
  const state = status !== 'connected' ? 'Last observation / stream stale' : !network?.enabled ? 'Collection off' : network.tableErrors.some(error => error !== 0) || network.interfaceError ? 'Partial collection' : present ? 'Observed' : 'No longer observed'
  const owner = connection && frame ? connectionOwner(connection, frame.processes.rows) : undefined
  return <aside className="diagnostics network-inspector" aria-label="Network details">
    <div className="panel-heading"><h2>{connection ? `${connection.protocol} / IPv${connection.family}` : networkInterface!.name || 'Network interface'}</h2><button className="icon-button" aria-label="Close network details" title="Close network details" onClick={() => useCoreStore.getState().selectConnection(null)}><X size={17} /></button></div>
    <span className="process-status" data-testid="network-status">{state}</span>
    <div className="panel-section"><h3>{connection ? 'Socket observation' : 'Interface observation'}</h3><dl>
      {connection ? <>
        <dt>Local endpoint</dt><dd data-testid="network-local">{endpoint(connection.localAddress, connection.localPort)}</dd>
        <dt>Remote endpoint</dt><dd data-testid="network-remote">{connection.remoteAddress ? endpoint(connection.remoteAddress, connection.remotePort!) : 'Not observed'}</dd>
        <dt>State</dt><dd data-testid="network-state">{connection.state}</dd>
        <dt>Owner PID</dt><dd data-testid="network-pid">{connection.pid}</dd>
        <dt>Owner identity</dt><dd>{connection.ownerCreation ? 'Creation observed' : 'Unavailable'}</dd>
        <dt>Owner access</dt><dd>{connection.ownerError ? `Win32 ${connection.ownerError}` : 'Available'}</dd>
        <dt>Coalesced rows</dt><dd>{connection.observations}</dd>
        <dt>Connection traffic</dt><dd>Not available</dd>
      </> : <>
        <dt>Interface index</dt><dd>{networkInterface!.index}</dd>
        <dt>State</dt><dd>{networkInterface!.up ? 'Up' : 'Down'}</dd>
        <dt>Received</dt><dd data-testid="interface-rx">{rate(networkInterface!.receiveRate)}</dd>
        <dt>Sent</dt><dd data-testid="interface-tx">{rate(networkInterface!.sendRate)}</dd>
        <dt>Received bytes</dt><dd>{networkInterface!.receivedBytes}</dd>
        <dt>Sent bytes</dt><dd>{networkInterface!.sentBytes}</dd>
        <dt>Traffic scope</dt><dd>Interface / all processes</dd>
        <dt>Interface type</dt><dd>{networkInterface!.interfaceType}</dd>
      </>}
    </dl></div>
    {present && <button className="focus-process" onClick={() => connection ? useCoreStore.getState().selectConnection(connection.id) : useCoreStore.getState().selectInterface(networkInterface!.id)}><Crosshair size={15} /> Focus network object</button>}
    {owner && <button className="focus-process" onClick={() => { useCoreStore.getState().setViewMode('universe'); useCoreStore.getState().select(owner.id) }}>Open process ({owner.pid})</button>}
  </aside>
}
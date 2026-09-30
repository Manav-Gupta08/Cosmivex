import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import type { Profile } from '../../../shared/protocol/core'
import { applyPacket, ChunkAssembler, reconstructHistory, wireSchema } from '../../../shared/protocol/stream'
import { recordParseApply } from '../universe/metrics'
import { useCoreStore } from './state/core'

let subscriptionQueue: Promise<void> = Promise.resolve()

export function connectCore(): () => void {
  const store = useCoreStore.getState()
  store.begin()
  if (!isTauri()) {
    useCoreStore.setState({ status: 'disconnected', error: 'Native core unavailable in browser preview.' })
    return () => {}
  }
  let disposed = false
  let subscriptionId: number | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const assembler = new ChunkAssembler()
  let assemblyWorkMs = 0
  let measuredTransfer: string | null = null
  let failures = 0
  let resyncPending = false
  const resync = (id: number) => {
    assembler.reset()
    assemblyWorkMs = 0
    measuredTransfer = null
    if (resyncPending) return
    failures += 1
    if (failures > 3) { store.fail('Native telemetry remains incompatible. Reconnect to retry.'); return }
    resyncPending = true
    useCoreStore.setState({ status: 'stale', error: 'Resynchronizing native observations.' })
    void invoke('resync_core', { subscriptionId: id })
      .catch((error: unknown) => { if (!disposed) store.fail(String(error)) })
      .finally(() => { resyncPending = false })
  }
  const channel = new Channel<unknown>()
  channel.onmessage = raw => {
    if (disposed) return
    const started = performance.now()
    const result = wireSchema.safeParse(raw)
    if (!result.success) {
      store.fail('Incompatible native transport message. Reconnect to retry.')
      return
    }
    const chunk = result.data
    if (chunk.kind === 'error') { store.fail(chunk.message); return }
    try {
      const assembled = assembler.push(chunk)
      if (!assembled) return
      if (measuredTransfer !== chunk.transferId) { assemblyWorkMs = 0; measuredTransfer = chunk.transferId }
      const assembledAt = performance.now()
      assemblyWorkMs += assembledAt - started
      if (assembled.packet) {
        const frame = applyPacket(useCoreStore.getState().frame, assembled.packet)
        const validated = performance.now()
        store.receive(frame, assembled.wireBytes, performance.now(), assembled.packet)
        const completed = performance.now()
        recordParseApply(assemblyWorkMs + completed - assembledAt, assemblyWorkMs, validated - assembledAt, completed - validated)
        assemblyWorkMs = 0
        measuredTransfer = null
        failures = 0
      }
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        useCoreStore.setState({ status: 'stale', error: 'Native telemetry stream interrupted.' })
      }, (useCoreStore.getState().frame?.intervalMs ?? 5000) * 3)
      void invoke('ack_core', { subscriptionId: chunk.subscriptionId, transferId: chunk.transferId, chunkIndex: chunk.chunkIndex })
        .catch((error: unknown) => { if (!disposed) store.fail(String(error)) })
    } catch { resync(chunk.subscriptionId) }
  }
  subscriptionQueue = subscriptionQueue.then(async () => {
      if (disposed) return
      const id = await invoke<number>('subscribe_core', { protocolVersion: 7, onFrame: channel })
      subscriptionId = id
      if (disposed) await invoke('unsubscribe_core', { subscriptionId: id })
    })
    .catch((error: unknown) => { if (!disposed) store.fail(String(error)) })
  watchdog = setTimeout(() => store.fail('Native core did not respond.'), 10000)
  return () => {
    disposed = true
    assembler.reset()
    clearTimeout(watchdog)
    if (subscriptionId !== undefined) void invoke('unsubscribe_core', { subscriptionId }).catch(() => {})
  }
}

export async function setNativeProfile(profile: Profile): Promise<void> {
  await invoke('set_profile', { profile })
}

export async function setProcessCollection(enabled: boolean): Promise<void> {
  await invoke('set_process_collection', { enabled })
}

export async function resyncCore(): Promise<void> {
  const id = useCoreStore.getState().frame?.subscriptionId
  if (id !== undefined) await invoke('resync_core', { subscriptionId: id })
}

export async function setNetworkCollection(enabled: boolean): Promise<void> {
  await invoke('set_network_collection', { enabled })
}

export async function openFilesystemRoot(path: string): Promise<void> { await invoke('filesystem_root', { path }) }
export async function navigateFilesystem(scope: string, entry: string): Promise<void> { await invoke('filesystem_navigate', { scope, entry }) }
export async function stopFilesystem(): Promise<void> { await invoke('filesystem_stop') }

export type RecordingStatus = { enabled: boolean; error: string | null }

export async function readRecordingStatus(): Promise<RecordingStatus> {
  return invoke<RecordingStatus>('recording_status')
}

export async function setRecording(enabled: boolean): Promise<RecordingStatus> {
  return invoke<RecordingStatus>('set_recording', { enabled })
}

export type HistorySession = { id: string; startedMs: number; endedMs: number | null; protocolVersion: number; appVersion: string }

export async function readHistorySessions(): Promise<HistorySession[]> {
  return invoke<HistorySession[]>('history_sessions')
}

export async function readHistoryCheckpoints(session: string): Promise<number[]> {
  const times = await invoke<unknown>('history_checkpoints', { session })
  if (!Array.isArray(times) || times.length > 2048 || times.some((time, index) => !Number.isSafeInteger(time) || time < 0 || (index > 0 && time <= times[index - 1]))) {
    throw new Error('Invalid checkpoint timeline')
  }
  return times
}

export async function readHistoryCheckpoint(session: string, atMs: number) {
  const history = await invoke<unknown>('history_checkpoint', { session, atMs })
  return history === null ? null : reconstructHistory(history)
}

export type HistoryEvent = { sequence: number; observedMs: number; kind: string; payloadJson: string }

export async function readHistoryEvents(session: string, sinceMs: number): Promise<HistoryEvent[]> {
  const rows = await invoke<HistoryEvent[]>('history_events', { session, sinceMs })
  if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !Number.isSafeInteger(row.observedMs) || row.observedMs < sinceMs || typeof row.kind !== 'string' || typeof row.payloadJson !== 'string')) {
    throw new Error('Invalid history events')
  }
  return rows
}
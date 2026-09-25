import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import type { Profile } from '../../../shared/protocol/core'
import { applyPacket, ChunkAssembler, wireSchema } from '../../../shared/protocol/stream'
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
  let failures = 0
  let resyncPending = false
  const resync = (id: number) => {
    assembler.reset()
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
      if (assembled.packet) {
        const frame = applyPacket(useCoreStore.getState().frame, assembled.packet)
        store.receive(frame, assembled.wireBytes, performance.now(), assembled.packet)
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
      const id = await invoke<number>('subscribe_core', { protocolVersion: 4, onFrame: channel })
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
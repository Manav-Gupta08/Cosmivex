import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { coreFrameSchema, type Profile } from '../../../shared/protocol/core'
import { useCoreStore } from './state/core'

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
  const encoder = new TextEncoder()
  const channel = new Channel<unknown>()
  channel.onmessage = raw => {
    if (disposed) return
    const result = coreFrameSchema.safeParse(raw)
    if (!result.success) {
      store.fail('Incompatible native health message. Reconnect to retry.')
      return
    }
    const frame = result.data
    store.receive(frame, encoder.encode(JSON.stringify(raw)).byteLength, performance.now())
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      useCoreStore.setState({ status: 'stale', error: 'Native health stream interrupted.' })
    }, frame.intervalMs * 3)
    void invoke('ack_core', { subscriptionId: frame.subscriptionId, sequence: frame.sequence })
      .catch((error: unknown) => { if (!disposed) store.fail(String(error)) })
  }
  void invoke<number>('subscribe_core', { protocolVersion: 1, onFrame: channel })
    .then(id => {
      subscriptionId = id
      if (disposed) void invoke('unsubscribe_core', { subscriptionId: id }).catch(() => {})
    })
    .catch((error: unknown) => { if (!disposed) store.fail(String(error)) })
  watchdog = setTimeout(() => store.fail('Native core did not respond.'), 10000)
  return () => {
    disposed = true
    clearTimeout(watchdog)
    if (subscriptionId !== undefined) void invoke('unsubscribe_core', { subscriptionId }).catch(() => {})
  }
}

export async function setNativeProfile(profile: Profile): Promise<void> {
  await invoke('set_profile', { profile })
}
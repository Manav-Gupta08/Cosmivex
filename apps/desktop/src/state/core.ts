import { create } from 'zustand'
import type { CoreFrame } from '../../../../shared/protocol/core'

interface CoreState {
  status: 'connecting' | 'connected' | 'disconnected' | 'stale' | 'error'
  frame: CoreFrame | null
  bytesReceived: number
  lastReceivedAt: number | null
  error: string | null
  begin: () => void
  receive: (frame: CoreFrame, bytes: number, now: number) => void
  fail: (message: string) => void
}

export const useCoreStore = create<CoreState>((set) => ({
  status: 'connecting', frame: null, bytesReceived: 0, lastReceivedAt: null, error: null,
  begin: () => set({ status: 'connecting', frame: null, error: null, bytesReceived: 0, lastReceivedAt: null }),
  receive: (frame, bytes, now) => set(state => {
    if (state.frame?.subscriptionId === frame.subscriptionId && BigInt(state.frame.sequence) >= BigInt(frame.sequence)) return state
    return { status: 'connected', frame, bytesReceived: state.bytesReceived + bytes, lastReceivedAt: now, error: null }
  }),
  fail: error => set({ status: 'error', error }),
}))
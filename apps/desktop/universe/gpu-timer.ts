type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class GpuTimer {
  private readonly extension: TimerExtension | null
  private pending: { query: WebGLQuery; started: number; cpuMs: number }[] = []
  private current: { query: WebGLQuery; started: number } | null = null
  private readonly context: WebGL2RenderingContext
  private readonly record: (gpuMs: number, completionUpperBoundMs: number, cpuPlusGpuMs: number) => void

  constructor(context: WebGL2RenderingContext, record: (gpuMs: number, completionUpperBoundMs: number, cpuPlusGpuMs: number) => void) {
    this.context = context
    this.record = record
    this.extension = context.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
  }

  get supported() { return this.extension !== null }

  begin(started: number) {
    if (!this.extension || this.context.isContextLost()) return
    if (this.context.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      this.dispose()
      return
    }
    while (this.pending.length && this.context.getQueryParameter(this.pending[0].query, this.context.QUERY_RESULT_AVAILABLE)) {
      const sample = this.pending.shift()!
      const nanoseconds = Number(this.context.getQueryParameter(sample.query, this.context.QUERY_RESULT))
      if (Number.isFinite(nanoseconds) && nanoseconds >= 0) this.record(nanoseconds / 1e6, performance.now() - sample.started, sample.cpuMs + nanoseconds / 1e6)
      this.context.deleteQuery(sample.query)
    }
    if (this.current || this.pending.length >= 4) return
    const query = this.context.createQuery()
    if (!query) return
    this.current = { query, started }
    this.context.beginQuery(this.extension.TIME_ELAPSED_EXT, query)
  }

  end() {
    if (!this.current || !this.extension) return
    this.context.endQuery(this.extension.TIME_ELAPSED_EXT)
    this.pending.push({ ...this.current, cpuMs: performance.now() - this.current.started })
    this.current = null
  }

  dispose() {
    if (this.current && this.extension) {
      this.context.endQuery(this.extension.TIME_ELAPSED_EXT)
      this.context.deleteQuery(this.current.query)
      this.current = null
    }
    for (const sample of this.pending) this.context.deleteQuery(sample.query)
    this.pending = []
  }
}
export const renderMetrics = { frames: 0, drawCalls: 0, triangles: 0, submissionMs: 0, processInstances: 0, galaxyInstances: 0, parentLinks: 0, lifecycleEffects: 0, unknownMemoryInstances: 0, resourceMatrixEdits: 0, resourceColorEdits: 0, cameraMoving: false, networkInstances: 0, networkBridges: 0, interfaceInstances: 0, filesystemEntries: 0 }

const submissionSamples: number[] = []
const sampleLimit = 4096
const gpuSamples: number[] = []
const completionSamples: number[] = []
const frameWorkSamples: number[] = []
const frameCpuSamples: number[] = []
let gpuFrames = 0
let cpuFrames = 0
export const gpuStatus = { supported: false }
const parseApplySamples: number[] = []
const validationSamples: number[] = []
const assemblySamples: number[] = []
const reconstructionSamples: number[] = []
const storeUpdateSamples: number[] = []
let receivedPackets = 0
const movingIntervals: number[] = []
let movingFrames = 0
let previousMovingFrame: number | null = null

export function recordSubmission(milliseconds: number, renderedAt?: number) {
	renderMetrics.submissionMs = milliseconds
	submissionSamples[(renderMetrics.frames - 1) % sampleLimit] = milliseconds
	if (renderedAt !== undefined && renderMetrics.cameraMoving) {
		if (previousMovingFrame !== null) movingIntervals[movingFrames++ % sampleLimit] = renderedAt - previousMovingFrame
		previousMovingFrame = renderedAt
	} else previousMovingFrame = null
}

export function stopMovementSampling() { previousMovingFrame = null }

export function submissionP95() {
	if (!submissionSamples.length) return null
	const sorted = [...submissionSamples].sort((left, right) => left - right)
	return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

export function recordParseApply(milliseconds: number, assemblyMs: number, reconstructionMs: number, storeUpdateMs: number) {
	const index = receivedPackets++ % sampleLimit
	parseApplySamples[index] = milliseconds
	validationSamples[index] = assemblyMs + reconstructionMs
	assemblySamples[index] = assemblyMs
	reconstructionSamples[index] = reconstructionMs
	storeUpdateSamples[index] = storeUpdateMs
}

function p95(samples: number[]) {
	if (!samples.length) return null
	const sorted = [...samples].sort((left, right) => left - right)
	return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

export function parseApplyP95() { return p95(parseApplySamples) }
export function validationP95() { return p95(validationSamples) }
export function assemblyP95() { return p95(assemblySamples) }
export function reconstructionP95() { return p95(reconstructionSamples) }
export function storeUpdateP95() { return p95(storeUpdateSamples) }

export function movingCadenceP95() {
	if (!movingIntervals.length) return null
	const sorted = [...movingIntervals].sort((left, right) => left - right)
	return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

export function recordGpu(gpuMs: number, completionUpperBoundMs: number, cpuPlusGpuMs: number) {
	const index = gpuFrames++ % sampleLimit
	gpuSamples[index] = gpuMs
	completionSamples[index] = completionUpperBoundMs
	frameWorkSamples[index] = cpuPlusGpuMs
}

export function resetGpu(supported: boolean) {
	gpuStatus.supported = supported
	gpuSamples.length = 0
	completionSamples.length = 0
	frameWorkSamples.length = 0
	gpuFrames = 0
}

export function recordFrameCpu(milliseconds: number) { frameCpuSamples[cpuFrames++ % sampleLimit] = milliseconds }
export function gpuP95() { return p95(gpuSamples) }
export function completionP95() { return p95(completionSamples) }
export function frameWorkP95() { return p95(frameWorkSamples) }
export function frameCpuP95() { return p95(frameCpuSamples) }
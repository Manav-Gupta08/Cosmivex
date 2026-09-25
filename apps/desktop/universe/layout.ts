export function processPosition(id: string): [number, number, number] {
  let hash = 2166136261
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2
  hash = Math.imul(hash ^ (hash >>> 16), 2246822519)
  const radius = 3 + Math.sqrt((hash >>> 0) / 0xffffffff) * 14
  hash = Math.imul(hash ^ (hash >>> 13), 3266489917)
  const height = ((hash >>> 0) / 0xffffffff - 0.5) * 7
  return [Math.cos(angle) * radius, height, Math.sin(angle) * radius]
}
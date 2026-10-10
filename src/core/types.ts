import type * as THREE from 'three'

export type Quality = 'high' | 'mid' | 'low'
export type InputKind = 'down' | 'move' | 'up' | 'cancel'
export interface Tool { id: string; label: string; hint?: string }

export interface Layer {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly group: THREE.Group
  progress: number
  readonly settled: boolean
  readonly tools: Tool[]
  tool: string
  notice: string
  setTool(id: string): void
  input(p: THREE.Vector2, kind: InputKind): void
  update(dt: number): void
  setQuality(q: Quality): void
  dispose(): void
}

export const Y0 = -0.5 // 地平线
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)

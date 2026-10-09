import * as THREE from 'three'
import { createLayers } from './layers'
import { paperOverlay, uTime } from './materials'
import { track } from './analytics'
import type { Layer, Quality, InputKind } from './types'

export interface HudState {
  stage: number; total: number; progress: number; done: boolean
  quality: Quality; hint: string; names: string[]
}

const DPR: Record<Quality, number> = { high: 2, mid: 1.5, low: 1 }

/** 2 秒窗口平均帧率，连续两次低于阈值就降一档 */
export class PerfGuard {
  private acc = 0; private n = 0; private bad = 0
  constructor(public level: Quality, private onChange: (q: Quality, fps: number) => void) {}
  tick(dt: number) {
    this.acc += dt; this.n++
    if (this.acc < 2) return
    const fps = this.n / this.acc
    this.acc = 0; this.n = 0
    if (fps >= 42) { this.bad = 0; return }
    if (++this.bad >= 2 && this.level !== 'low') {
      this.level = this.level === 'high' ? 'mid' : 'low'
      this.bad = 0
      this.onChange(this.level, fps)
    }
  }
}

/** 阶段状态机：当前层进度满 → 停顿 → 进入下一层；旧层始终保留并继续 update */
export class StageMachine {
  index = -1
  done = false
  private completed = false
  private settle = 0
  private t0 = 0

  constructor(readonly layers: Layer[], scene: THREE.Scene) {
    layers.forEach(l => scene.add(l.group))
  }
  get current(): Layer | undefined { return this.layers[this.index] }

  input(p: THREE.Vector2, kind: InputKind) {
    if (this.index < 0) {
      if (kind !== 'down') return
      this.enter(0)
    }
    this.current?.input(p, kind)
  }

  update(dt: number) {
    for (const l of this.layers) l.update(dt)
    const c = this.current
    if (!c || this.done) return
    if (!this.completed && c.progress >= 1) {
      this.completed = true
      this.settle = 1
      track('stage_complete', { id: c.id, ms: Math.round(performance.now() - this.t0) })
    }
    if (this.completed && (this.settle -= dt) <= 0) {
      if (this.index + 1 < this.layers.length) this.enter(this.index + 1)
      else { this.done = true; track('game_complete') }
    }
  }

  private enter(i: number) {
    this.index = i
    this.completed = false
    this.t0 = performance.now()
    track('stage_enter', { id: this.layers[i].id, index: i })
  }
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 50)
  private paper = paperOverlay()
  private machine: StageMachine
  private perf: PerfGuard
  private quality: Quality
  private raf = 0
  private last = 0
  private down = false
  private ro: ResizeObserver
  private ac = new AbortController()

  constructor(private canvas: HTMLCanvasElement, private hud: HudState, private onFatal: (e: string) => void) {
    const weak = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4
    this.quality = weak ? 'mid' : 'high'
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor('#f2ead8')
    this.camera.position.z = 10
    this.scene.add(this.paper)

    this.machine = new StageMachine(createLayers(), this.scene)
    hud.names = this.machine.layers.map(l => l.label)
    hud.total = hud.names.length

    this.perf = new PerfGuard(this.quality, (q, fps) => {
      track('perf_degrade', { from: this.quality, to: q, fps: Math.round(fps) })
      this.setQuality(q)
    })

    const o = { signal: this.ac.signal }
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId)
      this.down = true
      this.machine.input(this.toWorld(e), 'down')
    }, o)
    canvas.addEventListener('pointermove', e => { if (this.down) this.machine.input(this.toWorld(e), 'move') }, o)
    const up = (e: PointerEvent) => { this.down = false; this.machine.input(this.toWorld(e), 'up') }
    canvas.addEventListener('pointerup', up, o)
    canvas.addEventListener('pointercancel', up, o)
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      track('error', { where: 'webgl', msg: 'context lost' })
      this.onFatal('context-lost')
    }, o)
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(this.raf)
      if (!document.hidden) this.start()
    }, o)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas)
    this.setQuality(this.quality)
  }

  start() {
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  reset() {
    this.machine.layers.forEach(l => { this.scene.remove(l.group); l.dispose() })
    this.machine = new StageMachine(createLayers(), this.scene)
    this.machine.layers.forEach(l => l.setQuality(this.quality))
    track('reset')
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera)
    this.canvas.toBlob(b => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = 'paper-grow.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      track('screenshot')
    })
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ac.abort()
    this.ro.disconnect()
    this.machine.layers.forEach(l => l.dispose())
    this.renderer.dispose()
  }

  private setQuality(q: Quality) {
    this.quality = q
    this.hud.quality = q
    this.machine.layers.forEach(l => l.setQuality(q))
    ;(this.paper.material as THREE.ShaderMaterial).uniforms.uQ.value = q === 'low' ? 0 : 1
    this.resize()
  }

  private resize() {
    const w = this.canvas.clientWidth || innerWidth
    const h = this.canvas.clientHeight || innerHeight
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, DPR[this.quality]))
    this.renderer.setSize(w, h, false)
    const a = w / h
    let hw = 4.5 * a, hh = 4.5
    if (a < 16 / 9) { hw = 8; hh = 8 / a } // 竖屏：保证 16 单位宽度可见
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh })
    this.camera.updateProjectionMatrix()
  }

  private toWorld(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    const u = (e.clientX - r.left) / r.width
    const v = 1 - (e.clientY - r.top) / r.height
    const c = this.camera
    return new THREE.Vector2(c.left + u * (c.right - c.left), c.bottom + v * (c.top - c.bottom))
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop)
    try {
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      uTime.value += dt
      this.machine.update(dt)
      this.perf.tick(dt)
      this.renderer.render(this.scene, this.camera)

      const m = this.machine, c = m.current, h = this.hud
      h.stage = m.index
      h.progress = c ? Math.min(1, c.progress) : 0
      h.done = m.done
      h.hint = m.done ? '世界长成了' : c ? c.hint : '点一下纸面，开始生长'
    } catch (e) {
      cancelAnimationFrame(this.raf)
      track('error', { where: 'loop', msg: String(e) })
      this.onFatal('loop')
    }
  }
}

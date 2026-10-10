import * as THREE from 'three'
import { createLayers } from './layers'
import { paperOverlay, uTime, uMotion } from './materials'
import { track } from './analytics'
import type { Layer, Quality, InputKind, Tool } from './types'
import { Landscape } from './placement'

export interface HudState {
  stage: number; total: number; progress: number; done: boolean
  quality: Quality; hint: string; names: string[]
  tools: Tool[]; tool: string
}

const DPR: Record<Quality, number> = { high: 2, mid: 1.5, low: 1 }
const EMPTY_TOOLS: Tool[] = []

/** 2 秒窗口平均帧率，连续两次低于阈值就降一档 */
export class PerfGuard {
  private acc = 0; private n = 0; private bad = 0
  constructor(public level: Quality, private onChange: (q: Quality, fps: number) => void) {}
  reset() { this.acc = 0; this.n = 0; this.bad = 0 }
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
  private drawing = false

  constructor(readonly layers: Layer[], scene: THREE.Scene) {
    layers.forEach(l => { l.group.visible = false; scene.add(l.group) })
  }
  get current(): Layer | undefined { return this.layers[this.index] }
  get painting() { return this.drawing }

  input(p: THREE.Vector2, kind: InputKind) {
    if (kind === 'up' || kind === 'cancel') { this.drawing = false; this.current?.input(p, kind); return }
    if (this.completed && !this.done) return
    if (this.index < 0) {
      if (kind !== 'down') return
      this.enter(0)
    }
    if (kind === 'down') this.drawing = true
    this.current?.input(p, kind)
  }

  select(i: number) {
    if (!this.done || !Number.isInteger(i) || i < 0 || i >= this.layers.length) return false
    this.index = i; this.completed = false; this.drawing = false
    this.layers[i].notice = ''
    return true
  }

  update(dt: number) {
    for (const l of this.layers) if (l.group.visible) l.update(dt)
    const c = this.current
    if (!c || this.done) return
    if (!this.completed && c.settled && !this.drawing) {
      this.completed = true
      this.settle = .55
      track('stage_complete', { id: c.id, ms: Math.round(performance.now() - this.t0) })
    }
    if (this.completed && (this.settle -= dt) <= 0) {
      if (this.index + 1 < this.layers.length) this.enter(this.index + 1)
      else { this.done = true; track('game_complete') }
    }
  }

  private enter(i: number) {
    this.index = i
    this.layers[i].group.visible = true
    this.completed = false
    this.t0 = performance.now()
    track('stage_enter', { id: this.layers[i].id, index: i })
  }
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private landscape = new Landscape()
  private camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 50)
  private paper = paperOverlay()
  private machine: StageMachine
  private perf: PerfGuard
  private quality: Quality
  private raf = 0
  private last = 0
  private pointer: number | null = null
  private point = new THREE.Vector2()
  private hudElapsed = 0
  private viewWidth = 0
  private viewHeight = 0
  private motion = matchMedia('(prefers-reduced-motion: reduce)')
  private ro: ResizeObserver
  private ac = new AbortController()

  constructor(private canvas: HTMLCanvasElement, private hud: HudState, private onFatal: (e: string) => void) {
    const weak = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4
    this.quality = weak ? 'mid' : 'high'
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    } catch (e) {
      this.paper.geometry.dispose(); this.paper.material.dispose()
      throw e
    }
    this.renderer.setClearColor('#f0efe5')
    this.camera.position.z = 10
    this.scene.add(this.paper)

    this.machine = new StageMachine(createLayers(this.landscape), this.scene)
    hud.names = this.machine.layers.map(l => l.label)
    hud.total = hud.names.length

    this.perf = new PerfGuard(this.quality, (q, fps) => {
      track('perf_degrade', { from: this.quality, to: q, fps: Math.round(fps) })
      this.setQuality(q)
    })

    const o = { signal: this.ac.signal }
    const motion = () => { uMotion.value = this.motion.matches ? 0 : 1 }
    motion()
    this.motion.addEventListener('change', motion, o)
    canvas.addEventListener('pointerdown', e => {
      if (!e.isPrimary || e.button !== 0 || this.pointer !== null) return
      canvas.setPointerCapture(e.pointerId)
      this.pointer = e.pointerId
      this.point.copy(this.toWorld(e))
      this.machine.input(this.point, 'down')
    }, o)
    canvas.addEventListener('pointermove', e => {
      if (this.pointer !== e.pointerId) return
      const samples = e.getCoalescedEvents?.() ?? []
      for (const sample of samples.length ? samples : [e]) {
        this.point.copy(this.toWorld(sample))
        this.machine.input(this.point, 'move')
      }
    }, o)
    const up = (e: PointerEvent) => {
      if (this.pointer !== e.pointerId) return
      if (e.type === 'pointerup') this.point.copy(this.toWorld(e))
      this.endStroke(e.type !== 'pointerup')
    }
    canvas.addEventListener('pointerup', up, o)
    canvas.addEventListener('pointercancel', up, o)
    canvas.addEventListener('lostpointercapture', up, o)
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      cancelAnimationFrame(this.raf)
      track('error', { where: 'webgl', msg: 'context lost' })
      this.onFatal('context-lost')
    }, o)
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(this.raf)
      this.endStroke(true)
      this.perf.reset()
      if (!document.hidden) this.start()
    }, o)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas)
    this.setQuality(this.quality)
  }

  start() {
    cancelAnimationFrame(this.raf)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  reset() {
    this.endStroke(true)
    this.machine.layers.forEach(l => { this.scene.remove(l.group); l.dispose() })
    this.landscape = new Landscape()
    this.machine = new StageMachine(createLayers(this.landscape), this.scene)
    this.machine.layers.forEach(l => l.setQuality(this.quality))
    this.resize()
    this.perf.reset()
    this.syncHud()
    track('reset')
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera)
    this.canvas.toBlob(b => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = '自由生长.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      track('screenshot')
    })
  }

  selectStage(i: number) {
    this.endStroke(true)
    if (this.machine.select(i)) this.syncHud()
  }

  selectTool(id: string) {
    this.endStroke(true)
    this.machine.current?.setTool(id); this.syncHud()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.endStroke(true)
    this.ac.abort()
    this.ro.disconnect()
    this.machine.layers.forEach(l => l.dispose())
    this.paper.geometry.dispose()
    this.paper.material.dispose()
    this.scene.clear()
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
    if (w !== this.viewWidth || h !== this.viewHeight) this.endStroke(true)
    this.viewWidth = w; this.viewHeight = h
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, DPR[this.quality]))
    this.renderer.setSize(w, h, false)
    const a = w / h
    const hw = Math.max(6.8, 4.5 * a), hh = hw / a
    const center = a < 1.4 ? -1.7 : -.2
    Object.assign(this.camera, { left: -hw, right: hw, top: hh + center, bottom: -hh + center })
    this.landscape.viewport = { left: -hw, right: hw, top: hh + center, bottom: -hh + center }
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
      const elapsed = Math.max(0, (now - this.last) / 1000)
      const dt = Math.min(0.05, elapsed)
      this.last = now
      uTime.value += dt
      this.machine.update(dt)
      this.perf.tick(elapsed)
      this.renderer.render(this.scene, this.camera)

      this.hudElapsed += dt
      if (this.hudElapsed >= .08 || this.hud.stage !== this.machine.index || this.hud.done !== this.machine.done) {
        this.syncHud()
        this.hudElapsed = 0
      }
    } catch (e) {
      cancelAnimationFrame(this.raf)
      track('error', { where: 'loop', msg: String(e) })
      this.onFatal('loop')
    }
  }

  private syncHud() {
    const m = this.machine, c = m.current, h = this.hud
    h.stage = m.index
    h.progress = c ? Math.round(Math.min(1, c.progress) * 200) / 200 : 0
    h.done = m.done
    h.tools = c?.tools ?? EMPTY_TOOLS
    h.tool = c?.tool ?? ''
    h.hint = c?.notice || (c ? !m.done && c.progress >= 1 ? m.painting ? '松开画笔，等最后一笔落下…' : '等最后一笔轻轻落下…' : c.hint : '点一下画纸，种下第一笔')
  }

  private endStroke(cancelled = false) {
    if (this.pointer === null) return
    const id = this.pointer
    this.pointer = null
    this.machine.input(this.point, cancelled ? 'cancel' : 'up')
    if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id)
  }
}

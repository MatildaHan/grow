import * as THREE from 'three'
import { type Layer, type Quality, type InputKind, Y0, clamp01, easeOut } from './types'
import { inkMat, mk, ribbon, uTime } from './materials'

const QF: Record<Quality, number> = { high: 1, mid: 0.6, low: 0.35 }
const V2 = (x: number, y: number) => new THREE.Vector2(x, y)
const rnd = Math.random

type Mat = THREE.ShaderMaterial
const setGrow = (m: Mat, g: number) => { m.uniforms.uGrow.value = g }

/* ───────── 基类 ───────── */
abstract class Base implements Layer {
  readonly group = new THREE.Group()
  progress = 0
  protected last: THREE.Vector2 | null = null
  constructor(readonly id: string, readonly label: string, readonly hint: string) {}

  input(p: THREE.Vector2, kind: InputKind) {
    if (kind === 'up') { this.last = null; return }
    if (kind === 'down') { this.last = p.clone(); this.onDown(p); return }
    if (!this.last) { this.last = p.clone(); return } // 拖动中途切入本层
    const d = p.distanceTo(this.last)
    this.last.copy(p)
    this.onDrag(p, d)
  }
  protected onDown(_p: THREE.Vector2) {}
  protected onDrag(_p: THREE.Vector2, _d: number) {}
  update(_dt: number) {}
  setQuality(_q: Quality) {}
  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.geometry) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
    })
  }
}

/** 拖动距离 → 进度 → 平滑后的显示进度 */
abstract class Reveal extends Base {
  protected shown = 0
  constructor(id: string, label: string, hint: string, private rate: number) { super(id, label, hint) }
  protected onDown() { this.progress = Math.min(1, this.progress + 0.01) }
  protected onDrag(_p: THREE.Vector2, d: number) { this.progress = Math.min(1, this.progress + d * this.rate) }
  update(dt: number) {
    this.shown += (this.progress - this.shown) * (1 - Math.exp(-5 * dt))
    if (this.progress >= 1 && this.shown > 0.995) this.shown = 1
    this.apply(this.shown)
  }
  protected abstract apply(g: number): void
}

/* ───────── 实例散布（草、麦） ───────── */
class Scatter {
  readonly mesh: THREE.InstancedMesh
  count = 0
  cap: number
  private born: THREE.InstancedBufferAttribute
  private seed: THREE.InstancedBufferAttribute
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private max: number) {
    this.cap = max
    this.born = new THREE.InstancedBufferAttribute(new Float32Array(max), 1)
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1)
    geo.setAttribute('aBorn', this.born)
    geo.setAttribute('aSeed', this.seed)
    this.mesh = new THREE.InstancedMesh(geo, mat, max)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }
  setCap(f: number) { this.cap = Math.floor(this.max * f) }
  add(x: number, y: number, z: number, s: number) {
    if (this.count >= this.cap) return
    this.m.compose(this.v.set(x, y, z), this.q, this.s.set(s, s, 1))
    this.mesh.setMatrixAt(this.count, this.m)
    this.born.setX(this.count, uTime.value)
    this.seed.setX(this.count, rnd())
    this.count++
    this.mesh.count = this.count
    this.mesh.instanceMatrix.needsUpdate = this.born.needsUpdate = this.seed.needsUpdate = true
  }
}

interface PaintOpts { density: number; spread: number; z: number; minY: number; maxY: number; size: number }

class Painter extends Base {
  constructor(id: string, label: string, hint: string, protected sc: Scatter, private o: PaintOpts) {
    super(id, label, hint)
    this.group.add(sc.mesh)
  }
  protected onDown(p: THREE.Vector2) { this.spawn(p, 4) }
  protected onDrag(p: THREE.Vector2, d: number) { this.spawn(p, Math.ceil(d * this.o.density)) }
  private spawn(p: THREE.Vector2, n: number) {
    const o = this.o
    for (let i = 0; i < n; i++) {
      const x = p.x + (rnd() - 0.5) * o.spread * 2
      let y = p.y + (rnd() - 0.5) * o.spread * 2
      y = p.y > o.maxY ? o.maxY - rnd() * 1.2 : Math.min(o.maxY, Math.max(o.minY, y))
      this.sc.add(x, y, o.z - y * 0.001, o.size * (0.6 + (Y0 - y) * 0.08))
    }
    this.progress = Math.min(1, this.sc.count / this.sc.cap)
  }
  setQuality(q: Quality) { this.sc.setCap(QF[q]) }
}

/* 1 草地 */
class GrassLayer extends Painter {
  private ground = inkMat('#a9bd82', { mode: 1, shade: 0.5 })
  constructor() {
    const s = new THREE.Shape()
    s.moveTo(-0.05, 0); s.lineTo(0.05, 0); s.lineTo(0, 0.55)
    super('grass', '草地', '按住并拖动，让草从纸上长出来',
      new Scatter(new THREE.ShapeGeometry(s), inkMat('#6f9a55', { mode: 3, sway: 1.2 }), 4000),
      { density: 18, spread: 0.5, z: -3, minY: -10, maxY: Y0 - 0.05, size: 1 })
    const g = mk(new THREE.PlaneGeometry(60, 30), this.ground)
    g.position.set(0, Y0 - 15, -3.2)
    this.group.add(g)
  }
  update() { setGrow(this.ground, easeOut(this.progress * 1.1)) }
}

/* 2 天空：三层色带 + 日出 */
class SkyLayer extends Reveal {
  private bands: Mat[] = []
  private sun = inkMat('#d9694a', { base: -0.7 })
  constructor() {
    super('sky', '天空', '拖动画笔，让天空晕染开', 0.1)
    const spec: [number, number, string][] = [[Y0, 2.5, '#f1e6c3'], [2.5, 5.2, '#dfe8d6'], [5.2, 40, '#c4d8d4']]
    for (const [a, b, c] of spec) {
      const m = inkMat(c, { mode: 1, shade: 0.2 })
      const mesh = mk(new THREE.PlaneGeometry(60, b - a), m)
      mesh.position.set(0, (a + b) / 2, -5)
      this.group.add(mesh); this.bands.push(m)
    }
    const sun = mk(new THREE.CircleGeometry(0.7, 32), this.sun)
    sun.position.set(4.5, 3.6, -4.9)
    this.group.add(sun)
  }
  protected apply(g: number) {
    this.bands.forEach(m => setGrow(m, g))
    setGrow(this.sun, clamp01((g - 0.6) / 0.4))
  }
}

/* 3 远山 */
class MountainLayer extends Reveal {
  private far: Mat; private near: Mat
  constructor() {
    super('mountain', '远山', '拖动，把远山一座座托起', 0.1)
    this.far = this.ridge(1, 1.6, 2.6, '#9db0aa', -4)
    this.near = this.ridge(7, 0.9, 2.0, '#6f8b84', -3.6)
  }
  private ridge(seed: number, base: number, amp: number, color: string, z: number) {
    let s = seed
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const B = Y0 - 0.3
    const sh = new THREE.Shape()
    sh.moveTo(-16, B)
    for (let x = -16; x <= 16; x += 1.3) sh.lineTo(x, Y0 + base * (0.5 + 0.5 * Math.sin(x * 0.45 + seed)) + amp * 0.5 * r())
    sh.lineTo(16, B); sh.closePath()
    const m = inkMat(color, { base: B })
    const mesh = mk(new THREE.ShapeGeometry(sh), m)
    mesh.position.z = z
    this.group.add(mesh)
    return m
  }
  protected apply(g: number) {
    setGrow(this.far, easeOut(g * 2))
    setGrow(this.near, easeOut(g * 2 - 1))
  }
}

/* 4 小路 / 7 河流：带状沿长度铺开 */
class RibbonLayer extends Reveal {
  private m: Mat
  constructor(id: string, label: string, hint: string, curve: THREE.Curve<THREE.Vector2>,
              w0: number, w1: number, color: string, z: number, flow = false) {
    super(id, label, hint, 0.09)
    this.m = inkMat(color, { mode: 2, shade: flow ? 0.7 : 0.5, flow })
    const mesh = mk(ribbon(curve, w0, w1), this.m)
    mesh.position.z = z
    this.group.add(mesh)
  }
  protected apply(g: number) { setGrow(this.m, g) }
}

/* 5 种树 */
const MAX_TREES = 6
class TreeLayer extends Base {
  private trees: { ms: Mat[]; t: number }[] = []
  constructor() { super('tree', '种树', '点按草地，种下六棵树') }
  protected onDown(p: THREE.Vector2) {
    if (this.trees.length >= MAX_TREES) return
    const y = Math.min(p.y, Y0 - 0.3)
    const g = new THREE.Group(), ms: Mat[] = []
    const add = (geo: THREE.BufferGeometry, color: string, base: number) => {
      const m = inkMat(color, { base, sway: 0.3 }); g.add(mk(geo, m)); ms.push(m)
    }
    add(new THREE.PlaneGeometry(0.2, 0.8).translate(0, 0.4, 0), '#6b4f3a', 0)
    for (const [w, by, c] of [[1.3, 0.55, '#4f7d4a'], [1.0, 1.05, '#5d8c52'], [0.7, 1.55, '#6a9a5a']] as const) {
      const s = new THREE.Shape()
      s.moveTo(-w, by); s.lineTo(w, by); s.lineTo(0, by + 0.9)
      add(new THREE.ShapeGeometry(s), c, by)
    }
    g.position.set(p.x, y, -y * 0.01)
    g.scale.setScalar(0.7 + (Y0 - y) * 0.1)
    this.group.add(g)
    this.trees.push({ ms, t: 0 })
    this.progress = this.trees.length / MAX_TREES
  }
  update(dt: number) {
    for (const tr of this.trees) {
      tr.t += dt / 1.6
      tr.ms.forEach((m, i) => setGrow(m, easeOut((tr.t - i * 0.18) / 0.6)))
    }
  }
}

/* 6 盖房 */
class HouseLayer extends Base {
  private parts: { m: Mat; start: number; dur: number }[] = []
  private t = 0
  private built = false
  constructor() { super('house', '盖房', '点一下草地，在那里盖一间小屋') }
  protected onDown(p: THREE.Vector2) {
    if (this.built) return
    this.built = true
    const y = Math.min(p.y, Y0 - 0.8)
    const g = new THREE.Group()
    const roof = new THREE.Shape()
    roof.moveTo(-1.2, 1.2); roof.lineTo(1.2, 1.2); roof.lineTo(0, 2.1)
    const spec: [THREE.BufferGeometry, string, number, number, number, number, number][] = [
      // 几何, 颜色, 底边, z偏移, 开始, 时长
      [new THREE.PlaneGeometry(1.8, 1.2).translate(0, 0.6, 0), '#e8d9b5', 0, 0, 0, 0.4, 0],
      [new THREE.ShapeGeometry(roof), '#b5533c', 1.2, 0.001, 0.5, 0.45, 0],
      [new THREE.PlaneGeometry(0.35, 0.6).translate(-0.4, 0.3, 0), '#6b4f3a', 0, 0.002, 0.4, 0.2, 0],
      [new THREE.PlaneGeometry(0.35, 0.35).translate(0.45, 0.75, 0), '#e9c46a', 0.575, 0.002, 0.4, 0.2, 0],
    ]
    for (const [geo, color, base, dz, start, dur] of spec) {
      const m = inkMat(color, { base })
      const mesh = mk(geo, m)
      mesh.position.z = dz
      g.add(mesh)
      this.parts.push({ m, start, dur })
    }
    g.position.set(p.x, y, -1 - y * 0.001)
    g.scale.setScalar(0.8 + (Y0 - y) * 0.05)
    this.group.add(g)
  }
  update(dt: number) {
    if (!this.built) return
    this.t += dt / 2.5
    for (const p of this.parts) setGrow(p.m, easeOut((this.t - p.start) / p.dur))
    this.progress = Math.min(1, this.t)
  }
}

/* 8 麦田 */
class WheatLayer extends Painter {
  constructor() {
    const s = new THREE.Shape()
    s.moveTo(-0.035, 0); s.lineTo(0.035, 0); s.lineTo(0.06, 0.55); s.lineTo(0, 0.8); s.lineTo(-0.06, 0.55)
    super('wheat', '麦田', '拖动，在田里撒下一片麦子',
      new Scatter(new THREE.ShapeGeometry(s), inkMat('#d9a441', { mode: 3, sway: 1.5 }), 1800),
      { density: 14, spread: 0.7, z: -1.5, minY: -10, maxY: Y0 - 0.3, size: 1 })
  }
}

export const createLayers = (): Layer[] => [
  new GrassLayer(),
  new SkyLayer(),
  new MountainLayer(),
  new RibbonLayer('path', '小路', '沿着想走的方向拖动，铺出一条小路',
    new THREE.CubicBezierCurve(V2(-5, -9.5), V2(3, -6.5), V2(-4, -3.2), V2(0.4, Y0 - 0.05)),
    2.6, 0.18, '#dcc9a0', -2.5),
  new TreeLayer(),
  new HouseLayer(),
  new RibbonLayer('river', '河流', '从远处向近处拖动，引一条河来',
    new THREE.CubicBezierCurve(V2(3, Y0 - 0.05), V2(6, -2.6), V2(1.5, -5), V2(4.5, -10)),
    0.15, 3, '#7fb0b8', -2.7, true),
  new WheatLayer(),
]

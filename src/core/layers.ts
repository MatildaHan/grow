import * as THREE from 'three'
import { type Layer, type Quality, type InputKind, Y0, clamp01, easeOut } from './types'
import { inkMat, mk, ribbon, uTime, uMotion } from './materials'

const QF: Record<Quality, number> = { high: 1, mid: 0.6, low: 0.35 }
const V2 = (x: number, y: number) => new THREE.Vector2(x, y)
const rnd = Math.random

/** 闭合的轻微起伏轮廓，保留手绘的不规则感。 */
function blob(rx: number, ry: number, seed: number) {
  const shape = new THREE.Shape()
  for (let i = 0; i <= 80; i++) {
    const a = i / 80 * Math.PI * 2
    const r = 1 + Math.sin(a * 5 + seed) * .045 + Math.cos(a * 9 - seed) * .025
    const x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

type Mat = THREE.ShaderMaterial
const setGrow = (m: Mat, g: number) => { m.uniforms.uGrow.value = g }

/* ───────── 基类 ───────── */
abstract class Base implements Layer {
  readonly group = new THREE.Group()
  progress = 0
  get settled() { return this.progress >= 1 }
  protected last: THREE.Vector2 | null = null
  constructor(readonly id: string, readonly label: string, readonly hint: string) {}

  input(p: THREE.Vector2, kind: InputKind) {
    if (kind === 'up') { this.last = null; return }
    if (kind === 'down') { this.last = p.clone(); this.onDown(p); return }
    if (!this.last) { this.last = p.clone(); return } // 拖动中途切入本层
    const d = p.distanceTo(this.last)
    this.onDrag(p, d, this.last)
    this.last.copy(p)
  }
  protected onDown(_p: THREE.Vector2) {}
  protected onDrag(_p: THREE.Vector2, _d: number, _from: THREE.Vector2) {}
  update(_dt: number) {}
  setQuality(_q: Quality) {}
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.geometry) {
        if (m instanceof THREE.InstancedMesh) m.dispose()
        geometries.add(m.geometry)
        for (const material of Array.isArray(m.material) ? m.material : [m.material]) materials.add(material)
      }
    })
    geometries.forEach(g => g.dispose())
    materials.forEach(m => m.dispose())
    this.group.clear()
  }
}

/** 拖动距离 → 进度 → 平滑后的显示进度 */
abstract class Reveal extends Base {
  protected shown = 0
  get settled() { return this.shown >= 1 }
  constructor(id: string, label: string, hint: string, private rate: number) { super(id, label, hint) }
  protected onDown() { this.progress = Math.min(1, this.progress + 0.01) }
  protected onDrag(_p: THREE.Vector2, d: number) { this.progress = Math.min(1, this.progress + d * this.rate) }
  update(dt: number) {
    this.shown += (this.progress - this.shown) * (1 - Math.exp(-(uMotion.value ? 8 : 18) * dt))
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
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.born.setUsage(THREE.DynamicDrawUsage)
    this.seed.setUsage(THREE.DynamicDrawUsage)
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

interface PaintOpts { density: number; spread: number; z: number; minY: number; maxY: number; size: number; distance: number }

class Painter extends Base {
  private remainder = 0
  private density = 1
  private lastBorn = -1
  private point = new THREE.Vector2()
  get settled() { return this.progress >= 1 && uTime.value - this.lastBorn >= (uMotion.value ? .65 : .25) }
  constructor(id: string, label: string, hint: string, protected sc: Scatter, private o: PaintOpts) {
    super(id, label, hint)
    sc.mesh.position.z = o.z // 透明笔触按网格深度排序，实例偏移只负责细微层次。
    this.group.add(sc.mesh)
  }
  protected onDown(p: THREE.Vector2) {
    this.remainder = 0
    this.spawn(p, 3)
    this.progress = clamp01(this.progress + .018)
  }
  protected onDrag(p: THREE.Vector2, d: number, from: THREE.Vector2) {
    if (d <= 0) return
    const step = 1 / (this.o.density * this.density)
    const distance = Math.min(d, (1 - this.progress) * this.o.distance)
    // 固定距离采样整段笔迹，快慢拖动、事件频率变化都不会留空洞。
    let cursor = step - this.remainder
    for (; cursor <= distance; cursor += step) {
      this.point.copy(from).lerp(p, cursor / d)
      this.spawn(this.point, 1)
    }
    this.remainder = (this.remainder + distance) % step
    this.progress = clamp01(this.progress + d / this.o.distance)
  }
  private spawn(p: THREE.Vector2, n: number) {
    const o = this.o
    for (let i = 0; i < n; i++) {
      const x = p.x + (rnd() - 0.5) * o.spread * 2
      let y = p.y + (rnd() - 0.5) * o.spread * 2
      y = p.y > o.maxY ? o.maxY - rnd() * 1.2 : Math.min(o.maxY, Math.max(o.minY, y))
      this.sc.add(x, y, -y * 0.001, o.size * (0.65 + (Y0 - y) * 0.055))
    }
    this.lastBorn = uTime.value
  }
  setQuality(q: Quality) { this.sc.setCap(QF[q]); this.density = QF[q] }
}

/* 1 草地 */
class GrassLayer extends Painter {
  private ground = inkMat('#b4c395', { mode: 1, shade: 0.7 })
  private shown = 0
  constructor() {
    const s = new THREE.Shape()
    for (const [x, h, bend] of [[-.13, .34, -.1], [0, .55, .12], [.12, .42, .16]]) {
      s.moveTo(x - .025, 0)
      s.quadraticCurveTo(x - .04, h * .5, x + bend, h)
      s.quadraticCurveTo(x + .045, h * .42, x + .025, 0)
    }
    super('grass', '草地', '按住并拖动，让草从纸上长出来',
      new Scatter(new THREE.ShapeGeometry(s), inkMat('#76955f', { mode: 3, sway: .7 }), 2400),
      { density: 30, spread: 0.38, z: -3, minY: -20, maxY: Y0 - 0.05, size: .85, distance: 40 })
    const g = mk(new THREE.PlaneGeometry(60, 30), this.ground)
    g.position.set(0, Y0 - 15, -3.2)
    this.group.add(g)
  }
  update(dt: number) {
    this.shown += (this.progress - this.shown) * (1 - Math.exp(-7 * dt))
    setGrow(this.ground, easeOut(this.shown))
  }
}

/* 2 天空：渐变晕染 + 日出 */
class SkyLayer extends Reveal {
  private bands: Mat[] = []
  private clouds: Mat[] = []
  private sun = inkMat('#d98c63', { base: -0.7, shade: .4 })
  constructor() {
    super('sky', '天空', '轻轻拖动，让天空染上颜色', 0.12)
    const m = inkMat('#f1e3bd', { mode: 1, shade: .35, tint: '#b8d1ce' })
    const wash = mk(new THREE.PlaneGeometry(60, 40), m)
    wash.position.set(0, Y0 + 20, -5)
    this.group.add(wash); this.bands.push(m)
    for (const [x, y, size] of [[-4, 2.9, 1], [.3, 3.5, .7], [6, 2.4, .6]]) {
      const cloud = inkMat('#faf3df', { mode: 1, shade: .2 })
      const mesh = mk(new THREE.ShapeGeometry(blob(1.1 * size, .23 * size, 4)), cloud)
      mesh.position.set(x, y, -4.7)
      this.group.add(mesh); this.clouds.push(cloud)
    }
    const sun = mk(new THREE.CircleGeometry(0.7, 32), this.sun)
    sun.position.set(4.5, 3.1, -4.9)
    this.group.add(sun)
  }
  protected apply(g: number) {
    this.bands.forEach(m => setGrow(m, g))
    this.clouds.forEach((m, i) => setGrow(m, clamp01((g - .35 - i * .08) / .4)))
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
    sh.moveTo(-32, B)
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= 40; i++) {
      const x = -32 + i * 1.6
      points.push(new THREE.Vector3(x, Y0 + base * (.5 + .5 * Math.sin(x * .45 + seed)) + amp * .5 * r()))
    }
    const curve = new THREE.CatmullRomCurve3(points)
    for (const p of curve.getPoints(360)) sh.lineTo(p.x, p.y)
    sh.lineTo(32, B); sh.closePath()
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
    this.m = inkMat(color, { mode: 2, shade: flow ? 0.7 : 0.5, flow, edge: true })
    const mesh = mk(ribbon(curve, w0, w1), this.m)
    mesh.position.z = z
    this.group.add(mesh)
  }
  protected apply(g: number) { setGrow(this.m, g) }
}

/* 5 种树 */
const MAX_TREES = 6
class TreeLayer extends Base {
  private trees: { ms: { m: Mat; delay: number }[]; t: number }[] = []
  get settled() { return this.progress >= 1 && this.trees.every(t => t.t >= 1.5) }
  constructor() { super('tree', '种树', '点按草地，种下六棵树') }
  protected onDown(p: THREE.Vector2) {
    if (this.trees.length >= MAX_TREES) return
    const y = Math.max(-6, Math.min(p.y, Y0 - 0.4))
    const g = new THREE.Group(), ms: { m: Mat; delay: number }[] = []
    const add = (geo: THREE.BufferGeometry, color: string, base: number, delay: number, z: number) => {
      const m = inkMat(color, { base, sway: .12 })
      const mesh = mk(geo, m); mesh.position.z = z; g.add(mesh); ms.push({ m, delay })
    }
    const n = this.trees.length
    const trunk = new THREE.CubicBezierCurve(V2(0, 0), V2(-.04, .5), V2(.07, 1), V2(.02, 1.8))
    add(ribbon(trunk, .16, .07, 24), '#735c43', 0, 0, -.02)
    for (const side of [-1, 1]) {
      add(ribbon(new THREE.QuadraticBezierCurve(V2(0, .6), V2(side * .28, .85), V2(side * .4, 1.3)), .07, .025, 16), '#735c43', .6, .16, -.01)
    }
    for (const [x, cy, rx, ry, color, delay] of [
      [-.38, 1.35, .62, .64, '#729365', .25],
      [.4, 1.48, .64, .7, '#88a471', .35],
      [.02, 1.94, .69, .74, n % 2 ? '#9aac7c' : '#7e9e6c', .5],
    ] as const) {
      const outline = new THREE.ShapeGeometry(blob(rx, ry, n + cy)).translate(x, cy, 0)
      const fill = new THREE.ShapeGeometry(blob(rx * .97, ry * .97, n + cy)).translate(x, cy + .015, 0)
      add(outline, '#657f56', cy - ry, delay, .01 + delay * .02)
      add(fill, color, cy - ry, delay, .02 + delay * .02)
    }
    g.position.set(Math.max(-6.1, Math.min(6.1, p.x)), y, -y * 0.01)
    g.scale.setScalar(0.62 + (Y0 - y) * 0.065)
    this.group.add(g)
    this.trees.push({ ms, t: 0 })
    this.progress = this.trees.length / MAX_TREES
  }
  update(dt: number) {
    for (const tr of this.trees) {
      tr.t += dt * (uMotion.value ? 1 : 3)
      tr.ms.forEach(({ m, delay }) => setGrow(m, easeOut((tr.t - delay) / .9)))
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
    const y = Math.max(-5.8, Math.min(p.y, Y0 - 0.8))
    const g = new THREE.Group()
    const roof = new THREE.Shape()
    roof.moveTo(-1.16, 1.18); roof.lineTo(1.18, 1.22); roof.lineTo(.06, 2.02); roof.closePath()
    const wall = new THREE.Shape()
    wall.moveTo(-.9, 0); wall.lineTo(.91, .015); wall.lineTo(.87, 1.28); wall.lineTo(-.88, 1.24); wall.closePath()
    const spec: [THREE.BufferGeometry, string, number, number, number, number][] = [
      // 几何, 颜色, 底边, z偏移, 开始, 时长
      [new THREE.ShapeGeometry(wall), '#a18c68', 0, 0, 0, .8],
      [new THREE.ShapeGeometry(wall).scale(.97, .98, 1).translate(0, .02, 0), '#eee0bd', 0, .01, 0, .8],
      [new THREE.PlaneGeometry(.2, .6).translate(.6, 1.55, 0), '#ae8160', 1.25, -.01, .2, .6],
      [new THREE.ShapeGeometry(roof), '#884f3d', 1.18, .02, .35, .8],
      [new THREE.ShapeGeometry(roof).scale(.96, .97, 1).translate(0, .03, 0), '#c7805b', 1.18, .03, .35, .8],
      [new THREE.PlaneGeometry(.35, .64).translate(-.37, .32, 0), '#806248', 0, .04, .65, .5],
      [new THREE.PlaneGeometry(.42, .39).translate(.43, .76, 0), '#957957', .565, .04, .8, .45],
      [new THREE.PlaneGeometry(.34, .31).translate(.43, .76, 0), '#efd799', .605, .05, .8, .45],
      [new THREE.PlaneGeometry(.025, .31).translate(.43, .76, 0), '#957957', .605, .06, .95, .35],
      [new THREE.PlaneGeometry(.34, .025).translate(.43, .76, 0), '#957957', .7475, .06, .95, .35],
    ]
    for (const [geo, color, base, dz, start, dur] of spec) {
      const m = inkMat(color, { base })
      const mesh = mk(geo, m)
      mesh.position.z = dz
      g.add(mesh)
      this.parts.push({ m, start, dur })
    }
    g.position.set(Math.max(-5.8, Math.min(5.8, p.x)), y, -1 - y * 0.001)
    g.scale.setScalar(0.8 + (Y0 - y) * 0.05)
    this.group.add(g)
  }
  update(dt: number) {
    if (!this.built) return
    this.t += dt * (uMotion.value ? 1 : 3)
    for (const p of this.parts) setGrow(p.m, easeOut((this.t - p.start) / p.dur))
    this.progress = Math.min(1, this.t / 1.5)
  }
}

/* 8 麦田 */
class WheatLayer extends Painter {
  constructor() {
    const s = new THREE.Shape()
    s.moveTo(-.018, 0); s.quadraticCurveTo(.015, .35, -.018, .72)
    s.lineTo(.018, .72); s.quadraticCurveTo(.05, .35, .018, 0)
    for (let i = 0; i < 4; i++) {
      const y = .48 + i * .085
      for (const side of [-1, 1]) {
        s.moveTo(0, y); s.quadraticCurveTo(side * .13, y + .015, side * .1, y + .12)
        s.quadraticCurveTo(side * .02, y + .12, 0, y)
      }
    }
    super('wheat', '麦田', '拖动，在田里撒下一片麦子',
      new Scatter(new THREE.ShapeGeometry(s), inkMat('#c7a45c', { mode: 3, sway: .85 }), 1800),
      { density: 24, spread: 0.45, z: -1.5, minY: -20, maxY: Y0 - 0.3, size: .85, distance: 32 })
  }
}

export const createLayers = (): Layer[] => [
  new GrassLayer(),
  new SkyLayer(),
  new MountainLayer(),
  new RibbonLayer('path', '小路', '沿着想走的方向拖动，铺出一条小路',
    new THREE.CubicBezierCurve(V2(0.4, Y0 - 0.05), V2(-4, -3.2), V2(3, -6.5), V2(-5, -24)),
    0.18, 3.6, '#dcc9a0', -2.5),
  new TreeLayer(),
  new HouseLayer(),
  new RibbonLayer('river', '河流', '从远处向近处拖动，引一条河来',
    new THREE.CubicBezierCurve(V2(3, Y0 - 0.05), V2(6, -2.6), V2(1.5, -8), V2(4.5, -24)),
    0.15, 5.5, '#7fb0b8', -2.7, true),
  new WheatLayer(),
]

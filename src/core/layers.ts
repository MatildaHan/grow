import * as THREE from 'three'
import { type Layer, type Quality, type InputKind, type Tool, Y0, clamp01, easeOut } from './types'
import { inkMat, inkGeometry, mk, sketched, sketchedRibbon, pencil, combine, uTime, uMotion, type InkOpts } from './materials'
import { grassGeometry, wheatGeometry, leaf } from './brushes'
import { Landscape } from './placement'

const QF: Record<Quality, number> = { high: 1, mid: .6, low: .35 }
const V2 = (x: number, y: number) => new THREE.Vector2(x, y)
const rnd = Math.random
type Mat = THREE.ShaderMaterial
const setGrow = (m: Mat, g: number) => { m.uniforms.uGrow.value = g }

function blob(rx: number, ry: number, seed: number) {
  const s = new THREE.Shape()
  for (let i = 0; i <= 80; i++) {
    const a = i / 80 * Math.PI * 2, r = 1 + Math.sin(a * 5 + seed) * .045 + Math.cos(a * 9 - seed) * .025
    const x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y)
  }
  s.closePath(); return s
}

function release(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    if (o instanceof THREE.InstancedMesh) o.dispose()
    geometries.add(o.geometry)
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m)
  })
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); group.clear()
}

abstract class Base implements Layer {
  readonly group = new THREE.Group()
  progress = 0
  notice = ''
  tool: string
  protected last: THREE.Vector2 | null = null
  private growing: { m: Mat; age: number; duration: number }[] = []
  get settled() { return this.progress >= 1 && this.growing.length === 0 }
  get hint() { return this.tools.find(t => t.id === this.tool)?.hint ?? this.guidance }
  constructor(readonly id: string, readonly label: string, private guidance: string, readonly tools: Tool[] = []) {
    this.tool = tools[0]?.id ?? 'default'
  }
  setTool(id: string) { if (this.tools.some(t => t.id === id)) { this.tool = id; this.notice = '' } }
  input(p: THREE.Vector2, kind: InputKind) {
    if (kind === 'up' || kind === 'cancel') {
      if (kind === 'up' && this.last && p.distanceTo(this.last) > .001) this.onDrag(p, p.distanceTo(this.last), this.last)
      this.last = null; this.onUp(kind === 'cancel', p); return
    }
    if (kind === 'down') { this.notice = ''; this.last = p.clone(); this.onDown(p); return }
    if (!this.last) { this.last = p.clone(); return }
    this.onDrag(p, p.distanceTo(this.last), this.last); this.last.copy(p)
  }
  protected onDown(_p: THREE.Vector2) {}
  protected onDrag(_p: THREE.Vector2, _d: number, _from: THREE.Vector2) {}
  protected onUp(_cancelled: boolean, _p: THREE.Vector2) {}
  protected animate(m: Mat, duration = .9, delay = 0) { this.growing.push({ m, age: -delay, duration }) }
  update(dt: number) {
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const a = this.growing[i]; a.age += dt * (uMotion.value ? 1 : 3)
      setGrow(a.m, easeOut(a.age / a.duration))
      if (a.age >= a.duration) this.growing.splice(i, 1)
    }
  }
  setQuality(_q: Quality) {}
  dispose() { release(this.group); this.growing = []; this.last = null }
}

abstract class Reveal extends Base {
  protected shown = 0
  get settled() { return this.shown >= 1 && super.settled }
  protected onDown(_p: THREE.Vector2) { this.progress = clamp01(this.progress + .03) }
  protected onDrag(_p: THREE.Vector2, d: number, _from: THREE.Vector2) { this.progress = clamp01(this.progress + d * .12) }
  update(dt: number) {
    super.update(dt)
    this.shown += (this.progress - this.shown) * (1 - Math.exp(-(uMotion.value ? 8 : 18) * dt))
    if (this.progress >= 1 && this.shown > .995) this.shown = 1
    this.apply(this.shown)
  }
  protected abstract apply(g: number): void
}

/** 实例满后追加新批次，不挪动或覆盖已经画好的植物。 */
class Scatter {
  readonly group = new THREE.Group()
  count = 0
  private current: THREE.InstancedMesh
  private matrix = new THREE.Matrix4()
  private rotation = new THREE.Quaternion()
  private axis = new THREE.Vector3(0, 0, 1)
  private position = new THREE.Vector3()
  private scale = new THREE.Vector3()
  constructor(geometry: THREE.BufferGeometry, private material: Mat) {
    this.current = this.batch(geometry)
  }
  private batch(g: THREE.BufferGeometry) {
    g.setAttribute('aBorn', new THREE.InstancedBufferAttribute(new Float32Array(512), 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(512), 1).setUsage(THREE.DynamicDrawUsage))
    const mesh = new THREE.InstancedMesh(g, this.material, 512)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false
    this.group.add(mesh); return mesh
  }
  add(x: number, y: number, size: number, angle: number) {
    if (this.current.count >= 512) this.current = this.batch(this.current.geometry.clone())
    const mesh = this.current, i = mesh.count
    this.rotation.setFromAxisAngle(this.axis, angle)
    this.matrix.compose(this.position.set(x, y, -y * .001), this.rotation, this.scale.set(size, size, 1))
    mesh.setMatrixAt(i, this.matrix)
    const born = mesh.geometry.attributes.aBorn, seed = mesh.geometry.attributes.aSeed
    born.setX(i, uTime.value); seed.setX(i, rnd())
    mesh.count++; this.count++
    mesh.instanceMatrix.needsUpdate = born.needsUpdate = seed.needsUpdate = true
  }
}

interface PaintOpts { density: number; spread: number; z: number; size: number; distance: number }
class Painter extends Base {
  private remainder = 0
  private density = 1
  private lastBorn = -1
  private lean = 0
  private point = new THREE.Vector2()
  get settled() { return super.settled && uTime.value - this.lastBorn >= (uMotion.value ? .65 : .25) }
  constructor(id: string, label: string, hint: string, tools: Tool[], private bank: Record<string, Scatter>, private o: PaintOpts, private landscape: Landscape) {
    super(id, label, hint, tools)
    for (const sc of Object.values(bank)) { sc.group.position.z = o.z; this.group.add(sc.group) }
  }
  protected onDown(p: THREE.Vector2) {
    this.remainder = 0; this.lean = (rnd() - .5) * .2
    this.spawn(p, 3); this.progress = clamp01(this.progress + .018)
  }
  protected onDrag(p: THREE.Vector2, d: number, from: THREE.Vector2) {
    if (d <= 0) return
    this.lean = -Math.atan2(p.x - from.x, Math.abs(p.y - from.y) + .2) * .45
    const step = 1 / (this.o.density * this.density)
    for (let cursor = step - this.remainder; cursor <= d; cursor += step) {
      this.point.copy(from).lerp(p, cursor / d); this.spawn(this.point, 1)
    }
    this.remainder = (this.remainder + d) % step
    this.progress = clamp01(this.progress + d / this.o.distance)
  }
  private spawn(p: THREE.Vector2, n: number) {
    for (let i = 0; i < n; i++) {
      const root = this.landscape.ground(V2(p.x + (rnd() - .5) * this.o.spread * 2, p.y + (rnd() - .5) * this.o.spread * 2))
      let key = this.tool
      if (key === 'mixed') { const r = rnd(); key = r < .55 ? 'fine' : r < .8 ? 'broad' : r < .94 ? 'fern' : 'flower' }
      if (this.id === 'wheat') key = this.tool === 'cluster' ? 'cluster' : 'single'
      const angle = (this.tool === 'left' ? .45 : this.tool === 'right' ? -.45 : this.lean) + (rnd() - .5) * .2
      this.bank[key].add(root.x, root.y, this.o.size * (.65 + (Y0 - root.y) * .045), angle)
    }
    this.lastBorn = uTime.value
  }
  setQuality(q: Quality) { this.density = QF[q] }
}

class GrassLayer extends Painter {
  private ground = inkMat('#d3dcbc', { mode: 1, shade: .5, hatch: .25 })
  private shown = 0
  constructor(landscape: Landscape) {
    const bank: Record<string, Scatter> = {}
    for (const kind of ['fine', 'broad', 'fern', 'flower']) bank[kind] = new Scatter(grassGeometry(kind),
      inkMat(kind === 'broad' ? '#a8bc91' : '#93ad83', { mode: 3, sway: .7, ink: '#627b60', accent: '#c5a09b' }))
    super('grass', '草地', '按住拖动，在笔迹经过的地方种草',
      [{ id: 'mixed', label: '混合' }, { id: 'fine', label: '细草' }, { id: 'broad', label: '阔叶' }, { id: 'fern', label: '蕨草' }, { id: 'flower', label: '野花' }],
      bank, { density: 21, spread: .4, z: -3, size: .7, distance: 40 }, landscape)
    const mesh = mk(new THREE.PlaneGeometry(80, 60), this.ground)
    mesh.position.set(0, Y0 - 30, -3.2); this.group.add(mesh)
  }
  update(dt: number) {
    super.update(dt)
    this.shown += (this.progress - this.shown) * (1 - Math.exp(-7 * dt))
    setGrow(this.ground, easeOut(this.shown))
  }
}

class SkyLayer extends Reveal {
  private wash = inkMat('#f0efe4', { mode: 1, shade: .15, tint: '#dde7df' })
  private firstSun = false
  private remainder = 0
  private count = 0
  constructor(private landscape: Landscape) {
    super('sky', '天空', '拖动晕染天空，点按或拖动添加云朵',
      [{ id: 'cloud', label: '云朵' }, { id: 'sun', label: '日光', hint: '点按天空放下日光，拖动晕染天空' }])
    const mesh = mk(new THREE.PlaneGeometry(80, 60), this.wash)
    mesh.position.set(0, Y0 + 30, -5); this.group.add(mesh)
  }
  protected onDown(p: THREE.Vector2) {
    super.onDown(p); this.remainder = 0; this.stamp(p)
    if (!this.firstSun && this.tool === 'cloud') {
      this.sun(V2(p.x + 1.4, Math.min(this.landscape.viewport.top - 1.1, p.y + .8))); this.firstSun = true
    }
  }
  protected onDrag(p: THREE.Vector2, d: number, from: THREE.Vector2) {
    super.onDrag(p, d, from)
    if (this.tool === 'sun') return
    for (let cursor = 1.8 - this.remainder; cursor <= d; cursor += 1.8) this.stamp(from.clone().lerp(p, cursor / d))
    this.remainder = (this.remainder + d) % 1.8
  }
  private stamp(p: THREE.Vector2) {
    if (this.tool === 'sun') { this.sun(p); this.firstSun = true; return }
    const m = inkMat('#f8f7ee', { mode: 1, shade: .2, ink: '#a4b3a3', opacity: .8 })
    const size = .65 + rnd() * .45
    const mesh = mk(sketched(blob(size, size * .22, ++this.count), .01), m)
    mesh.position.set(p.x, Math.max(Y0 + .5, p.y), -4.7); this.group.add(mesh); this.animate(m, .75)
  }
  private sun(p: THREE.Vector2) {
    const fill = sketched(blob(.58, .58, ++this.count), .014), rays: THREE.BufferGeometry[] = []
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6
      rays.push(pencil([V2(Math.cos(a) * .72, Math.sin(a) * .72), V2(Math.cos(a + .012) * .87, Math.sin(a + .012) * .87)], .022))
    }
    const m = inkMat('#e8cd78', { base: -.9, shade: .35, ink: '#9e905c', hatch: .35 })
    const mesh = mk(combine([fill, ...rays]), m)
    mesh.position.set(p.x, Math.max(Y0 + 1.1, p.y), -4.8); this.group.add(mesh); this.animate(m)
  }
  protected apply(g: number) { setGrow(this.wash, g) }
}

class MountainLayer extends Base {
  private remainder = 0
  private count = 0
  constructor() {
    super('mountain', '远山', '沿地平线上方拖动，画出不同远近的山',
      [{ id: 'stack', label: '层叠' }, { id: 'far', label: '远山' }, { id: 'mid', label: '中山' }, { id: 'near', label: '近山' }])
  }
  protected onDown(p: THREE.Vector2) { this.remainder = 0; this.stamp(p); this.progress = clamp01(this.progress + .12) }
  protected onDrag(p: THREE.Vector2, d: number, from: THREE.Vector2) {
    for (let cursor = 2.5 - this.remainder; cursor <= d; cursor += 2.5) this.stamp(from.clone().lerp(p, cursor / d))
    this.remainder = (this.remainder + d) % 2.5
    this.progress = clamp01(this.progress + d * .1)
  }
  private stamp(p: THREE.Vector2) {
    const depths = this.tool === 'stack' ? [0, 1, 2] : [this.tool === 'far' ? 0 : this.tool === 'mid' ? 1 : 2]
    const n = ++this.count, peak = Math.max(.55, Math.min(4.5, p.y - Y0))
    for (const depth of depths) {
      const width = 6.2 - depth * 1.35 + Math.sin(n * 1.7) * .7
      const height = peak * (1 - depth * .16), offset = Math.sin(n * 2.1 + depth) * .7
      const points = [V2(-width / 2, 0), V2(-width * .34, height * (.3 + rnd() * .2)),
        V2(-width * .12, height * (.65 + rnd() * .3)), V2(width * .08, height * (.5 + rnd() * .3)),
        V2(width * .28, height * (.25 + rnd() * .45)), V2(width / 2, 0)]
      const curve = new PencilPath(points), shape = new THREE.Shape()
      shape.moveTo(-width / 2, 0)
      for (const point of curve.getPoints(70)) shape.lineTo(point.x, point.y)
      shape.closePath()
      const m = inkMat(['#d1ddd5', '#becfc2', '#a8c0ad'][depth], { base: 0, ink: '#829b88', opacity: .8 + depth * .07, hatch: .6 + depth * .25 })
      const mesh = mk(sketched(shape, .015), m)
      mesh.position.set(p.x + offset, Y0 - .2, -4.65 + depth * .47 + n * .0001)
      this.group.add(mesh); this.animate(m, .8, depth * .1)
    }
  }
}

class PencilPath extends THREE.Curve<THREE.Vector2> {
  private curve: THREE.CatmullRomCurve3
  constructor(points: THREE.Vector2[]) { super(); this.curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p.x, p.y, 0))) }
  getPoint(t: number, target = new THREE.Vector2()) { const p = this.curve.getPoint(t); return target.set(p.x, p.y) }
}
interface Stroke { points: THREE.Vector2[]; mesh: THREE.Mesh<THREE.BufferGeometry, Mat>; factor: number; age: number; dirty: boolean; previousProgress: number }
class RibbonLayer extends Base {
  private active: Stroke | null = null
  private strokes: Stroke[] = []
  private count = 0
  get settled() { return super.settled && !this.active && this.strokes.every(s => s.age >= .4) }
  constructor(id: string, label: string, private landscape: Landscape, private river = false) {
    super(id, label, '按住拖动画出走向；轻点可向近处延伸', river
      ? [{ id: 'stream', label: '溪流' }, { id: 'bend', label: '河湾' }, { id: 'wide', label: '宽河' }]
      : [{ id: 'trail', label: '小径' }, { id: 'country', label: '乡间' }, { id: 'wide', label: '宽路' }])
  }
  protected onDown(p: THREE.Vector2) {
    const root = this.landscape.ground(p)
    const m = inkMat(this.river ? '#adcac4' : '#e0dcc0', { mode: 2, shade: .4, flow: this.river, hatch: .35, ink: this.river ? '#6d9691' : '#9c977c' })
    const mesh = mk(sketchedRibbon(new PencilPath([root, root.clone().add(V2(0, -.04))]), .1, .1), m)
    mesh.position.z = this.river ? -2.7 : -2.5
    const stroke: Stroke = { points: [root], mesh, factor: this.tool === 'wide' ? 1.35 : this.tool === 'trail' || this.tool === 'stream' ? .65 : 1, age: 0, dirty: false, previousProgress: this.progress }
    this.group.add(mesh); this.active = stroke; this.strokes.push(stroke); this.count++
    this.progress = clamp01(this.progress + .05)
  }
  protected onDrag(p: THREE.Vector2, _d: number) {
    const s = this.active
    if (!s) return
    const point = this.landscape.ground(p), d = point.distanceTo(s.points[s.points.length - 1])
    if (d < .08) return
    s.points.push(point); s.dirty = true
    if (s.points.length > 192) s.points = s.points.filter((_, i, list) => i % 2 === 0 || i === list.length - 1)
    this.progress = clamp01(this.progress + d * .28)
  }
  protected onUp(cancelled: boolean, p: THREE.Vector2) {
    const s = this.active
    if (!s) return
    if (cancelled && s.points.length === 1) {
      this.group.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose()
      this.strokes = this.strokes.filter(stroke => stroke !== s); this.progress = s.previousProgress; this.active = null; return
    }
    if (!cancelled && s.points.length > 1) {
      const end = this.landscape.ground(p), last = s.points[s.points.length - 1]
      if (end.distanceTo(last) > .001) { s.points.push(end); s.dirty = true }
    }
    if (s.points.length === 1 && !cancelled) {
      const root = s.points[0], end = this.landscape.viewport.bottom - .8
      const x = Math.max(this.landscape.viewport.left + .5, Math.min(this.landscape.viewport.right - .5, root.x + Math.sin(this.count * 1.7) * 1.6))
      s.points.push(V2(root.x + Math.cos(this.count) * .65, root.y + (end - root.y) * .3), V2(x, end))
      this.progress = clamp01(this.progress + (root.y - end) * .28); s.dirty = true
    }
    if (!cancelled && s.points.length > 1) {
      const end = s.points[s.points.length - 1], before = s.points[Math.max(0, s.points.length - 5)]
      const direction = end.clone().sub(before)
      if (end.y <= this.landscape.viewport.bottom + .45 && direction.y < -.05 && end.y > -32) {
        const depth = -32 - end.y
        s.points.push(V2(end.x + direction.x / direction.y * depth, -32)); s.dirty = true
      }
    }
    this.active = null
  }
  update(dt: number) {
    super.update(dt)
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]; s.age += dt * (uMotion.value ? 1 : 3)
      if (s.dirty && s.points.length > 1) {
        const old = s.mesh.geometry
        s.mesh.geometry = inkGeometry(sketchedRibbon(new PencilPath(s.points), 0, 0,
          p => s.factor * (.14 + Math.max(0, Y0 - p.y) * (this.river ? .36 : .23)), Math.min(192, Math.max(32, s.points.length * 3))))
        old.dispose(); s.dirty = false
      }
      setGrow(s.mesh.material, easeOut(s.age / .4))
      if (s !== this.active && s.age >= .4) this.strokes.splice(i, 1)
    }
  }
  dispose() { super.dispose(); this.active = null; this.strokes = [] }
}

class TreeLayer extends Base {
  private count = 0
  constructor(private landscape: Landscape) {
    super('tree', '种树', '点按草地种树，可选择不同树形',
      [{ id: 'mixed', label: '混合' }, { id: 'broad', label: '阔叶' }, { id: 'pine', label: '松树' }, { id: 'round', label: '圆冠' }, { id: 'willow', label: '柳树' }])
  }
  protected onDown(p: THREE.Vector2) {
    if (p.y > Y0 + .2) { this.notice = '请在草地上种树'; return }
    const root = this.landscape.ground(p), n = this.count
    const kind = this.tool === 'mixed' ? ['broad', 'pine', 'round', 'willow'][n % 4] : this.tool
    const group = new THREE.Group(), parts: { m: Mat; delay: number }[] = []
    group.userData.kind = kind
    const add = (geo: THREE.BufferGeometry, color: string, base: number, delay: number, z: number, opts: InkOpts = {}) => {
      const m = inkMat(color, { base, sway: .12, ...opts }), mesh = mk(geo, m)
      mesh.position.z = z; group.add(mesh); parts.push({ m, delay })
    }
    add(new THREE.ShapeGeometry(blob(.65, .1, n)), '#90a077', -.1, 0, -.05, { opacity: .2 })
    const stems: THREE.BufferGeometry[] = [pencil(new THREE.CubicBezierCurve(V2(0, 0), V2(-.06, .6), V2(.08, 1.5), V2(0, 2.3)).getPoints(36), .04)]
    const leaves: THREE.BufferGeometry[] = [], veins: THREE.BufferGeometry[] = []
    const addLeaf = (x: number, y: number, height: number, angle: number, width = .3) => {
      leaves.push(sketched(leaf(width, height), .013, 12).rotateZ(angle).translate(x, y, 0))
      const lines = [pencil(new THREE.QuadraticBezierCurve(V2(0, 0), V2(.025, height * .5), V2(0, height * .92)).getPoints(12), .009)]
      for (const side of [-1, 1]) for (const t of [.3, .5, .7]) lines.push(pencil([V2(0, height * t), V2(side * width * .47, height * (t + .13))], .006))
      veins.push(combine(lines).rotateZ(angle).translate(x, y, 0))
    }
    if (kind === 'pine') {
      for (let tier = 0; tier < 4; tier++) {
        const width = 1 - tier * .19, y = .45 + tier * .45, shape = new THREE.Shape()
        shape.moveTo(-width, y)
        for (let i = 0; i <= 6; i++) shape.lineTo(-width + i * width / 3, y + Math.sin(i * 2) * .07)
        shape.lineTo(.02, y + .98); shape.closePath()
        add(sketched(shape, .017), ['#97ad8c', '#a5ba97', '#b0c49f', '#bacba8'][tier], y, .18 + tier * .09, .02 + tier * .002, { hatch: .9 })
      }
    } else if (kind === 'round') {
      for (const [x, y, rx, ry] of [[-.42, 1.45, .65, .7], [.4, 1.65, .66, .75], [0, 2.12, .7, .7]])
        add(sketched(blob(rx, ry, n + y)).translate(x, y, 0), '#b7c698', y - ry, .2, .01 + y * .001, { hatch: .9 })
      for (let i = 0; i < 8; i++) {
        const x = Math.sin(i * 2.4) * .65, y = 1.05 + i * .16
        stems.push(pencil([V2(0, y - .3), V2(x, y)], .018)); addLeaf(x, y, .32, Math.sin(i) * .8, .12)
      }
    } else if (kind === 'willow') {
      add(sketched(blob(1, .55, n)).translate(0, 1.9, 0), '#b5cda7', 1.2, .15, -.02, { opacity: .7, hatch: .7 })
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * .27, curve = new THREE.QuadraticBezierCurve(V2(0, 1.6), V2(x * 1.8, 2.6), V2(x * 1.25, .6 + Math.abs(x) * .2))
        stems.push(pencil(curve.getPoints(24), .02))
        for (const t of [.35, .5, .65, .8]) { const a = curve.getPoint(t); addLeaf(a.x, a.y, .3, 2.7 + Math.sin(i) * .3, .07) }
      }
    } else {
      for (const [x, cy, rx, ry] of [[-.36, 1.35, .6, .6], [.36, 1.5, .62, .65], [0, 1.95, .62, .65]])
        add(new THREE.ShapeGeometry(blob(rx, ry, n + cy)).translate(x, cy, 0), '#bfd0a3', cy - ry, .15, -.04, { opacity: .4, hatch: .6 })
      for (let row = 0; row < 4; row++) for (const side of [-1, 1]) {
        const y = .85 + row * .33, x = side * (.2 + (3 - row) * .035)
        stems.push(pencil(new THREE.QuadraticBezierCurve(V2(0, y - .18), V2(side * .13, y - .02), V2(x, y)).getPoints(12), .022))
        addLeaf(x, y, .7 + Math.sin(n + row) * .06, -side * (.65 + row * .04))
      }
      addLeaf(0, 2.1, .65, .08)
    }
    add(combine(stems), '#6b7256', 0, 0, kind === 'round' || kind === 'willow' ? .03 : -.01, { ink: '#6b7256' })
    if (leaves.length) {
      add(combine(leaves), n % 2 ? '#adbf8e' : '#9eb78b', .6, .3, .04, { hatch: .8, ink: '#5f775b' })
      add(combine(veins), '#647c5c', .6, .5, .05, { ink: '#647c5c', opacity: .6 })
    }
    group.position.set(root.x, root.y, -root.y * .01)
    group.scale.setScalar(.62 + (Y0 - root.y) * .065)
    const footprint = this.landscape.footprint(group, 'tree')
    if (this.landscape.overlaps(footprint, 'house')) { release(group); this.notice = '这里已有房屋，请在旁边种树'; return }
    this.landscape.occupied.push(footprint); this.group.add(group)
    parts.forEach(({ m, delay }) => this.animate(m, .9, delay))
    this.count++; this.progress = clamp01(this.count / 6)
  }
}

class HouseLayer extends Base {
  private count = 0
  private elapsed = 0
  constructor(private landscape: Landscape) {
    super('house', '盖房', '点按空地盖房，房屋会避开已有树木', [{ id: 'cottage', label: '小屋' }, { id: 'barn', label: '谷仓' }])
  }
  protected onDown(p: THREE.Vector2) {
    if (p.y > Y0 + .2) { this.notice = '请在草地的空位盖房'; return }
    const root = this.landscape.ground(p), group = new THREE.Group(), barn = this.tool === 'barn'
    const roof = new THREE.Shape(), wall = new THREE.Shape()
    roof.moveTo(-1.16, 1.18); roof.lineTo(1.18, 1.22); roof.lineTo(.06, barn ? 2.25 : 2.02); roof.closePath()
    wall.moveTo(-.9, 0); wall.lineTo(.91, .015); wall.lineTo(.87, 1.28); wall.lineTo(-.88, 1.24); wall.closePath()
    const spec: [THREE.BufferGeometry, string, number, number, number, number][] = [
      [sketched(wall, .024), barn ? '#cfbea4' : '#e8e5cb', 0, .01, 0, .8],
      [new THREE.PlaneGeometry(.2, .6).translate(.6, 1.55, 0), '#ae8160', 1.25, -.01, .2, .6],
      [sketched(roof, .022), barn ? '#8eaaa4' : '#bb9984', 1.18, .03, .35, .8],
      [new THREE.PlaneGeometry(barn ? .65 : .35, .64).translate(-.37, .32, 0), '#806248', 0, .04, .65, .5],
      [new THREE.PlaneGeometry(.42, .39).translate(.43, .76, 0), '#957957', .565, .04, .8, .45],
      [new THREE.PlaneGeometry(.34, .31).translate(.43, .76, 0), '#efd799', .605, .05, .8, .45],
      [new THREE.PlaneGeometry(.025, .31).translate(.43, .76, 0), '#957957', .605, .06, .95, .35],
      [new THREE.PlaneGeometry(.34, .025).translate(.43, .76, 0), '#957957', .7475, .06, .95, .35],
    ]
    const parts: { m: Mat; start: number; duration: number }[] = []
    for (const [geo, color, base, z, start, duration] of spec) {
      const m = inkMat(color, { base, ink: '#796f58', hatch: .65 }), mesh = mk(geo, m)
      mesh.position.z = z; mesh.renderOrder = 200 // 始终覆盖所有景物；纸纹叠层仍在最上面。
      group.add(mesh); parts.push({ m, start, duration })
    }
    group.position.set(root.x, root.y, 1)
    group.scale.setScalar(.75 + (Y0 - root.y) * .05)
    group.userData.kind = this.tool
    const footprint = this.landscape.footprint(group, 'house')
    if (this.landscape.overlaps(footprint, 'tree') || this.landscape.overlaps(footprint, 'house')) {
      release(group); this.notice = '这里已有树木或房屋，换一处空地试试'; return
    }
    this.landscape.occupied.push(footprint); this.group.add(group)
    parts.forEach(({ m, start, duration }) => this.animate(m, duration, start)); this.count++
  }
  update(dt: number) {
    super.update(dt)
    if (this.count) { this.elapsed += dt * (uMotion.value ? 1 : 3); this.progress = clamp01(this.elapsed / 1.5) }
  }
}

class WheatLayer extends Painter {
  constructor(landscape: Landscape) {
    const bank: Record<string, Scatter> = {}
    for (const kind of ['single', 'cluster']) bank[kind] = new Scatter(wheatGeometry(kind === 'cluster'),
      inkMat('#c9bd80', { mode: 3, sway: .85, ink: '#948653', hatch: .5 }))
    super('wheat', '麦田', '在田里拖动播种，麦穗随笔迹方向轻轻倾斜',
      [{ id: 'follow', label: '随笔' }, { id: 'left', label: '向左' }, { id: 'right', label: '向右' }, { id: 'cluster', label: '穗丛' }],
      bank, { density: 18, spread: .45, z: -1.5, size: .85, distance: 32 }, landscape)
  }
}

export const createLayers = (landscape = new Landscape()): Layer[] => [
  new GrassLayer(landscape), new SkyLayer(landscape), new MountainLayer(),
  new RibbonLayer('path', '小路', landscape), new TreeLayer(landscape), new HouseLayer(landscape),
  new RibbonLayer('river', '河流', landscape, true), new WheatLayer(landscape),
]

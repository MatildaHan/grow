import { Box3, Vector2, type Object3D } from 'three'
import { Y0 } from './types'

export interface Bounds { left: number; right: number; bottom: number; top: number }
export interface Footprint extends Bounds { kind: 'tree' | 'house' }
export type GroundKind = 'path' | 'river' | 'yard' | 'root'
export interface Surface { kind: GroundKind; polygon: Vector2[]; bounds: Bounds; active: boolean; pieces?: { polygon: Vector2[]; bounds: Bounds }[] }
type EntityKind = 'grass' | 'wheat' | 'tree' | 'house' | 'decoration'
interface Entity {
  kind: EntityKind; root: Vector2; active: boolean; refs: number
  footprint?: Footprint
  show: (visible: boolean) => void; destroy: () => void
}
interface Change { undo: () => void; discard?: () => void }
interface Edit { changes: Change[]; restore: () => void }

export const intersects = (a: Bounds, b: Bounds) => a.left <= b.right && a.right >= b.left && a.bottom <= b.top && a.top >= b.bottom
export const boundsOf = (points: Vector2[]): Bounds => ({
  left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
  bottom: Math.min(...points.map(p => p.y)), top: Math.max(...points.map(p => p.y)),
})

export function contains(polygon: Vector2[], p: Vector2) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
    if (Math.abs(cross) < 1e-9 && p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9 && p.y >= Math.min(a.y, b.y) - 1e-9 && p.y <= Math.max(a.y, b.y) + 1e-9) return true
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}


export function polygonsIntersect(a: Vector2[], b: Vector2[]) {
  if (contains(a, b[0]) || contains(b, a[0])) return true
  const cross = (p: Vector2, q: Vector2, r: Vector2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length]
    if (intersects(boundsOf([p, q]), boundsOf([r, s])) && cross(p, q, r) * cross(p, q, s) <= 0 && cross(r, s, p) * cross(r, s, q) <= 0) return true
  }
  return false
}


function surfaceContains(s: Surface, p: Vector2) {
  const inBounds = (b: Bounds) => p.x >= b.left && p.x <= b.right && p.y >= b.bottom && p.y <= b.top
  return inBounds(s.bounds) && (s.pieces
    ? s.pieces.some(piece => inBounds(piece.bounds) && contains(piece.polygon, p))
    : contains(s.polygon, p))
}

export function oval(root: Vector2, rx: number, ry: number) {
  return Array.from({ length: 40 }, (_, i) => {
    const angle = i / 40 * Math.PI * 2, ripple = 1 + Math.sin(angle * 5) * .035 + Math.cos(angle * 7) * .02
    return new Vector2(root.x + Math.cos(angle) * rx * ripple, root.y + Math.sin(angle) * ry * ripple)
  })
}

/** 地面占用和可撤销的局部编辑。植物按根部索引，清河不用逐帧扫描整幅画。 */
export class Landscape {
  viewport: Bounds = { left: -8, right: 8, bottom: -8, top: 5 }
  readonly occupied: Footprint[] = []
  readonly surfaces: Surface[] = []
  private entities = new Set<Entity>()
  private solids = new Set<Entity>()
  private plants = new Map<string, Set<Entity>>()
  private pending: Edit | null = null
  private history: Edit[] = []
  get canUndo() { return this.history.length > 0 }

  begin(restore: () => void) { this.finish(false); this.pending = { changes: [], restore } }
  remember(undo: () => void, discard?: () => void) { this.pending?.changes.push({ undo, discard }) }
  finish(cancelled: boolean) {
    const edit = this.pending; this.pending = null
    if (!edit) return
    if (cancelled) this.revert(edit)
    else if (edit.changes.length) {
      this.history.push(edit)
      if (this.history.length > 30) this.history.shift()!.changes.forEach(c => c.discard?.())
    }
  }
  undo() { const edit = this.history.pop(); if (edit) this.revert(edit); return !!edit }
  private revert(edit: Edit) {
    for (let i = edit.changes.length - 1; i >= 0; i--) edit.changes[i].undo()
    edit.restore(); edit.changes.forEach(c => c.discard?.())
  }
  dispose() {
    this.pending = null; this.history = []; this.entities.clear(); this.solids.clear(); this.plants.clear()
    this.occupied.length = this.surfaces.length = 0
  }

  ground(p: Vector2, margin = .15) {
    return p.clone().set(
      Math.max(this.viewport.left + margin, Math.min(this.viewport.right - margin, p.x)),
      Math.max(this.viewport.bottom + margin, Math.min(Y0 - .08, p.y)),
    )
  }
  footprint(object: Object3D, kind: Footprint['kind']): Footprint {
    object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(object)
    return { kind, left: box.min.x - .08, right: box.max.x + .08, bottom: box.min.y - .08, top: box.max.y + .08 }
  }
  overlaps(area: Bounds, kind: Footprint['kind']) { return this.occupied.some(o => o.kind === kind && intersects(area, o)) }

  private key(p: Vector2) { return `${Math.floor(p.x)},${Math.floor(p.y)}` }
  private setActive(entity: Entity, active: boolean) {
    entity.active = active; entity.show(active)
    if (entity.footprint) {
      const i = this.occupied.indexOf(entity.footprint)
      if (active && i < 0) this.occupied.push(entity.footprint)
      if (!active && i >= 0) this.occupied.splice(i, 1)
    }
  }
  private retain(entity: Entity, undo: () => void) {
    if (!this.pending) return
    entity.refs++
    this.remember(undo, () => {
      if (--entity.refs === 0 && !entity.active) {
        entity.destroy(); this.entities.delete(entity); this.solids.delete(entity)
        this.plants.get(this.key(entity.root))?.delete(entity)
      }
    })
  }
  register(kind: EntityKind, root: Vector2, show: Entity['show'], destroy: Entity['destroy'] = () => {}, footprint?: Footprint) {
    const entity: Entity = { kind, root: root.clone(), show, destroy, footprint, active: true, refs: 0 }
    this.entities.add(entity)
    if (kind === 'tree' || kind === 'house') this.solids.add(entity)
    if (kind === 'grass' || kind === 'wheat') {
      const key = this.key(root), cell = this.plants.get(key) ?? new Set<Entity>()
      cell.add(entity); this.plants.set(key, cell)
    }
    this.setActive(entity, true); this.retain(entity, () => this.setActive(entity, false))
  }
  addSurface(kind: GroundKind, polygon: Vector2[]) {
    const surface: Surface = { kind, polygon, bounds: boundsOf(polygon), active: true }
    this.surfaces.push(surface)
    this.remember(() => this.setSurfaceActive(surface, false))
    return surface
  }
  setSurfaceActive(surface: Surface, active: boolean) {
    surface.active = active
    const index = this.surfaces.indexOf(surface)
    if (active && index < 0) this.surfaces.push(surface)
    if (!active && index >= 0) this.surfaces.splice(index, 1)
  }
  private nearby(bounds: Bounds) {
    const entities: Entity[] = []
    for (let x = Math.floor(bounds.left); x <= Math.floor(bounds.right); x++) for (let y = Math.floor(bounds.bottom); y <= Math.floor(bounds.top); y++) {
      for (const e of this.plants.get(`${x},${y}`) ?? []) entities.push(e)
    }
    return entities
  }
  /** 曲线平滑变化时还原移出范围的植物，不留下看不见的清除痕迹。 */
  clear(surface: Surface, cleared = new Set<Entity>()) {
    const candidates = new Set([...this.nearby(surface.bounds), ...cleared])
    if (surface.kind === 'river') for (const e of this.solids) if (e.kind === 'tree') candidates.add(e)
    for (const e of candidates) {
      const hit = surfaceContains(surface, e.root)
      if (hit && e.active) {
        if (!cleared.has(e)) { cleared.add(e); this.retain(e, () => this.setActive(e, true)) }
        this.setActive(e, false)
      } else if (!hit && cleared.has(e)) this.setActive(e, true)
    }
    return cleared
  }
  clearGrass(root: Vector2, radius = .12) {
    for (const e of this.nearby({ left: root.x - radius, right: root.x + radius, bottom: root.y - radius, top: root.y + radius })) {
      if (e.active && e.kind === 'grass' && e.root.distanceToSquared(root) < radius * radius) {
        this.retain(e, () => this.setActive(e, true)); this.setActive(e, false)
      }
    }
  }
  at(p: Vector2, kinds: GroundKind[], except?: Surface) {
    return this.surfaces.some(s => s !== except && s.active && kinds.includes(s.kind) && surfaceContains(s, p))
  }
  areaBlocked(polygon: Vector2[], kinds: GroundKind[]) {
    const bounds = boundsOf(polygon)
    return this.surfaces.some(s => s.active && kinds.includes(s.kind) && intersects(bounds, s.bounds) && (s.pieces ? s.pieces.some(piece => intersects(bounds, piece.bounds) && polygonsIntersect(polygon, piece.polygon)) : polygonsIntersect(polygon, s.polygon)))
  }
  canPlant(p: Vector2, kind: 'grass' | 'wheat', spacing = false) {
    if (this.at(p, ['river', 'path', 'yard', 'root']) || this.occupied.some(o => o.kind === 'house' && intersects(o, { left: p.x, right: p.x, bottom: p.y, top: p.y }))) return false
    const nearby = this.nearby({ left: p.x - .12, right: p.x + .12, bottom: p.y - .12, top: p.y + .12 })
    if (kind === 'grass' && nearby.some(e => e.active && e.kind === 'wheat' && e.root.distanceToSquared(p) < .0144)) return false
    const radius = kind === 'grass' ? .045 : .075
    return !spacing || !nearby.some(e => e.active && e.kind === kind && e.root.distanceToSquared(p) < radius * radius)
  }
  blocked(p: Vector2, radius: number, kind: 'tree' | 'house' | 'path' | 'river') {
    const area = { left: p.x - radius, right: p.x + radius, bottom: p.y - radius, top: p.y + radius }
    const kinds: GroundKind[] = kind === 'river' ? ['yard', 'path'] : ['yard', 'path', 'river']
    for (const s of this.surfaces) {
      if (!s.active || !kinds.includes(s.kind) || !intersects(s.bounds, area) || (kind === 'path' && s.kind === 'path')) continue
      if (surfaceContains(s, p)) return true
      for (let i = 0; i < s.polygon.length; i++) {
        const a = s.polygon[i], b = s.polygon[(i + 1) % s.polygon.length], ab = b.clone().sub(a)
        const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)))
        if (p.distanceToSquared(a.clone().addScaledVector(ab, t)) <= radius * radius) return true
      }
    }
    return [...this.solids].some(e => e.active && (e.kind === 'house'
      ? !!e.footprint && intersects(e.footprint, area)
      : e.kind === 'tree' && kind !== 'river' && e.root.distanceToSquared(p) < (radius + .25) ** 2))
  }
}

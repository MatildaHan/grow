import { Box3, type Object3D, type Vector2 } from 'three'
import { Y0 } from './types'

export interface Bounds { left: number; right: number; bottom: number; top: number }
export interface Footprint extends Bounds { kind: 'tree' | 'house' }

/** 同一画作的占位记录；在景物尚未长完时也保留完整轮廓。 */
export class Landscape {
  viewport: Bounds = { left: -8, right: 8, bottom: -8, top: 5 }
  readonly occupied: Footprint[] = []

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

  overlaps(area: Bounds, kind: Footprint['kind']) {
    return this.occupied.some(o => o.kind === kind && area.left < o.right && area.right > o.left && area.bottom < o.top && area.top > o.bottom)
  }
}

import { Shape, Vector2 } from 'three'
import { Y0 } from './types'

/** 远缘只负责视觉起伏，前景播种与道路的地面占用仍沿用现有坐标。 */
export function meadowShape() {
  const shape = new Shape()
  shape.moveTo(-40, -60)
  for (let i = 0; i <= 320; i++) {
    const x = -40 + i * .25
    shape.lineTo(x, Y0 + .52 + Math.sin(x * .46 + .8) * .3 + Math.cos(x * .83 - .5) * .18)
  }
  shape.lineTo(40, -60); shape.closePath()
  return shape
}

export interface CloudPart { x: number; y: number; rx: number; ry: number }

/** 长条、圆团与蓬松云交替，轮廓固定在落笔时，不随渲染帧随机抖动。 */
export function cloudParts(p: Vector2, seed: number): CloudPart[] {
  const kind = seed % 3, size = .45 + Math.random() * 1
  const width = size * (kind === 0 ? 1.8 : kind === 1 ? .85 : 1.3)
  const height = size * (kind === 0 ? .24 : kind === 1 ? .5 : .48)
  const count = kind === 0 ? 4 : kind === 1 ? 5 : 6
  const lobes = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), middle = Math.sin(t * Math.PI)
    return { x: p.x + (t - .5) * width * 1.35, y: p.y + middle * height * (.25 + Math.random() * .45),
      rx: width * (.26 + Math.random() * .16), ry: height * (.65 + middle * .3 + Math.random() * .35) }
  })
  // 低矮云腹把高低不同的云瓣连起来，避免圆团退化成几枚窄椭圆。
  lobes.push({ x: p.x, y: p.y - height * .08, rx: width * .96, ry: height * .55 })
  return lobes
}

export function cloudsTouch(a: CloudPart[], b: CloudPart[]) {
  return a.some(p => b.some(q => ((p.x - q.x) / (p.rx + q.rx + .16)) ** 2 + ((p.y - q.y) / (p.ry + q.ry + .12)) ** 2 <= 1))
}

/** 椭圆团的上下包络形成单一闭合轮廓，相邻团之间的小间隙自然连起。 */
export function cloudShape(parts: CloudPart[]) {
  const left = Math.min(...parts.map(p => p.x - p.rx)), right = Math.max(...parts.map(p => p.x + p.rx))
  const segments = Math.min(1024, Math.max(64, Math.ceil((right - left) / .035)))
  const top: Vector2[] = [], bottom: Vector2[] = []
  for (let i = 0; i <= segments; i++) {
    const x = left + (right - left) * i / segments
    let high = -Infinity, low = Infinity
    for (const p of parts) {
      const t = (x - p.x) / p.rx
      if (Math.abs(t) > 1 + 1e-9) continue
      const h = Math.sqrt(Math.max(0, 1 - t * t)) * p.ry
      high = Math.max(high, p.y + h); low = Math.min(low, p.y - h)
    }
    if (Number.isFinite(high)) { top.push(new Vector2(x, high)); bottom.push(new Vector2(x, low)) }
  }
  const shape = new Shape([...top, ...bottom.reverse()]); shape.closePath()
  return shape
}

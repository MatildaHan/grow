import * as THREE from 'three'
import { combine, pencil, sketched } from './materials'

const V2 = (x: number, y: number) => new THREE.Vector2(x, y)

export function leaf(width: number, height: number) {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.bezierCurveTo(-width, height * .35, -width * .7, height * .75, 0, height)
  s.bezierCurveTo(width * .8, height * .7, width * .85, height * .2, 0, 0)
  return s
}

export function grassGeometry(kind: string) {
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'fine') {
    for (const [x, h, bend] of [[-.13, .34, -.1], [0, .55, .12], [.12, .42, .16]]) {
      const s = new THREE.Shape()
      s.moveTo(x - .025, 0); s.quadraticCurveTo(x - .04, h * .5, x + bend, h)
      s.quadraticCurveTo(x + .045, h * .42, x + .025, 0); s.closePath()
      parts.push(sketched(s, .009, 8))
    }
  } else if (kind === 'broad') {
    for (const angle of [-.7, -.2, .45]) parts.push(sketched(leaf(.12, .48), .01, 8).rotateZ(angle))
  } else if (kind === 'fern') {
    parts.push(pencil([V2(0, 0), V2(.015, .55)], .018))
    for (let row = 0; row < 5; row++) for (const side of [-1, 1]) {
      parts.push(sketched(leaf(.06, .2 - row * .015), .008, 6)
        .rotateZ(-side * .9).translate(0, .09 + row * .09, 0))
    }
  } else {
    parts.push(pencil([V2(0, 0), V2(.02, .7)], .016), sketched(leaf(.07, .24), .008, 6).rotateZ(-.8).translate(0, .25, 0))
    for (let i = 0; i < 6; i++) {
      const petal = sketched(leaf(.065, .17), .008, 6).rotateZ(i * Math.PI / 3).translate(.02, .7, 0)
      petal.setAttribute('aTone', new THREE.Float32BufferAttribute(new Float32Array(petal.attributes.position.count).fill(1), 1))
      parts.push(petal)
    }
    parts.push(new THREE.CircleGeometry(.038, 10).translate(.02, .7, .001))
  }
  return combine(parts)
}

/** 麦秆沿弧线生长，穗粒和芒线跟随当地切线，不把整株简单旋转成斜线。 */
export function wheatGeometry(kind: string) {
  const stalks: THREE.BufferGeometry[] = [], cluster = kind === 'cluster'
  for (const [x, height, angle, bend] of cluster
    ? [[-.13, .78, .18, .16], [0, 1, -.06, -.18], [.15, .86, -.2, .3]]
    : [[0, 1, 0, kind === 'bowed' ? .42 : kind === 'full' ? .23 : .09]]) {
    const bowed = kind === 'bowed' || kind === 'full', full = kind === 'full'
    const curve = new THREE.CubicBezierCurve(V2(0, 0), V2(-.035, .35), V2(bend * .35, 1.06), V2(bend, bowed ? .88 : 1.02))
    const edges: THREE.Vector2[][] = [[], []]
    for (let i = 0; i <= 32; i++) {
      const t = i / 32, p = curve.getPoint(t), tangent = curve.getTangent(t), width = .013 * (1 - t * .35)
      edges[0].push(V2(p.x - tangent.y * width, p.y + tangent.x * width))
      edges[1].push(V2(p.x + tangent.y * width, p.y - tangent.x * width))
    }
    const stem = new THREE.Shape([...edges[0], ...edges[1].reverse()]); stem.closePath()
    const grains: THREE.BufferGeometry[] = [sketched(stem, .007, 8)]
    const rows = full ? 6 : 5, width = full ? .085 : .055, length = full ? .10 : .085
    for (let i = 0; i < rows; i++) for (const side of [-1, 1]) {
      const t = .5 + i / (rows - 1) * .48, p = curve.getPoint(t), tangent = curve.getTangent(t)
      const rotation = -Math.atan2(tangent.x, tangent.y), grain = new THREE.Shape()
      grain.moveTo(0, 0); grain.quadraticCurveTo(side * width * 1.2, .025, side * width, length)
      grain.quadraticCurveTo(side * .015, length * .8, 0, 0); grain.closePath()
      grains.push(sketched(grain, .007, 8).rotateZ(rotation).translate(p.x, p.y, 0))
      if (kind === 'awn' || cluster) {
        grains.push(pencil([V2(side * width, length), V2(side * (width + .07), length + (kind === 'awn' ? .19 : .09))], .006)
          .rotateZ(rotation).translate(p.x, p.y, 0))
      }
    }
    grains.push(sketched(leaf(.035, .26), .007, 8).rotateZ(-.65).translate(curve.getPoint(.3).x, curve.getPoint(.3).y, 0))
    stalks.push(combine(grains).scale(height, height, 1).rotateZ(angle).translate(x, 0, 0))
  }
  return combine(stalks)
}

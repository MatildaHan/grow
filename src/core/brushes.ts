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

export function wheatGeometry(cluster = false) {
  const stalks: THREE.BufferGeometry[] = []
  for (const [x, height, angle] of cluster ? [[-.13, .78, .18], [0, 1, -.06], [.15, .86, -.2]] : [[0, 1, 0]]) {
    const grains: THREE.BufferGeometry[] = []
    const s = new THREE.Shape()
    s.moveTo(-.018, 0); s.quadraticCurveTo(.015, .35, -.018, .72)
    s.lineTo(.018, .72); s.quadraticCurveTo(.05, .35, .018, 0); s.closePath()
    grains.push(sketched(s, .008, 6))
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      const y = .48 + i * .085, grain = new THREE.Shape()
      grain.moveTo(0, y); grain.quadraticCurveTo(side * .13, y + .015, side * .1, y + .12)
      grain.quadraticCurveTo(side * .02, y + .12, 0, y); grain.closePath()
      grains.push(sketched(grain, .008, 6))
    }
    stalks.push(combine(grains).scale(height, height, 1).rotateZ(angle).translate(x, 0, 0))
  }
  return combine(stalks)
}

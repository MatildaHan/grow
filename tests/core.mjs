import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createLayers } from '../src/core/layers.ts'
import { Landscape } from '../src/core/placement.ts'
import { StageMachine, PerfGuard } from '../src/core/Game.ts'
import { uTime, uMotion } from '../src/core/materials.ts'

const point = (x, y) => new THREE.Vector2(x, y)
const all = []
function make() { const landscape = new Landscape(), layers = createLayers(landscape); all.push(...layers); return { landscape, layers } }
function meshes(layer) { const out = []; layer.group.traverse(o => { if (o instanceof THREE.Mesh) out.push(o) }); return out }
function plants(layer) { return meshes(layer).filter(m => m instanceof THREE.InstancedMesh).reduce((n, m) => n + m.count, 0) }
function draw(layer, from, to, samples = 1) {
  layer.input(from, 'down')
  for (let i = 1; i <= samples; i++) layer.input(from.clone().lerp(to, i / samples), 'move')
  layer.input(to, 'up')
}
function tick(layers, seconds = 2) {
  for (let i = 0; i < Math.ceil(seconds / .05); i++) { uTime.value += .05; layers.forEach(l => l.update(.05)) }
}

// 同一段笔迹不因事件频率改变数量；跨批次添画保留原有矩阵和出生时间。
for (const index of [0, 7]) {
  const a = make().layers[index], b = make().layers[index]
  draw(a, point(-5, -2), point(5, -2)); draw(b, point(-5, -2), point(5, -2), 300)
  assert.equal(plants(a), plants(b)); assert.ok(Math.abs(a.progress - b.progress) < 1e-9)
  const old = meshes(a).filter(m => m instanceof THREE.InstancedMesh).map(m => ({ m, count: m.count,
    matrix: Array.from(m.instanceMatrix.array.slice(0, m.count * 16)), born: Array.from(m.geometry.attributes.aBorn.array.slice(0, m.count)) }))
  a.progress = 1; a.setQuality('low')
  for (let i = 0; i < 12; i++) draw(a, point(-7, -3), point(7, -3))
  assert.ok(plants(a) > 512)
  for (const x of old) {
    assert.deepEqual(Array.from(x.m.instanceMatrix.array.slice(0, x.count * 16)), x.matrix)
    assert.deepEqual(Array.from(x.m.geometry.attributes.aBorn.array.slice(0, x.count)), x.born)
  }
  const low = make().layers[index]; low.setQuality('low'); draw(low, point(-5, -2), point(5, -2))
  assert.ok(plants(low) < plants(b)); assert.ok(Math.abs(low.progress - b.progress) < 1e-9)
}

// 四种草叶都可单独绘制；向左和向右的麦穗矩阵倾斜方向相反。
const grass = make().layers[0]
for (const tool of ['fine', 'broad', 'fern', 'flower']) { grass.setTool(tool); draw(grass, point(-2, -2), point(2, -2)); }
assert.equal(grass.group.children.filter(g => g instanceof THREE.Group && g.children.some(m => m.count > 0)).length, 4)
for (const [tool, sign] of [['left', 1], ['right', -1]]) {
  const wheat = make().layers[7]; wheat.setTool(tool); wheat.input(point(0, -2), 'down')
  const mesh = meshes(wheat).find(m => m instanceof THREE.InstancedMesh && m.count)
  assert.ok(mesh.instanceMatrix.array[1] * sign > 0)
}

// 不同位置、远近的山相互独立；左、右两次画山不复用固定中心。
const mountain = make().layers[2]
mountain.input(point(-5, 2), 'down'); mountain.input(point(-5, 2), 'up')
assert.equal(mountain.group.children.length, 3)
assert.ok(mountain.group.children.every(m => m.position.x < -4))
mountain.setTool('near'); mountain.input(point(5, 3), 'down'); mountain.input(point(5, 3), 'up')
assert.ok(mountain.group.children[3].position.x > 4)
assert.ok(mountain.group.children[3].position.z > mountain.group.children[0].position.z)

// 路和河按实际笔迹分别成形；重绘新笔不会改动已完成的曲线。
for (const index of [3, 6]) {
  const layer = make().layers[index]
  draw(layer, point(-6, -1), point(-3, -5), 40); tick([layer])
  const first = layer.group.children[0], positions = Array.from(first.geometry.attributes.position.array)
  draw(layer, point(6, -1), point(3, -5), 40); tick([layer])
  assert.equal(layer.group.children.length, 2)
  assert.deepEqual(Array.from(first.geometry.attributes.position.array), positions)
  first.geometry.computeBoundingBox(); layer.group.children[1].geometry.computeBoundingBox()
  assert.ok(first.geometry.boundingBox.max.x < 0)
  assert.ok(layer.group.children[1].geometry.boundingBox.min.x > 0)
  const cancelled = make().layers[index]
  cancelled.input(point(0, -1), 'down'); cancelled.input(point(0, -1), 'cancel'); tick([cancelled])
  assert.equal(cancelled.group.children.length, 0); assert.equal(cancelled.progress, 0)
  const toFront = make().layers[index]
  draw(toFront, point(0, -1), point(1, -7.9), 60); tick([toFront])
  toFront.group.children[0].geometry.computeBoundingBox()
  assert.ok(toFront.group.children[0].geometry.boundingBox.min.y < -20, '到达屏幕前缘的路河应继续延伸')
}

// 混合树形、房屋避让（包含尚未长完的树）与最前景渲染顺序。
const composition = make(), tree = composition.layers[4], house = composition.layers[5]
for (const x of [-6, -3, 0, 3]) tree.input(point(x, -2), 'down')
assert.deepEqual(tree.group.children.map(g => g.userData.kind), ['broad', 'pine', 'round', 'willow'])
const round = tree.group.children.find(g => g.userData.kind === 'round')
for (const m of round.children.slice(1, 4)) { m.geometry.computeBoundingBox(); assert.ok(m.geometry.boundingBox.min.y > .5, '圆冠应长在树干上方') }
house.input(point(0, -2), 'down')
assert.equal(house.group.children.length, 0); assert.match(house.notice, /空地/)
house.input(point(0, -6), 'down'); tick([house])
assert.equal(house.group.children.length, 1)
assert.ok(meshes(house).every(m => m.renderOrder === 200))
const occupied = composition.landscape.occupied.length
tree.input(point(0, -6), 'down'); assert.equal(composition.landscape.occupied.length, occupied)

// 一直按住不强制切换；完成八步后选回任意步骤，实体与进度保持不变。
const game = make(), machine = new StageMachine(game.layers, new THREE.Scene())
function advance(seconds = 2) {
  for (let i = 0; i < Math.ceil(seconds / .05); i++) { uTime.value += .05; machine.update(.05) }
}
assert.equal(machine.select(2), false)
machine.input(point(-7, -2), 'down')
for (const p of [point(7, -2), point(-7, -3), point(7, -4)]) machine.input(p, 'move')
advance(); assert.equal(machine.index, 0)
machine.input(point(7, -4), 'up'); advance(1); assert.equal(machine.index, 1)
for (const index of [1, 2]) {
  machine.input(point(-6, 2), 'down'); machine.input(point(6, 2), 'move'); machine.input(point(6, 2), 'up')
  advance(); assert.equal(machine.index, index + 1)
}
for (const x of [-4, 4]) { machine.input(point(x, -.7), 'down'); machine.input(point(x, -.7), 'up') }
advance(); assert.equal(machine.index, 4)
for (const x of [-6, -4, -2, 0, 2, 4]) { machine.input(point(x, -2), 'down'); machine.input(point(x, -2), 'up') }
advance(); assert.equal(machine.index, 5)
machine.input(point(0, -2), 'down'); machine.input(point(0, -2), 'up'); advance(); assert.equal(machine.index, 5)
machine.input(point(0, -6), 'down'); machine.input(point(0, -6), 'up'); advance(2.2); assert.equal(machine.index, 6)
machine.input(point(5, -.7), 'down'); machine.input(point(-5, -7), 'move'); machine.input(point(-5, -7), 'up')
advance(); assert.equal(machine.index, 7)
machine.input(point(-7, -2), 'down')
for (const p of [point(7, -2), point(-7, -3), point(7, -4)]) machine.input(p, 'move')
machine.input(point(7, -4), 'up'); advance(); assert.equal(machine.done, true)
const objects = game.layers.map(l => l.group.children.slice()), progress = game.layers.map(l => l.progress)
for (let i = 0; i < 8; i++) {
  assert.equal(machine.select(i), true); assert.equal(machine.done, true)
  assert.deepEqual(game.layers.map(l => l.progress), progress)
  objects.forEach((children, j) => children.forEach(child => assert.ok(game.layers[j].group.children.includes(child))))
}
machine.select(0); const before = plants(game.layers[0])
machine.input(point(-5, -5), 'down'); machine.input(point(5, -5), 'move'); machine.input(point(5, -5), 'up')
assert.ok(plants(game.layers[0]) > before); assert.equal(machine.done, true)
for (const [index, p] of [[4, point(6, -6)], [5, point(-6, -6)], [3, point(3, -.7)], [6, point(-7, -.7)]]) {
  machine.select(index)
  const count = game.layers[index].group.children.length
  machine.input(p, 'down'); machine.input(p, 'up')
  assert.equal(game.layers[index].group.children.length, count + 1, '完成后仍可继续添加景物')
  assert.equal(machine.done, true)
}

const levels = [], perf = new PerfGuard('high', q => levels.push(q))
for (let i = 0; i < 100; i++) perf.tick(.05)
assert.deepEqual(levels, ['mid']); perf.reset()
for (let i = 0; i < 120; i++) perf.tick(1 / 60)
assert.deepEqual(levels, ['mid'])
uMotion.value = 0
const reduced = make().layers[4]; reduced.input(point(0, -2), 'down'); reduced.progress = 1; tick([reduced], .6)
assert.equal(reduced.settled, true)

// 检查所有样式的缓冲与索引，包含动态曲线和新增的实例批次。
for (const l of all) for (const m of meshes(l)) {
  for (const name of ['position', 'uv', 'aInk', 'aTone']) if (m.geometry.attributes[name])
    for (const value of m.geometry.attributes[name].array) assert.ok(Number.isFinite(value))
  for (const index of m.geometry.index?.array ?? []) assert.ok(index < m.geometry.attributes.position.count)
}
let disposed = 0
const geometrySet = new Set(all.flatMap(l => meshes(l).map(m => m.geometry)))
for (const g of geometrySet) g.addEventListener('dispose', () => disposed++)
all.forEach(l => l.dispose()); assert.equal(disposed, geometrySet.size)
console.log('通过：笔迹采样、跨批次添画、草木类型、麦穗方向、自由山/路/河、房屋避让与前景、八步引导与回选、降档、减少动态效果、几何与资源释放。')

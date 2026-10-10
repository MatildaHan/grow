import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createLayers } from '../src/core/layers.ts'
import { wheatGeometry } from '../src/core/brushes.ts'
import { Landscape, contains } from '../src/core/placement.ts'
import { StageMachine, PerfGuard } from '../src/core/Game.ts'
import { uTime, uMotion } from '../src/core/materials.ts'

const point = (x, y) => new THREE.Vector2(x, y)
const all = []
function seeded(fn) {
  const original = Math.random; let seed = 73491
  Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
  try { return fn() } finally { Math.random = original }
}
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
  seeded(() => draw(a, point(-5, -2), point(5, -2))); seeded(() => draw(b, point(-5, -2), point(5, -2), 300))
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
  const wheat = make().layers[7]; wheat.setDirection(tool); wheat.input(point(0, -2), 'down')
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
assert.ok(meshes(house).every(m => m.renderOrder >= 199) && meshes(house).filter(m => m.renderOrder === 200).length === 8)
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
for (const x of [-6, -2, -.8, .5, 2, 6]) { machine.input(point(x, -1.4), 'down'); machine.input(point(x, -1.4), 'up') }
advance(); assert.equal(machine.index, 5)
machine.input(point(0, -2), 'down'); machine.input(point(0, -2), 'up'); advance(); assert.equal(machine.index, 5)
machine.input(point(0, -6), 'down'); machine.input(point(0, -6), 'up'); advance(2.2); assert.equal(machine.index, 6)
machine.input(point(-7, -.7), 'down'); machine.input(point(-7, -7), 'move'); machine.input(point(-7, -7), 'up')
advance(); assert.equal(machine.index, 7, game.layers[6].notice)
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
for (const [index, p] of [[4, point(6, -4)], [5, point(6, -7)], [3, point(2, -.7)], [6, point(-7, -.7)]]) {
  machine.select(index)
  const count = game.layers[index].group.children.length
  machine.input(p, 'down'); machine.input(p, 'up')
  assert.equal(game.layers[index].group.children.length, count + 1, '完成后仍可继续添加景物')
  assert.equal(machine.done, true)
}


function livePlants(layer) {
  const out = []
  for (const m of meshes(layer).filter(m => m instanceof THREE.InstancedMesh)) for (let i = 0; i < m.count; i++) {
    if (m.geometry.attributes.aAlive.getX(i) > .5) out.push({ m, i, root: point(m.instanceMatrix.array[i * 16 + 12], m.instanceMatrix.array[i * 16 + 13]) })
  }
  return out
}
function plantSnapshot(layer) { return meshes(layer).filter(m => m instanceof THREE.InstancedMesh).map(m => ({ m, count: m.count,
  matrix: Array.from(m.instanceMatrix.array), born: Array.from(m.geometry.attributes.aBorn.array), alive: Array.from(m.geometry.attributes.aAlive.array) })) }
function samePlants(snapshot) { for (const x of snapshot) {
  assert.equal(x.m.count, x.count); assert.deepEqual(Array.from(x.m.instanceMatrix.array), x.matrix)
  assert.deepEqual(Array.from(x.m.geometry.attributes.aBorn.array), x.born); assert.deepEqual(Array.from(x.m.geometry.attributes.aAlive.array), x.alive)
} }

// 建房腾出地基周边；留白外植物不变，后续不能种在房屋或院落里。
const yardWorld = make(), yardGrass = yardWorld.layers[0], yardWheat = yardWorld.layers[7], yardHouse = yardWorld.layers[5]
draw(yardGrass, point(-3, -4), point(3, -4), 50)
draw(yardWheat, point(-3, -4), point(3, -4), 50)
const beforeYard = [...livePlants(yardGrass), ...livePlants(yardWheat)], yardSnapshots = [plantSnapshot(yardGrass), plantSnapshot(yardWheat)]
draw(yardHouse, point(0, -4), point(0, -4))
const yardPatch = yardWorld.landscape.surfaces.find(s => s.kind === 'yard')
assert.ok(yardPatch); assert.ok(livePlants(yardGrass).length + livePlants(yardWheat).length < beforeYard.length)
for (const p of beforeYard) assert.equal(p.m.geometry.attributes.aAlive.getX(p.i) > .5, !contains(yardPatch.polygon, p.root))
assert.equal(yardWorld.landscape.canPlant(point(0, -4), 'grass'), false)
assert.equal(yardWorld.landscape.canPlant(point(0, -4.2), 'wheat'), false)
assert.equal(yardWorld.landscape.undo(), true); yardSnapshots.forEach(samePlants)
assert.equal(yardWorld.landscape.occupied.length, 0); assert.equal(yardWorld.landscape.surfaces.length, 0)

// 河道清除草、麦与根部命中的整棵树；仅树冠伸到水面上方的树保留。
const waterWorld = make(), [waterGrass, , , , waterTrees, , waterRiver, waterWheat] = waterWorld.layers
for (const y of [-2, -3, -4]) { draw(waterGrass, point(-3, y), point(3, y)); draw(waterWheat, point(-3, y), point(3, y)) }
for (const x of [0, .9]) draw(waterTrees, point(x, -3), point(x, -3))
const treeObjects = waterTrees.group.children.slice(), oldWaterPlants = [plantSnapshot(waterGrass), plantSnapshot(waterWheat)]
const oldSurfaces = waterWorld.landscape.surfaces.length, oldWaterProgress = waterRiver.progress
const priorPlants = [...livePlants(waterGrass), ...livePlants(waterWheat)]
draw(waterRiver, point(0, -1), point(0, -5)); tick([waterRiver], .1)
const riverPatch = waterWorld.landscape.surfaces.find(s => s.kind === 'river')
assert.ok(riverPatch); assert.equal(treeObjects[0].visible, false); assert.equal(treeObjects[1].visible, true)
assert.equal(waterWorld.landscape.occupied.filter(o => o.kind === 'tree').length, 1)
for (const p of priorPlants) assert.equal(p.m.geometry.attributes.aAlive.getX(p.i) > .5, !contains(riverPatch.polygon, p.root))
assert.equal(waterWorld.landscape.canPlant(point(0, -3), 'grass'), false)
assert.equal(waterWorld.landscape.canPlant(point(0, -3), 'wheat'), false)
assert.equal(waterWorld.landscape.undo(), true); oldWaterPlants.forEach(samePlants)
assert.ok(treeObjects.every(o => o.visible)); assert.equal(waterWorld.landscape.occupied.length, 2)
assert.equal(waterWorld.landscape.surfaces.length, oldSurfaces); assert.equal(waterRiver.progress, oldWaterProgress)

// 拖动预览与落笔采用相同占地；取消已清除的河流笔画要完整还原。
waterRiver.input(point(0, -1), 'down'); waterRiver.input(point(0, -5), 'move'); tick([waterRiver], .05)
assert.equal(treeObjects[0].visible, false)
waterRiver.input(point(0, -5), 'cancel'); oldWaterPlants.forEach(samePlants)
assert.ok(treeObjects.every(o => o.visible)); assert.equal(waterWorld.landscape.surfaces.length, oldSurfaces)

// 道路不穿树干，河流不冲掉建筑/道路；稀疏事件也不能越过保留区。
const obstacles = make(), obstacleTree = obstacles.layers[4], obstacleHouse = obstacles.layers[5], obstaclePath = obstacles.layers[3], obstacleRiver = obstacles.layers[6]
draw(obstacleTree, point(0, -3), point(0, -3))
draw(obstaclePath, point(-4, -3), point(4, -3)); tick([obstaclePath], .1)
assert.match(obstaclePath.notice, /绕行/)
assert.equal(obstacles.landscape.at(point(-2, -3), ['path']), true)
assert.equal(obstacles.landscape.at(point(2, -3), ['path']), false)
assert.equal(obstacleTree.group.children[0].visible, true)
draw(obstacleHouse, point(4, -4), point(4, -4))
draw(obstacleRiver, point(1.5, -4), point(6, -4)); tick([obstacleRiver], .1)
assert.match(obstacleRiver.notice, /房屋或道路/); assert.equal(obstacleHouse.group.children[0].visible, true)
assert.equal(obstacles.landscape.at(point(4, -4), ['river']), false)
assert.ok(obstacleRiver.progress < 1)

// 院落不能包住一段短路；河流与道路的交叉限制是双向的。
const crossWorld = make()
draw(crossWorld.layers[3], point(-.15, -3.68), point(.15, -3.68))
draw(crossWorld.layers[5], point(0, -4), point(0, -4)); assert.equal(crossWorld.layers[5].group.children.length, 0)
draw(crossWorld.layers[6], point(-2, -3), point(2, -3)); assert.match(crossWorld.layers[6].notice, /道路/)
const waterOnly = make(); waterOnly.layers[6].setTool('wide')
draw(waterOnly.layers[6], point(0, -1), point(0, -5))
for (const index of [0, 7, 4, 5]) { draw(waterOnly.layers[index], point(0, -3), point(0, -3)); assert.equal(waterOnly.layers[index].progress, 0) }
const waterGeometry = Array.from(waterOnly.layers[6].group.children[0].geometry.attributes.position.array)
draw(waterOnly.layers[6], point(-2, -4), point(2, -4)); assert.equal(waterOnly.layers[6].group.children.length, 2)
assert.deepEqual(Array.from(waterOnly.layers[6].group.children[0].geometry.attributes.position.array), waterGeometry)
draw(waterOnly.layers[3], point(-3, -3), point(3, -3)); assert.match(waterOnly.layers[3].notice, /河道/)

// 回环笔迹的交叉水面仍是河道，环内空地可继续播种。
const loopWorld = make()
draw(loopWorld.layers[0], point(-3, -3), point(3, -3))
loopWorld.layers[6].input(point(-2, -2), 'down')
for (const p of [point(2, -4), point(2, -2), point(-2, -4), point(-2, -2)]) loopWorld.layers[6].input(p, 'move')
loopWorld.layers[6].input(point(-2, -2), 'up')
assert.equal(loopWorld.landscape.at(point(0, -3), ['river']), true)
assert.equal(loopWorld.landscape.canPlant(point(0, -3), 'wheat'), false)
for (const p of livePlants(loopWorld.layers[0])) assert.equal(loopWorld.landscape.at(p.root, ['river']), false)

// 麦穗有实质弧度和不同形态；方向与样式可独立切换，旧穗不变。
const slender = wheatGeometry('slender'), bowed = wheatGeometry('bowed'), awn = wheatGeometry('awn')
for (const g of [slender, bowed, awn]) g.computeBoundingBox()
assert.ok(bowed.boundingBox.max.x > slender.boundingBox.max.x + .2)
assert.ok(awn.boundingBox.max.y > slender.boundingBox.max.y + .1)
const styledWheat = make().layers[7]; styledWheat.setTool('full'); styledWheat.setDirection('left')
draw(styledWheat, point(-3, -3), point(-2, -3))
const retainedWheat = plantSnapshot(styledWheat).filter(x => x.count > 0)
styledWheat.setDirection('right'); assert.equal(styledWheat.tool, 'full')
draw(styledWheat, point(2, -3), point(3, -3))
samePlants(retainedWheat); [slender, bowed, awn].forEach(g => g.dispose())

// 被占用的地段不计进度；降档不改变可用土地的完成距离。
for (const index of [0, 7]) {
  const high = make(), low = make()
  for (const world of [high, low]) {
    world.landscape.begin(() => {}); world.landscape.addSurface('river', [point(-1, -5), point(1, -5), point(1, -1), point(-1, -1)]); world.landscape.finish(false)
  }
  low.layers[index].setQuality('low')
  seeded(() => draw(high.layers[index], point(-4, -3), point(4, -3), 300))
  seeded(() => draw(low.layers[index], point(-4, -3), point(4, -3)))
  assert.ok(Math.abs(high.layers[index].progress - low.layers[index].progress) < 1e-9)
  assert.ok(livePlants(low.layers[index]).length < livePlants(high.layers[index]).length)
}

// 历史最多保留 30 笔；实体在最后一个可撤销引用释放前不能销毁。
const historyWorld = new Landscape(); let shown = true, released = 0
historyWorld.begin(() => {}); historyWorld.register('grass', point(0, -2), v => { shown = v }, () => { released++ }); historyWorld.finish(false)
historyWorld.begin(() => {}); const reserve = historyWorld.addSurface('yard', [point(-1, -3), point(1, -3), point(1, -1), point(-1, -1)]); historyWorld.clear(reserve); historyWorld.finish(false)
for (let i = 0; i < 29; i++) { historyWorld.begin(() => {}); historyWorld.remember(() => {}); historyWorld.finish(false) }
assert.equal(shown, false); assert.equal(released, 0)
historyWorld.begin(() => {}); historyWorld.remember(() => {}); historyWorld.finish(false)
assert.equal(released, 1); historyWorld.dispose()

// 阶段已完成但尚未切换时再次按住，不把未开始的新笔迹带入下一层。
const waitingWorld = make(), waiting = new StageMachine(waitingWorld.layers, new THREE.Scene())
waiting.input(point(0, -2), 'down'); waitingWorld.layers[0].progress = 1; waiting.input(point(0, -2), 'up')
function waitTick(seconds) { for (let i = 0; i < Math.ceil(seconds / .05); i++) { uTime.value += .05; waiting.update(.05) } }
waitTick(.75); assert.equal(waiting.index, 0)
const waitingPlants = plants(waitingWorld.layers[0])
waiting.input(point(2, -2), 'down'); waiting.input(point(4, -2), 'move'); waitTick(2)
assert.equal(waiting.index, 0); assert.equal(plants(waitingWorld.layers[0]), waitingPlants)
waiting.input(point(4, -2), 'up'); waitTick(1); assert.equal(waiting.index, 1)
assert.equal(waitingWorld.layers[1].group.children.length, 1)

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
console.log('通过：地面占用、院落腾空、河流清除、根部碰撞、交叉保护、撤销/取消与历史释放、麦穗弧度与独立方向、笔迹采样、跨批次添画、草木类型、麦穗方向、自由山/路/河、房屋避让与前景、八步引导与回选、降档、减少动态效果、几何与资源释放。')

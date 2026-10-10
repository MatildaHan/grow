import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export const uTime = { value: 0 }
export const uMotion = { value: 1 }

const VERT = /* glsl */ `
uniform float uGrow,uBase,uMode,uTime,uSway,uMotion;
attribute float aBorn;
attribute float aSeed;
attribute float aInk;
varying vec2 vUv; varying vec3 vW; varying float vSeed,vGrowth,vInk;
void main(){
  vUv=uv; vSeed=aSeed; vInk=aInk;
  vec3 p=position;
  float g=1.;
  if(uMode<.5) g=clamp(uGrow*1.4-aSeed*.4,0.,1.);
  else if(uMode>2.5) {
    float t=clamp((uTime-aBorn)*mix(4.,1.6,uMotion),0.,1.);
    g=1.-pow(1.-t,3.);
  }
  vGrowth=g;
  if(uMode<.5||uMode>2.5) p.y=uBase+(p.y-uBase)*g;
  vec4 m=vec4(p,1.);
  #ifdef USE_INSTANCING
  m=instanceMatrix*m;
  #endif
  m=modelMatrix*m;
  m.x+=sin(uTime*.85+m.x*.65+aSeed*6.)*uSway*uMotion*max(position.y-uBase,0.)*.09*g;
  vW=m.xyz;
  gl_Position=projectionMatrix*viewMatrix*m;
}`

// uMode: 0 底边抽长  1 噪声晕染  2 沿 uv.x 铺开  3 实例按出生时间生长
const FRAG = /* glsl */ `
uniform vec3 uColor,uTint,uInkColor; uniform float uGrow,uMode,uShade,uTime,uFlow,uMotion,uEdge,uGradient,uOpacity,uHatch;
varying vec2 vUv; varying vec3 vW; varying float vSeed,vGrowth,vInk;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
  float wash=n(vW.xy*1.1), alpha=1.;
  if(uMode<.5||uMode>2.5) alpha=smoothstep(0.,.08,vGrowth);
  if(uMode>.5&&uMode<1.5) alpha=smoothstep(wash-.15,wash+.15,uGrow*1.4-.2);
  if(uMode>1.5&&uMode<2.5) {
    alpha=1.-smoothstep(uGrow*1.08-.04,uGrow*1.08+.015,vUv.x+(wash-.5)*.018);
    alpha*=smoothstep(0.,.025,uGrow);
    float edge=min(vUv.y,1.-vUv.y);
    alpha*=smoothstep(0.,.035,edge);
  }
  if(alpha<.002) discard;
  float pigment=wash*.55+n(vW.xy*5.)*.25+vSeed*.2;
  vec3 color=mix(uColor,uTint,clamp((vW.y+.5)/7.,0.,1.)*uGradient);
  color*=1.+(pigment-.5)*.22*uShade;
  float hatch=1.-smoothstep(.08,.22,abs(fract(vW.x*8.+vW.y*11.+wash*.4)-.5));
  float dots=step(.96,h(floor(vW.xy*48.)));
  color=mix(color,uInkColor,(hatch*.06+dots*.16)*uHatch);
  if(uEdge>.5) color*=mix(.84,1.,smoothstep(.02,.12,min(vUv.y,1.-vUv.y)));
  if(uFlow>.5) color+=vec3(.06)*smoothstep(.73,.88,n(vec2(vUv.x*32.-uTime*.45*uMotion,vUv.y*5.)));
  color=mix(color,uInkColor,step(.5,vInk));
  gl_FragColor=vec4(color,alpha*uOpacity);
  #include <colorspace_fragment>
}`

export interface InkOpts { mode?: 0 | 1 | 2 | 3; base?: number; shade?: number; sway?: number; flow?: boolean; edge?: boolean; tint?: string; ink?: string; opacity?: number; hatch?: number }

export function inkMat(color: string, o: InkOpts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uTint: { value: new THREE.Color(o.tint ?? color) },
      uInkColor: { value: new THREE.Color(o.ink ?? '#576c60') },
      uOpacity: { value: o.opacity ?? 1 }, uHatch: { value: o.hatch ?? 0 },
      uGrow: { value: 0 }, uBase: { value: o.base ?? 0 }, uMode: { value: o.mode ?? 0 },
      uShade: { value: o.shade ?? 1 }, uSway: { value: o.sway ?? 0 },
      uFlow: { value: o.flow ? 1 : 0 }, uEdge: { value: o.edge ? 1 : 0 },
      uGradient: { value: o.tint ? 1 : 0 }, uTime, uMotion,
    },
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false,
  })
}

/** 补齐 shader 需要的自定义属性，避免读到未绑定的垃圾值 */
export function mk(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const n = geo.attributes.position.count
  for (const a of ['aSeed', 'aBorn', 'aInk'])
    if (!geo.attributes[a]) geo.setAttribute(a, new THREE.BufferAttribute(new Float32Array(n), 1))
  return new THREE.Mesh(geo, mat)
}

/** 沿曲线的带状几何：uv.x = 沿长度 0..1，uv.y = 横向 */
export function ribbon(c: THREE.Curve<THREE.Vector2>, w0: number, w1: number, seg = 64) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, p = c.getPoint(t), tg = c.getTangent(t)
    const w = (w0 + (w1 - w0) * t) / 2 * (1 + Math.sin(t * 37) * .025 + Math.sin(t * 71) * .012)
    pos.push(p.x - tg.y * w, p.y + tg.x * w, 0, p.x + tg.y * w, p.y - tg.x * w, 0)
    uv.push(t, 0, t, 1)
    if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** 以细带画线，线宽和方向轻微起伏；不是逐帧抖动的随机轮廓。 */
export function pencil(points: THREE.Vector2[], width = .014, closed = false) {
  const pos: number[] = [], uv: number[] = [], indices: number[] = []
  const list = closed ? [...points, points[0]] : points
  for (let i = 0; i < list.length; i++) {
    const p = list[i], before = list[Math.max(0, i - 1)], after = list[Math.min(list.length - 1, i + 1)]
    const tangent = after.clone().sub(before).normalize()
    const w = width * (.5 + Math.sin(i * 1.7) * .06)
    pos.push(p.x - tangent.y * w, p.y + tangent.x * w, 0, p.x + tangent.y * w, p.y - tangent.x * w, 0)
    uv.push(i / (list.length - 1), 0, i / (list.length - 1), 1)
    if (i < list.length - 1) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aInk', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(1), 1))
  g.setIndex(indices); g.computeVertexNormals()
  return g
}

/** 合并同一笔的填色与线稿，并释放临时几何。 */
export function combine(parts: THREE.BufferGeometry[]) {
  for (const g of parts) if (!g.attributes.aInk)
    g.setAttribute('aInk', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1))
  const merged = mergeGeometries(parts)
  parts.forEach(g => g.dispose())
  if (!merged) throw new Error('Sketch geometry attributes do not match')
  return merged
}

export function sketched(shape: THREE.Shape, width = .014, segments = 20) {
  return combine([new THREE.ShapeGeometry(shape, segments), pencil(shape.extractPoints(segments).shape, width, true)])
}

export function sketchedRibbon(c: THREE.Curve<THREE.Vector2>, w0: number, w1: number) {
  const fill = ribbon(c, w0, w1)
  const positions = fill.attributes.position
  const edges = [0, 1].map(side => Array.from({ length: positions.count / 2 }, (_, i) =>
    new THREE.Vector2(positions.getX(i * 2 + side), positions.getY(i * 2 + side))))
  return combine([fill, ...edges.map(edge => pencil(edge, .014))])
}

/** 全屏纸纹叠层（屏幕空间颗粒 + 纤维） */
export function paperOverlay() {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uQ: { value: 1 } },
    vertexShader: `void main(){gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: /* glsl */ `
      uniform float uQ;
      float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){
        vec2 p=gl_FragCoord.xy;
        float g=h(floor(p*.5));
        float f=h(floor(p*vec2(.02,.5)))*.5+h(floor(p*vec2(.5,.02)))*.5;
        gl_FragColor=vec4(.45,.43,.34,g*.035+f*.025*uQ);
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m)
  mesh.frustumCulled = false
  mesh.renderOrder = 999
  return mesh
}

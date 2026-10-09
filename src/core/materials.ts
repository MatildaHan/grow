import * as THREE from 'three'

export const uTime = { value: 0 }
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

const VERT = /* glsl */ `
uniform float uGrow,uBase,uMode,uTime,uSway;
attribute float aBorn;
attribute float aSeed;
varying vec2 vUv; varying vec3 vW; varying float vSeed;
void main(){
  vUv=uv; vSeed=aSeed;
  vec3 p=position;
  float g=1.;
  if(uMode<.5) g=clamp(uGrow*1.4-aSeed*.4,0.,1.);
  else if(uMode>2.5) g=clamp((uTime-aBorn)*1.2,0.,1.);
  if(uMode<.5||uMode>2.5) p.y=uBase+(p.y-uBase)*g;
  vec4 m=vec4(p,1.);
  #ifdef USE_INSTANCING
  m=instanceMatrix*m;
  #endif
  m=modelMatrix*m;
  m.x+=sin(uTime*1.6+m.x*.8+aSeed*6.)*uSway*max(position.y,0.)*.25*g;
  vW=m.xyz;
  gl_Position=projectionMatrix*viewMatrix*m;
}`

// uMode: 0 底边抽长  1 噪声晕染  2 沿 uv.x 铺开  3 实例按出生时间生长
const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uGrow,uMode,uShade,uTime,uFlow;
varying vec2 vUv; varying vec3 vW; varying float vSeed;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
  if(uMode>.5&&uMode<1.5&&n(vW.xy*.9)>uGrow*1.25-.1) discard;
  if(uMode>1.5&&uMode<2.5&&vUv.x>uGrow) discard;
  float l=n(vW.xy*1.7)*.6+clamp(vUv.y,0.,1.)*.4+(vSeed-.5)*.3;
  if(uFlow>.5) l+=step(.82,n(vec2(vUv.x*40.-uTime*1.5,vUv.y*6.)))*.35;
  float s=l<.35?.82:(l<.68?1.:1.14);          // 三色阶
  gl_FragColor=vec4(mix(uColor,uColor*s,uShade),1.);
  #include <colorspace_fragment>
}`

export interface InkOpts { mode?: 0 | 1 | 2 | 3; base?: number; shade?: number; sway?: number; flow?: boolean }

export function inkMat(color: string, o: InkOpts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uGrow: { value: 0 }, uBase: { value: o.base ?? 0 }, uMode: { value: o.mode ?? 0 },
      uShade: { value: o.shade ?? 1 }, uSway: { value: REDUCED ? 0 : o.sway ?? 0 },
      uFlow: { value: o.flow ? 1 : 0 }, uTime,
    },
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
  })
}

/** 补齐 shader 需要的自定义属性，避免读到未绑定的垃圾值 */
export function mk(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const n = geo.attributes.position.count
  for (const a of ['aSeed', 'aBorn'])
    if (!geo.attributes[a]) geo.setAttribute(a, new THREE.BufferAttribute(new Float32Array(n), 1))
  return new THREE.Mesh(geo, mat)
}

/** 沿曲线的带状几何：uv.x = 沿长度 0..1，uv.y = 横向 */
export function ribbon(c: THREE.Curve<THREE.Vector2>, w0: number, w1: number, seg = 64) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, p = c.getPoint(t), tg = c.getTangent(t), w = (w0 + (w1 - w0) * t) / 2
    pos.push(p.x - tg.y * w, p.y + tg.x * w, 0, p.x + tg.y * w, p.y - tg.x * w, 0)
    uv.push(t, 0, t, 1)
    if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
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
        gl_FragColor=vec4(.45,.36,.25,g*.08+f*.06*uQ);
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m)
  mesh.frustumCulled = false
  mesh.renderOrder = 999
  return mesh
}

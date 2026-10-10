<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { Game, type HudState } from '../core/Game'
import { track } from '../core/analytics'

const canvas = ref<HTMLCanvasElement>()
const fatal = ref('')
const hud = reactive<HudState>({
  stage: -1, total: 8, progress: 0, done: false, quality: 'high', hint: '点一下画纸，种下第一笔', names: [],
})
const chapter = computed(() => hud.done ? '画已长成' : hud.stage < 0 ? '从一张空白开始' : hud.names[hud.stage])
const number = computed(() => String(Math.max(1, hud.stage + 1)).padStart(2, '0'))
let game: Game | null = null

onMounted(() => {
  try {
    game = new Game(canvas.value!, hud, e => {
      fatal.value = e
      game?.dispose()
      game = null
    })
    game.start()
  } catch (e) {
    fatal.value = 'init'
    track('error', { where: 'init', msg: String(e) })
  }
})
onBeforeUnmount(() => game?.dispose())

const save = () => game?.screenshot()
const again = () => game?.reset()
const reload = () => window.location.reload()
</script>

<template>
  <main class="stage">
    <header class="masthead">
      <div class="title-lockup">
        <span class="eyebrow">GROW FREELY · 向着光，也向着自己</span>
        <h1>自由生长<span class="title-dot">。</span></h1>
      </div>
      <p class="intro">不必画得完美<br>让风景按自己的模样生长</p>
    </header>

    <div class="paper-frame" :class="{ complete: hud.done }">
      <canvas ref="canvas" aria-label="手绘生长画纸，点按开始，按住拖动绘画" />
      <div v-if="hud.stage < 0 && !fatal" class="invitation">
        <svg class="botanical-mark" viewBox="0 0 100 120" aria-hidden="true">
          <path class="stem" d="M50 103C46 84 55 65 49 44M50 84C32 80 25 66 24 61C43 65 47 72 50 84ZM51 70C67 68 74 58 77 51C61 52 54 60 51 70Z" />
          <g class="petals"><path d="M50 46C40 35 43 20 50 15C60 24 60 38 50 46ZM50 46C35 46 25 34 27 27C42 26 48 35 50 46ZM50 46C39 59 24 57 20 50C28 39 42 39 50 46ZM50 46C59 57 74 56 80 49C72 37 59 39 50 46ZM50 46C63 43 74 31 71 25C57 25 50 33 50 46Z" /></g>
          <circle cx="50" cy="45" r="6" /><path d="M34 106C43 101 58 102 67 105M41 109L38 111M60 107L63 110" />
        </svg>
        <p>每一幅风景，都从一笔开始</p>
        <span>点一下画纸 · 轻轻拖动</span>
      </div>
      <span class="paper-note" aria-hidden="true">{{ hud.done ? '属于你的，小小世界' : 'GROW FREELY / 自由生长' }}</span>
    </div>

    <footer class="workbench">
      <div class="chapter">
        <span class="chapter-number">{{ number }}<small> / 08</small></span>
        <span class="chapter-title">{{ chapter }}</span>
      </div>
      <p class="hint" role="status" aria-live="polite">{{ hud.hint }}</p>
      <div class="journey" aria-label="生长阶段">
        <span v-for="(n, i) in hud.names" :key="n" class="step"
              :class="{ on: i === hud.stage && !hud.done, done: i < hud.stage || hud.done }"
              :aria-current="i === hud.stage && !hud.done ? 'step' : undefined">
          <i aria-hidden="true">{{ i < hud.stage || hud.done ? '✓' : String(i + 1).padStart(2, '0') }}</i>{{ n }}
        </span>
      </div>
      <div class="controls">
        <div v-if="hud.stage >= 0 && !hud.done" class="bar" role="progressbar" aria-label="当前阶段进度"
             :aria-valuenow="Math.round(hud.progress * 100)" :aria-valuemin="0" :aria-valuemax="100">
          <i :style="{ transform: `scaleX(${hud.progress})` }" />
        </div>
        <div v-if="hud.done" class="btns">
          <button class="primary" @click="save">收藏这幅风景 <span aria-hidden="true">↓</span></button>
          <button @click="again">再种一个世界 <span aria-hidden="true">↻</span></button>
        </div>
      </div>
    </footer>
    <div v-if="fatal" class="fatal" role="alert">
      <span class="eyebrow">稍等，重新展开画纸</span>
      <p>画纸没能展开（需要 WebGL 支持）。</p>
      <button @click="reload">重试</button>
    </div>
  </main>
</template>

<style scoped>
.stage { position: relative; height: 100%; min-height: 480px; isolation: isolate; }
.masthead { position: absolute; z-index: 2; top: max(28px, env(safe-area-inset-top)); left: 4vw; right: 4vw; display: flex; align-items: center; justify-content: space-between; pointer-events: none; }
.title-lockup { white-space: nowrap; }
.eyebrow { font-size: 10px; letter-spacing: .2em; color: #7c8a75; }
h1 { margin: 8px 0 0; font-weight: 400; font-size: 48px; letter-spacing: .12em; line-height: 1.2; color: #5a6d5a; }
.title-dot { color: #a39469; }
.intro { margin: 0; color: #7c8670; text-align: right; font-size: 13px; line-height: 2; letter-spacing: .1em; }
.paper-frame { position: absolute; inset: 0; overflow: hidden; }
canvas { width: 100%; height: 100%; position: absolute; inset: 0; display: block; touch-action: none; cursor: crosshair; }
.complete canvas { cursor: default; }
.invitation { position: absolute; inset: 0 0 80px; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: none; color: #697c62; }
.botanical-mark { width: 100px; height: 120px; fill: none; stroke: #647661; stroke-width: 1.15; stroke-linecap: round; stroke-linejoin: round; }
.botanical-mark .stem { fill: #c8d5b4; }
.botanical-mark .petals { fill: #dae3d8; }
.botanical-mark circle { fill: #c9ab91; stroke: #968876; }
.invitation p { font-size: 19px; letter-spacing: .13em; margin: 20px 0 10px; color: #58684f; }
.invitation span { font-size: 12px; letter-spacing: .15em; color: #8e967e; }
.paper-note { position: absolute; left: 4vw; bottom: 24px; font-size: 9px; letter-spacing: .16em; color: #68765e80; pointer-events: none; }
.workbench { position: absolute; z-index: 2; left: 0; right: 0; bottom: max(20px, env(safe-area-inset-bottom)); display: grid; justify-items: center; gap: 10px; pointer-events: none; }
.chapter { display: flex; align-items: baseline; gap: 12px; padding: 3px 12px; background: #f0f1e5db; border-radius: 3px 5px 2px 4px; }
.chapter-number { font-size: 16px; color: #738262; font-variant-numeric: tabular-nums; }
.chapter-number small { font-size: 10px; color: #96a086; letter-spacing: .12em; }
.chapter-title { font-size: 15px; letter-spacing: .12em; color: #52674f; }
.hint { margin: 0; font-size: 13px; letter-spacing: .08em; color: #626f58; text-align: center; line-height: 1.5; padding: 6px 18px; border-radius: 45% 48% 43% 49% / 12% 17% 14% 18%; background: #f0f1e5db; }
.journey { display: flex; gap: 19px; padding: 5px 15px; background: #f0f1e5c4; border-radius: 4px 7px 3px 5px; }
.step { display: flex; align-items: center; gap: 5px; color: #7c8870; font-size: 12px; white-space: nowrap; }
.step i { display: grid; place-items: center; width: 20px; height: 20px; font-size: 9px; font-style: normal; border: 1px solid #94a18a70; border-radius: 50% 46% 48% 44%; }
.step.done { color: #586f58; }
.step.done i { border-color: #87966b70; background: #87966b12; }
.step.on { color: #6a6f46; }
.step.on i { color: #f6f6ea; border-color: #7e8e70; background: #7e8e70; }
.controls { height: 42px; display: grid; place-items: center; }
.bar { width: min(220px, 55vw); height: 2px; background: #667a5630; border-radius: 2px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #728761; transform-origin: left; transition: transform .12s linear; }
.btns { display: flex; gap: 10px; pointer-events: auto; }
button { font: inherit; font-size: 13px; letter-spacing: .06em; padding: 10px 18px; min-height: 42px; border: 1px solid #71816d; outline: 1px solid #71816d30; outline-offset: 2px; background: #f0f1e5; color: #53684f; border-radius: 2px 4px 1px 3px; cursor: pointer; transition: background .2s, transform .2s; }
button.primary { color: #f4f4e8; background: #526a5c; border-color: #526a5c; }
button:hover { background: #e3e8d7; transform: translateY(-1px); }
button.primary:hover { background: #425b4c; }
button:focus-visible { outline: 2px solid #a08960; outline-offset: 4px; }
button span { margin-left: 7px; }
.fatal { position: absolute; inset: 0; z-index: 3; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; background: #f0efe5; }
@media (max-width: 700px) {
  .masthead { left: 20px; right: 20px; }
  h1 { font-size: 34px; }
  .intro { font-size: 11px; letter-spacing: .02em; }
  .eyebrow { font-size: 8px; letter-spacing: .1em; }
  .paper-frame { top: 110px; bottom: 205px; mask-image: linear-gradient(to bottom, transparent, #000 24px, #000 calc(100% - 30px), transparent); }
  .invitation { bottom: 0; }
  .journey { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 17px; }
  .workbench { gap: 9px; }
  .invitation p { font-size: 15px; letter-spacing: .06em; }
  .hint { font-size: 12px; }
  .paper-note { left: 20px; bottom: 10px; font-size: 8px; }
  button { padding: 9px 12px; }
}
@media (max-width: 360px) {
  h1 { font-size: 29px; letter-spacing: .08em; }
  .intro { font-size: 10px; white-space: nowrap; }
  .eyebrow { font-size: 7px; }
}
@media (max-height: 600px) and (min-width: 701px) {
  .masthead { top: 16px; }
  h1 { font-size: 32px; }
  .workbench { gap: 6px; bottom: 14px; }
}
@media (max-height: 520px) {
  .stage { min-height: 320px; }
  .masthead { top: max(10px, env(safe-area-inset-top)); }
  h1 { font-size: 27px; }
  .eyebrow { font-size: 8px; }
  .intro { font-size: 10px; }
  .paper-frame { top: 0; bottom: 0; mask-image: none; }
  .chapter, .paper-note { display: none; }
  .workbench { gap: 6px; bottom: max(10px, env(safe-area-inset-bottom)); }
  .journey { gap: 6px 12px; }
  .controls { height: 36px; }
  button { min-height: 36px; padding-top: 7px; padding-bottom: 7px; }
}
@media (prefers-reduced-motion: reduce) {
  .bar i, button { transition: none; }
}
</style>

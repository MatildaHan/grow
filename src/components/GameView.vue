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
        <span class="eyebrow">一笔一画 · 慢慢生长</span>
        <h1>纸上生长<span class="title-dot">。</span></h1>
      </div>
      <p class="intro">把片刻留给自己<br>让一方风景，在纸上醒来</p>
    </header>

    <div class="paper-frame" :class="{ complete: hud.done }">
      <canvas ref="canvas" aria-label="手绘生长画纸，点按开始，按住拖动绘画" />
      <div v-if="hud.stage < 0 && !fatal" class="invitation">
        <svg viewBox="0 0 80 80" aria-hidden="true"><path d="M40 60V32M40 45C21 45 19 30 22 24C37 24 42 32 40 45ZM40 37C58 37 62 20 59 16C45 18 38 25 40 37ZM25 62C34 58 46 58 55 62" /></svg>
        <p>每一幅风景，都从一笔开始</p>
        <span>点一下画纸 · 轻轻拖动</span>
      </div>
      <span class="paper-note" aria-hidden="true">{{ hud.done ? '属于你的，小小世界' : 'PAPER GROW / 生长手记' }}</span>
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
.stage { position: relative; height: 100%; min-height: 480px; display: flex; flex-direction: column; padding: max(28px, env(safe-area-inset-top)) 5vw max(22px, env(safe-area-inset-bottom)); box-sizing: border-box; gap: 22px; }
.masthead { display: flex; align-items: center; justify-content: space-between; flex: none; }
.title-lockup { flex-shrink: 0; white-space: nowrap; }
.eyebrow { font-size: 11px; letter-spacing: .25em; color: #8e866f; }
h1 { margin: 6px 0 0; font-weight: 400; font-size: 34px; letter-spacing: .13em; line-height: 1.2; }
.title-dot { color: #a96648; }
.intro { margin: 0; color: #8a826e; text-align: right; font-size: 13px; line-height: 1.9; letter-spacing: .1em; }
.paper-frame { position: relative; flex: 1; min-height: 160px; isolation: isolate; background: #f2ead8; border: 1px solid #aa9d7740; border-radius: 3px 7px 5px 4px; box-shadow: 0 5px 18px #5b4b3110, 0 1px 2px #5b4b3110; overflow: hidden; }
.paper-frame::after { content: ''; position: absolute; inset: 7px; border: 1px solid #fff5; border-radius: 2px 5px; pointer-events: none; }
canvas { width: 100%; height: 100%; position: absolute; inset: 0; display: block; touch-action: none; cursor: crosshair; }
.complete canvas { cursor: default; }
.invitation { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: none; color: #7e8863; }
.invitation svg { width: 68px; height: 68px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.invitation p { font-size: 18px; letter-spacing: .12em; margin: 16px 0 10px; color: #69634f; }
.invitation span { font-size: 12px; letter-spacing: .15em; color: #9e957d; }
.paper-note { position: absolute; left: 20px; bottom: 15px; font-size: 9px; letter-spacing: .18em; color: #5c5c4680; pointer-events: none; }
.workbench { display: grid; justify-items: center; flex: none; gap: 11px; }
.controls { height: 42px; display: grid; place-items: center; }
.chapter { display: flex; align-items: baseline; gap: 12px; }
.chapter-number { font-size: 20px; color: #9a7055; font-variant-numeric: tabular-nums; }
.chapter-number small { font-size: 10px; color: #a89d85; letter-spacing: .12em; }
.chapter-title { font-size: 17px; letter-spacing: .12em; }
.hint { margin: 0; font-size: 14px; letter-spacing: .08em; color: #8b8069; text-align: center; line-height: 1.5; }
.journey { display: flex; gap: 22px; margin-top: 3px; }
.step { display: flex; align-items: center; gap: 5px; color: #a39a83; font-size: 12px; white-space: nowrap; }
.step i { display: grid; place-items: center; width: 20px; height: 20px; font-size: 9px; font-style: normal; border: 1px solid #b4a98c60; border-radius: 50% 46% 48% 44%; }
.step.done { color: #7f8c68; }
.step.done i { border-color: #87966b70; background: #87966b12; }
.step.on { color: #9c6447; }
.step.on i { color: #faf5e7; border-color: #ad7958; background: #ad7958; }
.bar { width: min(220px, 55vw); height: 2px; background: #a79d8125; border-radius: 2px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #8d9b6b; transform-origin: left; transition: transform .12s linear; }
.btns { display: flex; gap: 10px; }
button { font: inherit; font-size: 13px; letter-spacing: .06em; padding: 10px 18px; min-height: 42px; border: 1px solid #95866b70; background: #f8f2e6; color: #76664f; border-radius: 3px 5px 4px 6px; cursor: pointer; transition: background .2s, transform .2s; }
button.primary { color: #f8f2e6; background: #7f8d65; border-color: #7f8d65; }
button:hover { background: #eee5d2; transform: translateY(-1px); }
button.primary:hover { background: #707e56; }
button:focus-visible { outline: 2px solid #a96f4a; outline-offset: 4px; }
button span { margin-left: 7px; }
.fatal { position: absolute; inset: 0; z-index: 3; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; background: #f2ead8; }
@media (max-width: 700px) {
  .stage { padding-left: 20px; padding-right: 20px; gap: 20px; }
  h1 { font-size: 29px; }
  .intro { font-size: 11px; letter-spacing: .03em; }
  .eyebrow { font-size: 10px; }
  .journey { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px 17px; }
  .invitation p { font-size: 15px; letter-spacing: .07em; }
  .hint { font-size: 12px; }
  .paper-note { left: 13px; bottom: 12px; font-size: 8px; }
  button { padding: 9px 12px; }
}
@media (max-height: 600px) and (min-width: 701px) {
  .stage { gap: 12px; padding-top: 16px; padding-bottom: 14px; min-height: 360px; }
  h1 { font-size: 25px; }
  .workbench { gap: 6px; }
}
@media (max-width: 360px) {
  h1 { font-size: 25px; letter-spacing: .08em; }
  .intro { font-size: 10px; white-space: nowrap; }
}
@media (max-height: 520px) {
  .stage { min-height: 320px; padding-top: max(10px, env(safe-area-inset-top)); padding-bottom: max(10px, env(safe-area-inset-bottom)); gap: 10px; }
  h1 { font-size: 23px; }
  .eyebrow { font-size: 9px; }
  .intro { font-size: 10px; }
  .chapter { display: none; }
  .workbench { gap: 6px; }
  .journey { gap: 6px 12px; margin: 0; }
  .controls { height: 36px; }
  button { min-height: 36px; padding-top: 7px; padding-bottom: 7px; }
}
@media (prefers-reduced-motion: reduce) {
  .bar i, button { transition: none; }
}
</style>

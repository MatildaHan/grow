<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Game, type HudState } from '../core/Game'
import { track } from '../core/analytics'

const canvas = ref<HTMLCanvasElement>()
const fatal = ref('')
const mobileDialog = ref<HTMLDialogElement>()
const mobileSheet = ref<'stages' | 'brushes' | 'artwork' | ''>('')
const mobileMedia = window.matchMedia('(max-width: 700px), (max-width: 1024px) and (pointer: coarse)')
const sheetTitle = computed(() => ({ stages: '让风景继续生长', brushes: '选一支喜欢的画笔', artwork: '收藏你的小小世界' })[mobileSheet.value || 'stages'])
const closeSheet = () => { mobileSheet.value = ''; mobileDialog.value?.close() }
const onNativeClose = () => { if (!mobileDialog.value?.open) mobileSheet.value = '' }
const onLayoutChange = () => { if (!mobileMedia.matches) closeSheet() }
const onBackdrop = (e: MouseEvent) => {
  const dialog = mobileDialog.value
  if (!dialog || e.target !== dialog) return
  const rect = dialog.getBoundingClientRect()
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) closeSheet()
}
watch(mobileSheet, value => {
  const dialog = mobileDialog.value
  if (!dialog) return
  if (value && !dialog.open) dialog.showModal()
  else if (!value && dialog.open) dialog.close()
}, { flush: 'post' })
const hud = reactive<HudState>({
  stage: -1, total: 8, progress: 0, done: false, quality: 'high', hint: '点一下画纸，种下第一笔', names: [],
  tools: [], tool: '', directions: [], direction: '', canUndo: false,
})
const brushName = computed(() => hud.tools.find(t => t.id === hud.tool)?.label ?? '等待第一笔')
const chapter = computed(() => hud.stage < 0 ? '从一张空白开始' : hud.names[hud.stage] + (hud.done ? ' · 自由添画' : ''))
const number = computed(() => String(Math.max(1, hud.stage + 1)).padStart(2, '0'))
let game: Game | null = null

onMounted(() => {
  mobileMedia.addEventListener('change', onLayoutChange)
  try {
    game = new Game(canvas.value!, hud, e => {
      closeSheet()
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
onBeforeUnmount(() => { closeSheet(); mobileMedia.removeEventListener('change', onLayoutChange); game?.dispose() })

const save = () => { game?.screenshot(); closeSheet() }
const again = () => { game?.reset(); closeSheet() }
const chooseStage = (i: number) => { game?.selectStage(i); closeSheet() }
const chooseTool = (id: string) => game?.selectTool(id)
const chooseDirection = (id: string) => game?.selectDirection(id)
const undo = () => game?.undo()
const reload = () => window.location.reload()
</script>

<template>
  <main class="stage">
    <header class="masthead">
      <div class="title-lockup">
        <span class="eyebrow">GROW FREELY · 向着光，也向着自己</span>
        <h1>自由生长<span class="title-dot">。</span></h1>
      </div>
      <span class="mobile-tagline">随手种一片风景</span>
      <button class="mobile-artwork" :disabled="!hud.done" @click="mobileSheet = 'artwork'" aria-label="打开作品操作">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14v15H5zM8 14l3-3 2 2 3-5M8 7h2" /></svg>作品
      </button>
      <p class="intro">不必画得完美<br>让风景按自己的模样生长</p>
    </header>

    <div class="paper-frame">
      <canvas ref="canvas" aria-label="手绘生长画纸，点按开始，按住拖动绘画" />
      <div v-if="hud.stage < 0 && !fatal" class="invitation">
        <svg class="botanical-mark" viewBox="0 0 100 120" aria-hidden="true">
          <path class="stem" d="M50 103C46 84 55 65 49 44M50 84C32 80 25 66 24 61C43 65 47 72 50 84ZM51 70C67 68 74 58 77 51C61 52 54 60 51 70Z" />
          <g class="petals"><path d="M50 46C40 35 43 20 50 15C60 24 60 38 50 46ZM50 46C35 46 25 34 27 27C42 26 48 35 50 46ZM50 46C39 59 24 57 20 50C28 39 42 39 50 46ZM50 46C59 57 74 56 80 49C72 37 59 39 50 46ZM50 46C63 43 74 31 71 25C57 25 50 33 50 46Z" /></g>
          <circle cx="50" cy="45" r="6" /><path d="M34 106C43 101 58 102 67 105M41 109L38 111M60 107L63 110" />
        </svg>
        <p>每一幅风景，都从一笔开始</p>
        <span class="desktop-invitation-copy">点一下画纸 · 轻轻拖动</span>
        <span class="mobile-invitation-copy">轻触画纸 · 按住拖动</span>
      </div>
      <span class="paper-note" aria-hidden="true">{{ hud.done ? '属于你的，小小世界' : 'GROW FREELY / 自由生长' }}</span>
    </div>

    <footer class="workbench">
      <div class="editor-row">
        <div class="chapter">
          <span class="chapter-number">{{ number }}<small> / 08</small></span>
          <span class="chapter-title">{{ chapter }}</span>
        </div>
        <div v-if="hud.tools.length" class="toolbox" role="toolbar" :aria-label="hud.names[hud.stage] + '画笔样式'">
          <button v-for="t in hud.tools" :key="t.id" class="tool" :class="{ selected: t.id === hud.tool }"
                  :aria-pressed="t.id === hud.tool" @click="chooseTool(t.id)">{{ t.label }}</button>
        </div>
      </div>
      <div v-if="hud.directions.length" class="direction-row" role="toolbar" aria-label="麦穗生长方向">
        <span>生长方向</span>
        <button v-for="d in hud.directions" :key="d.id" class="tool" :class="{ selected: d.id === hud.direction }"
                :aria-pressed="d.id === hud.direction" @click="chooseDirection(d.id)">{{ d.label }}</button>
      </div>
      <p class="hint" role="status" aria-live="polite">{{ hud.hint }}</p>
      <div class="journey" aria-label="生长阶段">
        <button v-for="(n, i) in hud.names" :key="n" class="step" :disabled="!hud.done"
              :class="{ on: i === hud.stage, done: i < hud.stage || hud.done }" @click="chooseStage(i)"
              :aria-label="hud.done ? '继续添加' + n : n" :aria-current="i === hud.stage ? 'step' : undefined">
          <i aria-hidden="true">{{ i < hud.stage || hud.done ? '✓' : String(i + 1).padStart(2, '0') }}</i>{{ n }}
        </button>
      </div>
      <p v-if="hud.done" class="edit-note">点选任意步骤，继续在这幅画上生长</p>
      <div class="controls">
        <div v-if="hud.stage >= 0 && !hud.done" class="bar" role="progressbar" aria-label="当前阶段进度"
             :aria-valuenow="Math.round(hud.progress * 100)" :aria-valuemin="0" :aria-valuemax="100">
          <i :style="{ transform: `scaleX(${hud.progress})` }" />
        </div>
        <div v-if="hud.done" class="btns">
          <button class="undo" :disabled="!hud.canUndo" @click="undo" title="撤销上笔（⌘ / Ctrl + Z）">撤销上笔</button>
          <button class="primary" @click="save">收藏这幅风景 <span aria-hidden="true">↓</span></button>
          <button @click="again">再种一个世界 <span aria-hidden="true">↻</span></button>
        </div>
      </div>
    </footer>

    <footer class="mobile-dock" aria-label="手机绘画工具栏">
      <div class="mobile-status">
        <div><span class="mobile-count">{{ number }} / 08</span><strong>{{ hud.stage < 0 ? '从一笔开始' : hud.names[hud.stage] }}</strong></div>
        <span class="mobile-mode">{{ hud.done ? '自由添画' : hud.stage < 0 ? '轻触开始' : Math.round(hud.progress * 100) + '%' }}</span>
      </div>
      <div class="mobile-progress" role="progressbar" aria-label="手机当前阶段进度" :aria-valuenow="hud.done ? 100 : Math.round(hud.progress * 100)" :aria-valuemin="0" :aria-valuemax="100">
        <i :style="{ transform: `scaleX(${hud.done ? 1 : hud.progress})` }" />
      </div>
      <p class="mobile-hint" role="status" aria-live="polite">{{ hud.stage < 0 ? '轻触画纸，拖动让风景生长' : hud.hint }}</p>
      <nav class="mobile-tools" aria-label="绘画操作">
        <button @click="mobileSheet = 'stages'" aria-label="查看生长步骤">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V8M12 14C6 14 4 10 4 7c5 0 8 3 8 7ZM12 10c0-4 3-7 8-7 0 4-3 7-8 7ZM7 21h10" /></svg>
          <span>{{ hud.done ? '切换景物' : '生长步骤' }}</span>
        </button>
        <button :disabled="!hud.tools.length" @click="mobileSheet = 'brushes'" aria-label="选择画笔样式">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 15 9-11 3 3-10 10M8 15c-3 0-2 4-5 5 5 1 8-1 7-3" /></svg>
          <span>画笔<small>{{ brushName }}</small></span>
        </button>
        <button :disabled="!hud.done || !hud.canUndo" @click="undo" aria-label="撤销上笔">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4-5 5 5 5M3 9h10c5 0 7 3 7 6s-3 5-7 5" /></svg><span>撤销</span>
        </button>
      </nav>
    </footer>

    <dialog ref="mobileDialog" class="mobile-sheet" aria-labelledby="mobile-sheet-title" @close="onNativeClose" @cancel="closeSheet" @click="onBackdrop">
      <div class="sheet-grip" aria-hidden="true" />
      <div class="sheet-heading"><h2 id="mobile-sheet-title">{{ sheetTitle }}</h2><button class="sheet-close" @click="closeSheet" aria-label="收起面板">×</button></div>
      <template v-if="mobileSheet === 'stages'">
        <p class="sheet-description">{{ hud.done ? '回到任意一步，在这幅画上继续添画' : '八步依次生长，完成后可以自由回选' }}</p>
        <div class="sheet-stages" aria-label="生长阶段">
          <button v-for="(name, i) in hud.names" :key="name" :disabled="!hud.done" :class="{ selected: i === hud.stage, finished: hud.done || i < hud.stage }"
                  :aria-current="i === hud.stage ? 'step' : undefined" :aria-label="hud.done ? '继续添加' + name : name" @click="chooseStage(i)">
            <i>{{ String(i + 1).padStart(2, '0') }}</i><span>{{ name }}</span><small>{{ i === hud.stage ? '当前' : hud.done || i < hud.stage ? '已生长' : '待生长' }}</small>
          </button>
        </div>
      </template>
      <template v-else-if="mobileSheet === 'brushes'">
        <p class="sheet-description">{{ hud.names[hud.stage] }} · {{ brushName }}，只影响接下来画下的笔迹</p>
        <div class="sheet-brushes" role="toolbar" aria-label="手机画笔样式">
          <button v-for="t in hud.tools" :key="t.id" :class="{ selected: t.id === hud.tool }" :aria-pressed="t.id === hud.tool" @click="chooseTool(t.id)">{{ t.label }}</button>
        </div>
        <template v-if="hud.directions.length">
          <h3>麦穗生长方向</h3>
          <div class="sheet-directions" role="toolbar" aria-label="手机麦穗生长方向">
            <button v-for="d in hud.directions" :key="d.id" :class="{ selected: d.id === hud.direction }" :aria-pressed="d.id === hud.direction" @click="chooseDirection(d.id)">{{ d.label }}</button>
          </div>
        </template>
      </template>
      <template v-else-if="mobileSheet === 'artwork'">
        <p class="sheet-description">把这幅风景带走，或展开一张新的画纸</p>
        <div class="sheet-artwork"><button class="primary" @click="save">保存风景为图片 <span aria-hidden="true">↓</span></button><button @click="again">再种一个世界 <span aria-hidden="true">↻</span></button></div>
      </template>
      <button class="sheet-return" @click="closeSheet">回到画纸</button>
    </dialog>
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
.invitation { position: absolute; inset: 0 0 80px; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: none; color: #697c62; }
.botanical-mark { width: 100px; height: 120px; fill: none; stroke: #647661; stroke-width: 1.15; stroke-linecap: round; stroke-linejoin: round; }
.botanical-mark .stem { fill: #c8d5b4; }
.botanical-mark .petals { fill: #dae3d8; }
.botanical-mark circle { fill: #c9ab91; stroke: #968876; }
.invitation p { font-size: 19px; letter-spacing: .13em; margin: 20px 0 10px; color: #58684f; }
.invitation span { font-size: 12px; letter-spacing: .15em; color: #8e967e; }
.paper-note { position: absolute; left: 4vw; bottom: 24px; font-size: 9px; letter-spacing: .16em; color: #68765e80; pointer-events: none; }
.workbench { position: absolute; z-index: 2; left: 0; right: 0; bottom: max(20px, env(safe-area-inset-bottom)); display: grid; justify-items: center; gap: 10px; pointer-events: none; }
.editor-row { display: flex; align-items: center; justify-content: center; gap: 10px; max-width: calc(100vw - 40px); }
.chapter { display: flex; align-items: baseline; gap: 12px; padding: 3px 12px; background: #f0f1e5db; border-radius: 3px 5px 2px 4px; }
.chapter-number { font-size: 16px; color: #738262; font-variant-numeric: tabular-nums; }
.chapter-number small { font-size: 10px; color: #96a086; letter-spacing: .12em; }
.chapter-title { font-size: 15px; letter-spacing: .12em; color: #52674f; }
.hint { margin: 0; font-size: 13px; letter-spacing: .08em; color: #626f58; text-align: center; line-height: 1.5; padding: 6px 18px; border-radius: 45% 48% 43% 49% / 12% 17% 14% 18%; background: #f0f1e5db; }
.journey { display: flex; gap: 12px; padding: 5px 15px; background: #f0f1e5c4; border-radius: 4px 7px 3px 5px; pointer-events: auto; }
.step { display: flex; align-items: center; gap: 5px; color: #7c8870; font-size: 12px; white-space: nowrap; min-height: 30px; padding: 0 3px; border: 0; outline: none; background: none; }
.step:disabled { cursor: default; }
.step:disabled:hover { background: none; transform: none; }
.toolbox { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; pointer-events: auto; padding: 3px 8px; border-radius: 3px; background: #f0f1e5d9; max-width: calc(100vw - 40px); }
.tool { min-height: 32px; padding: 4px 10px; border-color: #87967e60; outline: none; font-size: 12px; }
.tool.selected { background: #70866b; color: #f4f4e8; border-color: #70866b; }
.direction-row { display: flex; align-items: center; gap: 6px; pointer-events: auto; padding: 3px 10px; background: #f0f1e5d9; border-radius: 3px; }
.direction-row > span { font-size: 11px; color: #738262; margin-right: 4px; }
button:disabled { opacity: .45; cursor: default; }
button:disabled:hover { transform: none; background: #f0f1e5; }
.edit-note { font-size: 11px; color: #65775d; margin: 0; padding: 0 8px; background: #f0f1e5d9; }
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
@media (max-height: 600px) and (min-width: 701px) and (pointer: fine) {
  .masthead { top: 16px; }
  h1 { font-size: 32px; }
  .workbench { gap: 6px; bottom: 14px; }
}
@media (max-height: 520px) and (min-width: 701px) and (pointer: fine) {
  .stage { min-height: 320px; }
  .masthead { top: max(10px, env(safe-area-inset-top)); }
  h1 { font-size: 27px; }
  .eyebrow { font-size: 8px; }
  .intro { font-size: 10px; }
  .paper-frame { top: 0; bottom: 0; mask-image: none; }
  .chapter, .paper-note { display: none; }
  .workbench { gap: 6px; bottom: max(10px, env(safe-area-inset-bottom)); }
  .edit-note { display: none; }
  .journey { gap: 6px 12px; }
  .controls { height: 36px; }
  button { min-height: 36px; padding-top: 7px; padding-bottom: 7px; }
}

.mobile-tagline, .mobile-artwork, .mobile-dock, .mobile-sheet, .mobile-invitation-copy { display: none; }
@media (max-width: 700px), (max-width: 1024px) and (pointer: coarse) {
  .stage { display: grid; grid-template-rows: calc(64px + env(safe-area-inset-top)) minmax(0, 1fr) calc(170px + env(safe-area-inset-bottom)); min-height: 0; }
  .masthead { position: relative; inset: auto; grid-row: 1; padding: env(safe-area-inset-top) max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left)); gap: 10px; pointer-events: auto; }
  h1 { margin: 0; font-size: 26px; letter-spacing: .1em; }
  .eyebrow, .intro { display: none; }
  .mobile-tagline { display: block; flex: 1; color: #8a967f; font-size: 10px; letter-spacing: .06em; }
  .mobile-artwork { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 66px; min-height: 44px; padding: 0 6px; border: 0; outline: none; background: transparent; font-size: 12px; }
  .mobile-artwork svg { width: 20px; height: 20px; }
  .paper-frame { grid-row: 2; position: relative; inset: auto; margin: 0 max(10px, env(safe-area-inset-right)) 0 max(10px, env(safe-area-inset-left)); border: 1px solid #92a18430; border-radius: 15px 12px 16px 13px; mask-image: none; }
  canvas { cursor: default; }
  .invitation { inset: 0; }
  .botanical-mark { width: 72px; height: 86px; }
  .invitation p { margin: 15px 0 9px; font-size: 15px; letter-spacing: .06em; }
  .invitation span { font-size: 11px; letter-spacing: .06em; }
  .desktop-invitation-copy { display: none; }
  .mobile-invitation-copy { display: block; }
  .paper-note { left: 14px; bottom: 12px; font-size: 8px; letter-spacing: .08em; }
  .workbench { display: none; }
  .mobile-dock { display: flex; flex-direction: column; grid-row: 3; min-height: 0; padding: 13px max(16px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); box-sizing: border-box; background: #f0efe5; }
  .mobile-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; line-height: 24px; }
  .mobile-status > div { display: flex; align-items: baseline; gap: 10px; }
  .mobile-count { color: #929c85; font-size: 10px; letter-spacing: .06em; font-variant-numeric: tabular-nums; }
  .mobile-status strong { font-weight: 400; font-size: 16px; letter-spacing: .08em; }
  .mobile-mode { font-size: 10px; color: #7e8e72; }
  .mobile-progress { height: 2px; margin: 5px 0 8px; flex-shrink: 0; border-radius: 2px; overflow: hidden; background: #7585671c; }
  .mobile-progress i { display: block; height: 100%; background: #91a07a; transform-origin: left; }
  .mobile-hint { display: flex; align-items: center; margin: 0 0 8px; height: 34px; flex-shrink: 0; font-size: 11px; line-height: 17px; color: #7b856e; letter-spacing: .02em; }
  .mobile-tools { display: grid; grid-template-columns: 1fr 1fr 72px; gap: 8px; margin-top: auto; }
  .mobile-tools button { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; padding: 6px; border-color: #87967e45; border-radius: 10px 12px 9px 11px; outline: none; background: #e7ebdc; font-size: 12px; letter-spacing: .02em; }
  .mobile-tools button:last-child { background: transparent; }
  .mobile-tools svg { width: 22px; height: 22px; flex-shrink: 0; }
  .mobile-tools button span { margin: 0; white-space: nowrap; }
  .mobile-tools small { display: block; margin-top: 2px; font-size: 10px; color: #88927d; }
  .mobile-artwork svg, .mobile-tools svg { fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  button { min-height: 44px; -webkit-tap-highlight-color: #91a07a25; }
  button:hover { transform: none; }
  .mobile-sheet[open] { display: block; position: fixed; inset: auto 0 0; width: 100%; max-width: none; max-height: 82dvh; margin: 0; padding: 10px max(20px, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); box-sizing: border-box; border: 1px solid #92a18450; border-bottom: 0; border-radius: 22px 24px 0 0; background: #f3f2e8; color: #53684f; overflow-y: auto; overscroll-behavior: contain; }
  .mobile-sheet::backdrop { background: #34453645; }
  .sheet-grip { width: 32px; height: 3px; border-radius: 3px; margin: 0 auto 6px; background: #b4bba5; }
  .sheet-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sheet-heading h2 { margin: 0; font-size: 19px; letter-spacing: .06em; font-weight: 400; }
  .sheet-close { font-family: sans-serif; font-size: 26px; width: 44px; padding: 0; border: 0; outline: none; background: transparent; }
  .sheet-description { font-size: 12px; line-height: 1.8; color: #88917b; margin: 5px 0 16px; }
  .sheet-stages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .sheet-stages button { display: flex; align-items: center; justify-content: flex-start; gap: 8px; padding: 10px; min-height: 52px; border-color: #9ba78b50; outline: none; border-radius: 9px 11px 8px 10px; font-size: 14px; }
  .sheet-stages i { font-size: 10px; color: #929c85; font-style: normal; }
  .sheet-stages span { margin: 0; }
  .sheet-stages small { margin-left: auto; font-size: 9px; color: #96a086; }
  .sheet-stages button:disabled { opacity: .7; }
  .sheet-stages .finished { background: #e7ebdc; }
  .sheet-stages .selected, .sheet-brushes .selected, .sheet-directions .selected { color: #f4f4e8; background: #70866b; border-color: #70866b; }
  .sheet-stages .selected i, .sheet-stages .selected small { color: #e0e8d7; }
  .sheet-brushes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .sheet-brushes button, .sheet-directions button { padding: 8px; min-height: 48px; border-color: #9ba78b70; border-radius: 9px 11px 8px 10px; outline: none; font-size: 14px; }
  .mobile-sheet h3 { font-size: 13px; font-weight: 400; color: #7a896e; margin: 20px 0 10px; }
  .sheet-directions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .sheet-directions button { padding: 8px 4px; font-size: 12px; }
  .sheet-artwork { display: grid; gap: 10px; }
  .sheet-artwork button { border-radius: 9px 11px 8px 10px; min-height: 50px; }
  .sheet-return { width: 100%; margin-top: 18px; border: 0; border-top: 1px solid #9ba78b40; padding: 15px 0 0; outline: none; background: transparent; color: #89957b; font-size: 12px; }
  .fatal .eyebrow { display: block; }
}
@media (max-width: 360px) {
  .mobile-tagline { display: none; }
  .mobile-artwork { margin-left: auto; }
  .mobile-tools { grid-template-columns: 1fr 1fr 66px; gap: 6px; }
  .mobile-tools button { gap: 5px; }
  .mobile-tools svg { width: 20px; height: 20px; }
}
@media (orientation: landscape) and (max-height: 600px) and (max-width: 700px), (orientation: landscape) and (max-height: 600px) and (max-width: 1024px) and (pointer: coarse) {
  .stage { grid-template-columns: minmax(0, 1fr) 220px; grid-template-rows: calc(50px + env(safe-area-inset-top)) minmax(0, 1fr); }
  .masthead { grid-column: 1 / -1; }
  h1 { font-size: 23px; }
  .paper-frame { grid-column: 1; margin-bottom: max(10px, env(safe-area-inset-bottom)); }
  .mobile-dock { grid-column: 2; grid-row: 2; padding-top: 14px; border-left: 1px solid #92a18430; }
  .mobile-status > div { flex-direction: column; gap: 0; }
  .mobile-status strong { font-size: 18px; }
  .mobile-hint { height: auto; min-height: 34px; margin: 8px 0; }
  .mobile-tools { grid-template-columns: 1fr 1fr; }
  .mobile-tools button { flex-direction: column; gap: 3px; font-size: 11px; }
  .mobile-tools button:last-child { grid-column: 1 / -1; flex-direction: row; min-height: 44px; }
  .mobile-sheet[open] { left: auto; width: min(440px, 100vw); max-height: 90dvh; }
}

@media (orientation: landscape) and (max-height: 360px) and (max-width: 700px), (orientation: landscape) and (max-height: 360px) and (max-width: 1024px) and (pointer: coarse) {
  .mobile-dock { padding-top: 8px; }
  .mobile-status > div { flex-direction: row; gap: 6px; }
  .mobile-status strong { font-size: 15px; }
  .mobile-hint { margin: 4px 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bar i, button { transition: none; }
}
</style>

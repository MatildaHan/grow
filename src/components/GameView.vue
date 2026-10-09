<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { Game, type HudState } from '../core/Game'
import { track } from '../core/analytics'

const canvas = ref<HTMLCanvasElement>()
const fatal = ref('')
const hud = reactive<HudState>({
  stage: -1, total: 8, progress: 0, done: false, quality: 'high', hint: '点一下纸面，开始生长', names: [],
})
let game: Game | null = null

onMounted(() => {
  try {
    game = new Game(canvas.value!, hud, e => (fatal.value = e))
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
  <div class="stage">
    <canvas ref="canvas" />
    <header class="chips">
      <span v-for="(n, i) in hud.names" :key="n"
            :class="{ on: i === hud.stage && !hud.done, done: i < hud.stage || hud.done }">{{ n }}</span>
    </header>
    <footer>
      <p class="hint">{{ hud.hint }}</p>
      <div class="bar"><i :style="{ width: hud.progress * 100 + '%' }" /></div>
      <div v-if="hud.done" class="btns">
        <button @click="save">保存图片</button>
        <button @click="again">重新生长</button>
      </div>
    </footer>
    <div v-if="fatal" class="fatal">
      <p>画纸没能展开（需要 WebGL 支持）。</p>
      <button @click="reload">重试</button>
    </div>
  </div>
</template>

<style scoped>
.stage { position: relative; height: 100%; overflow: hidden; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.chips { position: absolute; top: max(12px, env(safe-area-inset-top)); left: 0; right: 0;
  display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; pointer-events: none; }
.chips span { padding: 2px 10px; font-size: 13px; border: 1.5px solid #3a322655; border-radius: 99px; opacity: .55; }
.chips .done { background: #3a3226; color: #f2ead8; opacity: .85; }
.chips .on { border-color: #3a3226; opacity: 1; }
footer { position: absolute; left: 0; right: 0; bottom: max(16px, env(safe-area-inset-bottom));
  display: grid; justify-items: center; gap: 8px; pointer-events: none; }
.hint { margin: 0; font-size: 16px; letter-spacing: .08em; }
.bar { width: min(240px, 60vw); height: 3px; background: #3a322622; border-radius: 2px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #3a3226; transition: width .15s; }
.btns { display: flex; gap: 10px; pointer-events: auto; }
button { font: inherit; font-size: 14px; padding: 5px 16px; border: 1.5px solid #3a3226;
  background: #f2ead8; color: inherit; border-radius: 4px; cursor: pointer; }
.fatal { position: absolute; inset: 0; display: grid; place-content: center; gap: 12px;
  text-align: center; background: #f2ead8; }
</style>

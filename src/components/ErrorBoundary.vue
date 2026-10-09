<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'
import { track } from '../core/analytics'

const err = ref<unknown>(null)
onErrorCaptured(e => {
  err.value = e
  track('error', { where: 'boundary', msg: String(e) })
  return false
})
const reload = () => window.location.reload()
</script>

<template>
  <slot v-if="!err" />
  <div v-else class="fb">
    <p>纸有点皱了，页面出了点问题。</p>
    <button @click="reload">重新展开</button>
  </div>
</template>

<style scoped>
.fb { height: 100%; display: grid; place-content: center; gap: 12px; text-align: center; font-size: 18px; }
button { font: inherit; padding: 6px 18px; border: 1.5px solid #3a3226; background: none; border-radius: 4px; }
</style>

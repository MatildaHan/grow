<script setup lang="ts">
import ErrorBoundary from './components/ErrorBoundary.vue'
import GameView from './components/GameView.vue'
</script>

<template>
  <ErrorBoundary><GameView /></ErrorBoundary>
</template>

<style>
html, body, #app { margin: 0; height: 100%; background: #f2ead8; overscroll-behavior: none; }
body { font-family: "LXGW WenKai", "Kaiti SC", STKaiti, KaiTi, serif; color: #3a3226; -webkit-user-select: none; user-select: none; }
</style>

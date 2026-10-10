<script setup lang="ts">
import ErrorBoundary from './components/ErrorBoundary.vue'
import GameView from './components/GameView.vue'
</script>

<template>
  <ErrorBoundary><GameView /></ErrorBoundary>
</template>

<style>
html, body, #app { margin: 0; height: 100%; overscroll-behavior: none; }
html { background: #f0efe5; }
body { font-family: "LXGW WenKai", "Kaiti SC", STKaiti, KaiTi, serif; color: #53644f; -webkit-user-select: none; user-select: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%237d6d4e' opacity='.045' filter='url(%23p)' d='M0 0h180v180H0z'/%3E%3C/svg%3E"); }
#app { height: 100dvh; }
</style>

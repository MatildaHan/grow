import { createApp } from 'vue'
import App from './App.vue'
import { track } from './core/analytics'

addEventListener('error', e => track('error', { where: 'window', msg: e.message }))
addEventListener('unhandledrejection', e => track('error', { where: 'promise', msg: String(e.reason) }))

const app = createApp(App)
app.config.errorHandler = e => track('error', { where: 'vue', msg: String(e) })
app.mount('#app')

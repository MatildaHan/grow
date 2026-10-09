const ENDPOINT = import.meta.env.VITE_ANALYTICS_URL as string | undefined
const sid = crypto.randomUUID?.() ?? String(Date.now())
const queue: object[] = []

export function flush() {
  if (!queue.length) return
  const body = JSON.stringify(queue.splice(0))
  if (ENDPOINT && navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, body)
  else if (import.meta.env.DEV) console.debug('[track]', body)
}

export function track(name: string, props: Record<string, unknown> = {}) {
  queue.push({ name, props, t: Date.now(), sid })
  if (queue.length >= 10) flush()
}

document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
addEventListener('pagehide', flush)
setInterval(flush, 15000)

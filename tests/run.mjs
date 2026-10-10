import { build } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'

const output = await mkdtemp(join(tmpdir(), 'free-grow-core-'))
try {
  await build({
    configFile: false, logLevel: 'error', envPrefix: 'CORE_TEST_',
    define: { 'import.meta.env.VITE_ANALYTICS_URL': 'undefined', 'import.meta.env.DEV': 'false' },
    build: { outDir: output, emptyOutDir: true, minify: false,
      lib: { entry: resolve('tests/core.mjs'), formats: ['es'], fileName: () => 'core.mjs' },
      rollupOptions: { external: ['node:assert/strict'] } },
  })
  globalThis.document = { addEventListener() {} }
  globalThis.addEventListener = () => {}
  if (!globalThis.crypto) globalThis.crypto = webcrypto
  const interval = globalThis.setInterval
  globalThis.setInterval = () => 0
  try { await import(pathToFileURL(join(output, 'core.mjs')).href) }
  finally { globalThis.setInterval = interval }
} finally { await rm(output, { recursive: true, force: true }) }

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const req = createRequire('<WORKTREE>/package.json')
const { svelte } = await import(pathToFileURL(req.resolve('@sveltejs/vite-plugin-svelte')).href)
const wasm = (await import(pathToFileURL(req.resolve('vite-plugin-wasm')).href)).default
const { svelteProxyPatch } = await import(pathToFileURL('<WORKTREE>/patches/svelte-5.57.3/plugin.mjs').href)
export default {
  root: '<SCRATCH>',
  plugins: [svelteProxyPatch(), svelte({ compilerOptions: { experimental: { async: true } } }), wasm()],
  resolve: { alias: { src: '<WORKTREE>/src' } },
  build: { outDir: 'dist', emptyOutDir: true, minify: 'oxc', target: 'baseline-widely-available' },
  worker: { format: 'es' }, server: { fs: { strict: false } }
}



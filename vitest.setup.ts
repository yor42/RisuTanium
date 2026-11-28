import { vi } from 'vitest'

// Suppress warning
vi.mock(import('katex'), () => ({}))

// The app hands wasmoon its bundled glue.wasm URL. Under Vitest that URL is a
// dev-server path, which wasmoon's Node loader would read as a filesystem path,
// so point it at the installed file instead.
vi.mock('wasmoon/dist/glue.wasm?url', async () => {
  const { fileURLToPath } = await import('node:url')
  return { default: fileURLToPath(import.meta.resolve('wasmoon/dist/glue.wasm')) }
})

// A bundled built-in archive's URL is a dev-server path (`/src/...`) under Vitest, which no Node fetch can read. Read those
// from the checkout; any other URL (a `data:` URL a test supplies) goes to the real reader.
vi.mock('./src/ts/themePack/bundledArchive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./src/ts/themePack/bundledArchive')>()
  return {
    ...actual,
    readBundledArchive: async (url: string): Promise<Uint8Array | null> => {
      if (!url.startsWith('/src/')) {
        return actual.readBundledArchive(url)
      }
      const { readFile } = await import('node:fs/promises')
      const { fileURLToPath } = await import('node:url')
      const { dirname, resolve } = await import('node:path')
      try {
        return new Uint8Array(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), `.${url}`)))
      } catch {
        return null
      }
    },
  }
})

// Tests that mount Svelte transitions rely on `Element.prototype.animate` being
// absent: components feature-detect it and collapse their transition to zero
// duration, which finishes synchronously. happy-dom's own Animation never
// completes outros on the test clock, so an element with an outro would stay in
// the DOM and cancelled animations surface as unhandled rejections. Removing it
// keeps the WAAPI-less environment that those components and tests assume.
if (typeof Element !== 'undefined') {
  delete (Element.prototype as { animate?: unknown }).animate
}

// jsdom has no matchMedia (happy-dom does), and platform.ts calls it at import
// time. The sanitizer test files run under jsdom, so give them the same
// "nothing matches" answer happy-dom returns.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

vi.stubGlobal('safeStructuredClone', (v: unknown) => JSON.parse(JSON.stringify(v)))

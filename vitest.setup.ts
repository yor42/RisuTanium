import { vi } from 'vitest'

// Suppress warning
vi.mock(import('katex'), () => ({}))

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

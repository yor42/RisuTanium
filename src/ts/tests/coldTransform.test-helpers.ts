// A first import that transforms a large module graph cold (the icon-library barrel, the parser, the chat shell's
// lazy parts) can take minutes on a loaded host. A test file pays it in a `beforeAll` bounded by this, before any
// test clock starts; vite keeps the transform across `vi.resetModules()`, so later imports only re-evaluate it.
// The bound covers the transform alone: a test that hangs still meets its own timeout.
export const COLD_TRANSFORM_HOOK_MS = 300_000

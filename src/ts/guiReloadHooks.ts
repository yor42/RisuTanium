// A dependency-free registry of callbacks that run on every GUI reload pointer bump. It has no imports on purpose:
// the stores module calls it, and modules that import the stores module (the parser) register into it, so a direct
// call in either direction would put a value binding across the stores/parser import cycle.

type GuiReloadHook = () => void

const hooks = new Set<GuiReloadHook>()

export function registerGuiReloadHook(hook: GuiReloadHook): () => void {
    hooks.add(hook)
    return () => {
        hooks.delete(hook)
    }
}

// Every hook runs even if an earlier one throws: a failing hook must not stop the others or the caller's own work.
export function runGuiReloadHooks(): void {
    for (const hook of [...hooks]) {
        try {
            hook()
        } catch (error) {
            console.error('GUI reload hook failed', error)
        }
    }
}

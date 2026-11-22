<script module lang="ts">
    import type { Component } from 'svelte'

    type RowImport = () => Promise<{ default: Component }>

    const defaultImport: RowImport = () => import('./ThemePackRow.svelte')

    // The row, the install flow and the theme pack runtime load on the first mount only; later mounts render synchronously.
    let cachedRow: Component | null = null
    let importRow: RowImport = defaultImport

    /** Test seam: forgets the loaded row and replaces the import (omitted: the real one). */
    export function resetThemePackRowLoaderForTests(next?: RowImport): void {
        cachedRow = null
        importRow = next ?? defaultImport
    }
</script>

<script lang="ts">
    import { onMount, tick, untrack } from 'svelte'
    import { language } from 'src/lang'
    import { focusFirstControl } from 'src/ts/settingsShell/settingsArrival'
    import { settingsSearchState } from 'src/ts/settingsShell/settingsSearchState.svelte'

    const ROW_ID = 'display.themePack'

    let Row = $state.raw<Component | null>(cachedRow)
    let failed = $state(false)

    // Plain variables on purpose: only the highlight below is read reactively.
    let wrapper: HTMLElement | null = null
    // True from the first mount until the load has been checked: an arrival may land before the row exists.
    let latePending = false
    let wantFocus = false
    let captured: Element | null = null
    let destroyed = false

    function clearLatch(): void {
        wantFocus = false
        captured = null
    }

    // A search arrival focuses the row synchronously. When the chunk is still loading, the shell's focus finds no control, so the
    // arrival is remembered here (with the element it left focus on) and focus moves to the row once the row has rendered.
    $effect(() => {
        const highlighted = settingsSearchState.highlightedRow
        untrack(() => {
            if (highlighted === null) {
                return
            }
            if (highlighted !== ROW_ID) {
                clearLatch()
                return
            }
            if (wrapper !== null && wrapper.contains(document.activeElement)) {
                clearLatch()
                return
            }
            if (latePending) {
                wantFocus = true
                captured = document.activeElement
            }
        })
    })

    async function load(): Promise<void> {
        let loaded: Component
        try {
            loaded = (await importRow()).default
        } catch {
            if (!destroyed) {
                failed = true
            }
            clearLatch()
            latePending = false
            return
        }
        cachedRow = loaded
        if (destroyed) {
            return
        }
        Row = loaded
        await tick()
        if (destroyed) {
            return
        }
        // Focus is taken only from nowhere, from the document body or from the element the arrival itself left focus on.
        const active = document.activeElement
        if (wantFocus && wrapper !== null && (active === null || active === document.body || active === captured)) {
            focusFirstControl(wrapper)
        }
        clearLatch()
        latePending = false
    }

    onMount(() => {
        if (Row === null) {
            latePending = true
            void load()
        }
        return () => {
            destroyed = true
            clearLatch()
            latePending = false
        }
    })
</script>

<div class="flex flex-col" bind:this={wrapper} data-part="theme-pack-row-host" data-part-critical>
    {#if Row}
        <Row />
    {:else if failed}
        <p class="text-sm text-draculared mt-4" role="status" data-part="theme-pack-load-failed" data-part-critical>{language.themePackRowLoadFailed}</p>
    {:else}
        <span class="text-textcolor mt-4">{language.themePackRowTitle}</span>
    {/if}
</div>

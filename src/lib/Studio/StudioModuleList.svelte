<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { EllipsisVertical, Globe, Waypoints } from '@lucide/svelte'
    import { language } from '../../lang'
    import { afterFlush } from '../../ts/afterFlush'
    import { alertConfirm, alertError, alertInput, alertSelect } from '../../ts/alert'
    import { ALERT_INPUT_CANCEL, ALERT_SELECT_CANCEL } from '../../ts/alertCancel'
    import { registerBackHandler } from '../../ts/backHandlers'
    import { importMCPModule } from '../../ts/process/mcp/mcp'
    import { importModule, type RisuModule } from '../../ts/process/modules'
    import { convertModuleRow, createModule, exportModuleRow, moduleIntegrationState, removeModuleRow, setModuleGlobal } from '../../ts/process/moduleListOps'
    import { isModuleStub } from '../../ts/storage/moduleStub'
    import { ownerSourceFor } from '../../ts/studio/ownerSource.svelte'
    import { openStudioModuleOwner, studioScreen, takeStudioListReveal } from '../../ts/studio/studioScreen.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import { createWindowHost } from '../../ts/windowing/windowHost.svelte'
    import { matchingModulePositions, moduleRowKeys } from '../Setting/Pages/Module/moduleListWindow'
    import WindowedSegment from '../UI/Windowed/WindowedSegment.svelte'
    import { badgeLabelOf } from './TreeRow.svelte'

    // About one row with a one-line description and its tags; each mounted row is measured.
    const MODULE_ROW_FALLBACK_PX = 77

    const uid = $props.id()
    const source = ownerSourceFor(() => studioScreen.chaId)

    // Rows follow the order of db.modules; the search only filters. A row is keyed by its module, so a search never
    // changes a key.
    let moduleSearch = $state('')
    const rowKeys = $derived(moduleRowKeys(DBState.db.modules ?? []))
    const moduleByKey = $derived(new Map(rowKeys.map((key, index) => [key, DBState.db.modules[index]])))
    const shownKeys = $derived(matchingModulePositions(DBState.db.modules ?? [], moduleSearch).map((index) => rowKeys[index]))

    let listRoot = $state<HTMLElement | null>(null)
    const windowHost = createWindowHost({ root: () => listRoot })
    onDestroy(() => windowHost.dispose())

    // Results of this page's own operations, announced politely.
    let status = $state('')
    let menuKey = $state<string | null>(null)

    // Back closes an open row menu before it leaves the page.
    $effect(() => {
        if (menuKey === null) return
        return registerBackHandler(() => {
            if (menuKey === null) return false
            menuKey = null
            return true
        })
    })

    // "Show in module list" from a module's detail: the search is cleared so the row is in the list, the row is scrolled
    // into view and its Open button is focused once. A row that is no longer in the list spends the request with nothing to show.
    $effect(() => {
        const key = studioScreen.revealListRow
        if (key === null || listRoot === null) return
        if (!rowKeys.includes(key)) {
            takeStudioListReveal(key)
            return
        }
        untrack(() => { moduleSearch = '' })
        let live = true
        void afterFlush().then(() => live ? windowHost.reveal(key) : null).then((wrapper) => {
            if (!live) return
            takeStudioListReveal(key)
            wrapper?.querySelector<HTMLElement>('[data-part="studio-module-list-open"]')?.focus()
        })
        return () => { live = false }
    })

    // A name that is not a non-empty string (an MCP server may report any JSON value) is shown as the page's own word.
    function nameOf(row: RisuModule): string {
        return typeof row.name === 'string' && row.name !== '' ? row.name : language.modules
    }

    function descriptionOf(row: RisuModule): string {
        return typeof row.description === 'string' && row.description !== '' ? row.description : language.settingsPage.noDescriptionProvided
    }

    async function openMenu(key: string): Promise<void> {
        menuKey = key
        await afterFlush()
        const wrapper = windowHost.elementOf(key)
        wrapper?.querySelector<HTMLElement>('[data-part="studio-module-list-menu"] button:not([disabled])')?.focus()
    }

    function closeMenu(returnFocusTo: string | null = null): void {
        menuKey = null
        if (returnFocusTo === null) return
        void afterFlush().then(() => windowHost.elementOf(returnFocusTo)?.querySelector<HTMLElement>('[data-part="studio-module-list-menu-button"]')?.focus())
    }

    function onmenukeydown(event: KeyboardEvent, key: string): void {
        // The menu owns its keys; Esc closes it and hands focus back to its button.
        event.stopPropagation()
        if (event.key !== 'Escape') return
        event.preventDefault()
        closeMenu(key)
    }

    // The name comes first, so nothing is created or stored until the user has given one.
    async function create(): Promise<void> {
        status = ''
        const answer = await alertInput(language.studioModuleListCreatePrompt, undefined, '', { cancel: ALERT_INPUT_CANCEL })
        if (answer === ALERT_INPUT_CANCEL) return
        const name = answer.trim()
        if (name === '') {
            status = language.studioModuleListNameNeeded
            return
        }
        const slot = createModule(name)
        // Read after the push: the model is derived from db.modules, so this read has the new owner.
        const current = source.current.model
        if (current) openStudioModuleOwner(current, slot, 'advanced')
    }

    async function exportRow(row: RisuModule): Promise<void> {
        status = ''
        const answer = await alertSelect([`CharX (${language.recommended})`, language.alerts.risumLegacy], undefined, { cancel: ALERT_SELECT_CANCEL })
        if (answer === ALERT_SELECT_CANCEL) return
        try {
            await exportModuleRow(row, parseInt(answer) === 0 ? 'charx' : 'risum')
        } catch (error) {
            alertError(error instanceof Error ? error.message : String(error))
        }
    }

    async function convertRow(row: RisuModule): Promise<void> {
        status = ''
        if (await convertModuleRow(row)) status = language.successfullyConverted
    }

    async function deleteRow(row: RisuModule): Promise<void> {
        status = ''
        const label = nameOf(row)
        if (!await alertConfirm(`${language.removeConfirm}${row.name}`)) return
        if (removeModuleRow(row)) status = language.studioModuleListDeleted(label)
    }

    function act(run: () => Promise<void>): void {
        menuKey = null
        void run()
    }
</script>

<div data-part="studio-module-list" class="flex flex-col gap-3 p-4">
    <h2 id="studio-detail-title" data-part="studio-detail-title" class="min-w-0 break-words text-lg font-bold">{language.studioModuleList}</h2>
    <div data-part="studio-module-list-toolbar" class="flex flex-wrap gap-2">
        <button type="button" data-part="studio-module-list-create" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => { void create() }}>{language.createModule}</button>
        <button type="button" data-part="studio-module-list-import" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => { void importModule() }}>{language.import}</button>
        <button type="button" data-part="studio-module-list-import-mcp" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => { void importMCPModule() }}>{language.moduleImportMcp}</button>
    </div>
    <input
        type="search"
        data-part="studio-module-list-search"
        class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor"
        aria-label={language.search}
        placeholder={language.search}
        bind:value={moduleSearch}
    />
    <div bind:this={listRoot}>
        {#if (DBState.db.modules ?? []).length === 0}
            <p data-part="studio-module-list-empty" class="text-textcolor2">{language.noModules}</p>
        {:else if shownKeys.length === 0}
            <p data-part="studio-module-list-no-match" class="text-textcolor2">{language.studioSearchNoResults}</p>
        {:else}
            <WindowedSegment
                host={windowHost}
                tag="ul"
                data-part="studio-module-list-rows"
                class="flex flex-col"
                keys={shownKeys}
                height={{ fallback: MODULE_ROW_FALLBACK_PX }}
                item={moduleRow}
            />
        {/if}
    </div>
    <p role="status" aria-live="polite" data-part="studio-module-list-status" class="min-h-5 text-sm text-textcolor2">{status}</p>
</div>

{#snippet moduleRow(key: string, position: number)}
    {@const row = moduleByKey.get(key)}
    {#if row}
        {@const integration = moduleIntegrationState(row, DBState.db)}
        {@const enabledGlobally = integration === 'global'}
        {@const integrated = integration === 'integration'}
        {@const stub = isModuleStub(row)}
        <div data-part="studio-module-list-row" class="flex items-stretch gap-1 border-t border-darkborderc py-1">
            <button type="button" data-part="studio-module-list-open" class="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-start rounded px-2 text-start hover:bg-selected" onclick={() => { const current = source.current.model; if (current) openStudioModuleOwner(current, row, 'advanced') }}>
                <span class="flex min-w-0 max-w-full items-center gap-1">
                    {#if row.mcp}
                        <Waypoints size={16} class="shrink-0" aria-hidden="true" />
                    {/if}
                    <span class="min-w-0 break-words font-bold">{nameOf(row)}</span>
                </span>
                <span class="min-w-0 break-words text-sm text-textcolor2">{descriptionOf(row)}</span>
                {#if stub || enabledGlobally}
                    <span class="flex flex-wrap gap-1">
                        {#if stub}
                            <span class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{language.studioNotLoaded}</span>
                        {/if}
                        {#if enabledGlobally}
                            <span class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{badgeLabelOf('allChats')}</span>
                        {/if}
                    </span>
                {/if}
            </button>
            <button
                type="button"
                role="switch"
                aria-checked={enabledGlobally}
                aria-label={language.enableGlobal}
                aria-describedby={integrated ? `${uid}-int-${position}` : undefined}
                data-part="studio-module-list-global"
                class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md {enabledGlobally ? 'bg-selected text-textcolor ring-1 ring-borderc' : integrated ? 'risu-state-amber ring-1 ring-current' : 'text-textcolor2 hover:text-textcolor'}"
                onclick={() => setModuleGlobal(row.id, !enabledGlobally)}
            >
                <Globe size={18} aria-hidden="true" />
            </button>
            {#if integrated}
                <span id="{uid}-int-{position}" data-part="studio-module-list-integrated" hidden>{language.moduleOnByIntegration}</span>
            {/if}
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuKey === key}
                aria-label={language.studioModuleListActions(nameOf(row))}
                data-part="studio-module-list-menu-button"
                class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-textcolor2 hover:text-textcolor"
                onclick={() => { if (menuKey === key) closeMenu(); else void openMenu(key) }}
            >
                <EllipsisVertical size={18} aria-hidden="true" />
            </button>
        </div>
        {#if menuKey === key}
            <div role="menu" tabindex="-1" data-part="studio-module-list-menu" class="mx-2 mb-1 flex flex-col rounded-md border border-darkborderc bg-darkbg p-1" onkeydown={(event) => onmenukeydown(event, key)}>
                <button type="button" role="menuitem" data-part="studio-module-list-export" class="min-h-11 rounded px-2 text-start enabled:hover:bg-selected enabled:cursor-pointer disabled:text-textcolor2" disabled={!!row.mcp} onclick={() => act(() => exportRow(row))}>{language.download}</button>
                <button type="button" role="menuitem" data-part="studio-module-list-convert" class="min-h-11 rounded px-2 text-start enabled:hover:bg-selected enabled:cursor-pointer disabled:text-textcolor2" disabled={!!row.mcp} onclick={() => act(() => convertRow(row))}>{language.moduleConvertRow}</button>
                <button type="button" role="menuitem" data-part="studio-module-list-delete" class="min-h-11 rounded px-2 text-start text-draculared hover:bg-selected cursor-pointer" onclick={() => act(() => deleteRow(row))}>{language.remove}</button>
                {#if row.mcp}
                    <p data-part="studio-module-list-mcp-note" class="px-2 py-1 text-sm text-textcolor2">{language.studioModuleListMcpOnly}</p>
                {/if}
            </div>
        {/if}
    {/if}
{/snippet}

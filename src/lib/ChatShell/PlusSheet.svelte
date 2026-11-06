<script lang="ts">
    import { tick, untrack } from 'svelte'
    import { v4 } from 'uuid'
    import { DBState, selIdState, selectedCharID, additionalChatMenu, easyPanelStore, hypaV3ModalOpen } from '../../ts/stores.svelte'
    import { pageStorageModeStore } from '../../ts/storage/pageStorageMode'
    import { utilityOpen, utilityVisible } from '../Utility/utilityGate'
    import { language } from '../../lang'
    import { sendContinue, reroll, type ComposerActionsSource } from '../../ts/process/composerActions.svelte'
    import { shellGenerationSource } from '../../ts/chatShell/sendFailure.svelte'
    import { stopTTS } from '../../ts/process/tts'
    import { canChatSpeak } from '../../ts/process/ttsModes'
    import { findCharacterbyId } from '../../ts/util'
    import { showHypaV2Alert, alertWait, alertNormal, alertError } from '../../ts/alert'
    import { downloadNotice } from '../../ts/exportNotice'
    import { downloadFile } from '../../ts/globalApi.svelte'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { buildPanelModel, isOn, selectedIndex, toggleVarKey, valueRowsOf } from '../../ts/chatShell/togglePanel'
    import { favouriteRows, type FavouriteRef, type FavouriteRow } from '../../ts/chatShell/toggleFavourites'
    import { currentFavourites, syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
    import ShellSheet from './ShellSheet.svelte'

    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        onclose: () => void
        onstickers: () => void
        onchatlist: () => void
        onmodules: () => void
        // The Toggles item, last in the menu: absent unless the shell can open the toggles panel. A text chip passes its star so the panel opens at that row; the item and More pass nothing.
        ontoggles?: (row?: FavouriteRef) => void
        togglesSummary?: () => string | null
    }
    let { open, opener, background, onclose, onstickers, onchatlist, onmodules, ontoggles, togglesSummary }: Props = $props()
    let character = $derived(DBState.db.characters[selIdState.selId])
    let chat = $derived(character?.chats?.[character.chatPage])
    const source: ComposerActionsSource = shellGenerationSource(() => onclose())

    function canContinue(): boolean {
        const messages = chat?.message ?? []
        return messages.length >= 2 && messages[messages.length - 1]?.role === 'char'
    }

    function activate(action: () => void): void {
        action()
        onclose()
    }

    // Favourite chips (TOGGLES_SPEC §5): the toggle sources and the scope accessors load only once a star exists, so a menu without stars costs nothing.
    type ChipSupport = {
        sourcesOf: typeof import('./TogglesPanel.svelte').toggleSourcesOf
        valueOf: typeof import('../../ts/parser/chatToggleScope').chatToggleValue
        writeTo: typeof import('../../ts/parser/chatToggleScope').writeChatToggle
    }
    const MAX_CHIPS = 8
    let support = $state.raw<ChipSupport | null>(null)
    let loadingSupport = false
    // Bumped after a write, so a chip shows the value even when the chat object is not reactive.
    let edits = $state(0)
    let picker = $state<FavouriteRow | null>(null)
    let announce = $state('')
    let body = $state<HTMLElement>()

    // Every opening starts on the menu itself, with nothing announced.
    $effect.pre(() => {
        void open
        untrack(() => {
            picker = null
            announce = ''
        })
    })

    // Another tab's star is adopted when the menu opens.
    $effect(() => {
        if (open) untrack(() => syncFavourites())
    })

    // Loading starts when the first star exists, not when the menu opens, so the chips are there before the focus goes in.
    $effect(() => {
        if (!ontoggles || support || loadingSupport || currentFavourites().items.length === 0) return
        loadingSupport = true
        void Promise.all([import('./TogglesPanel.svelte'), import('../../ts/parser/chatToggleScope')]).then(([panel, scope]) => {
            support = { sourcesOf: panel.toggleSourcesOf, valueOf: scope.chatToggleValue, writeTo: scope.writeChatToggle }
        }).catch((error) => console.error('The favourite chips did not load:', error)).finally(() => { loadingSupport = false })
    })

    // Only a star whose source is in use and still has the key shows, in star order; the others stay in the store.
    let chipRows = $derived.by((): FavouriteRow[] => {
        void edits
        if (!open || !ontoggles || !support || !character || !chat) return []
        try {
            const sources = buildPanelModel(support.sourcesOf(character)).sources.filter((source) => valueRowsOf(source).length > 0)
            return favouriteRows(sources, currentFavourites().items)
        } catch (error) {
            console.error('The favourite chips could not be built:', error)
            return []
        }
    })
    let shownChips = $derived(chipRows.slice(0, MAX_CHIPS))
    // With a star showing, the Toggles item and the chips lead the menu; without one the item stays last.
    let chipsLead = $derived(shownChips.length > 0)

    function chipValue(entry: FavouriteRow): string {
        void edits
        return support && chat ? support.valueOf(chat, toggleVarKey(entry.row.key)) : 'null'
    }

    function chipElement(uid: string): HTMLElement | null {
        return Array.from(body?.querySelectorAll<HTMLElement>('[data-part="plus-chip"]') ?? []).find((element) => element.dataset.uid === uid) ?? null
    }

    // Chips write on the chat that is shown, through the scope accessors: its own value while its scope is on, else the shared one.
    function writeChip(entry: FavouriteRow, value: string): void {
        if (!support || !character || !chat) return
        support.writeTo(character, chat, toggleVarKey(entry.row.key), value)
        edits++
    }

    function flipChip(entry: FavouriteRow): void {
        const on = isOn('check', chipValue(entry))
        writeChip(entry, on ? '0' : '1')
        announce = on ? language.chatShellTogglesOffA11y(entry.row.label) : language.chatShellTogglesOnA11y(entry.row.label)
    }

    async function openPicker(entry: FavouriteRow): Promise<void> {
        picker = entry
        await tick()
        const options = Array.from(body?.querySelectorAll<HTMLElement>('[data-part="plus-chip-options"] [role="menuitemradio"]') ?? [])
        const checked = options.find((option) => option.getAttribute('aria-checked') === 'true')
        ;(checked ?? options[0])?.focus()
    }

    // Leaving the list returns to the menu with the focus on the chip that opened it.
    async function leavePicker(): Promise<void> {
        const uid = picker?.row.uid
        picker = null
        await tick()
        if (uid) chipElement(uid)?.focus()
    }

    function pickOption(index: number): void {
        const entry = picker
        if (!entry) return
        writeChip(entry, String(index))
        announce = language.chatShellTogglesPicked(entry.row.label, entry.row.options[index] ?? '')
        void leavePicker()
    }

    // Escape and Back leave the option list before they close the menu.
    function innerEscape(): boolean {
        if (!picker) return false
        void leavePicker()
        return true
    }

    $effect(() => {
        if (!open || picker === null) return
        return registerBackHandler(backCloseHandler({
            isOpen: () => picker !== null,
            snapshot: () => picker?.row.uid ?? '',
            close: () => { void leavePicker() },
        }))
    })

    function menuKey(event: KeyboardEvent): void {
        if (event.key === 'Tab') {
            const controls = Array.from(opener?.closest('[data-part="chat-composer"]')?.querySelectorAll<HTMLElement>('button,textarea,select,input') ?? [])
            const at = opener ? controls.indexOf(opener) : -1
            const next = controls[at + (event.shiftKey ? -1 : 1)]
            event.preventDefault()
            event.stopPropagation()
            onclose()
            void tick().then(() => next?.focus())
            return
        }
        const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'))
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        let next = at
        if (event.key === 'ArrowDown') next = (at + 1) % items.length
        else if (event.key === 'ArrowUp') next = (at - 1 + items.length) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        items[next]?.focus()
    }

    async function screenshot(): Promise<void> {
        try {
            const { toCanvas } = await import('html-to-image')
            const rows = document.querySelectorAll('.default-chat-screen .risu-chat')
            if (rows.length === 0) throw new Error('No rendered chat rows')
            alertWait(language.alerts.screenshotTaking)
            const canvases: HTMLCanvasElement[] = []
            for (const row of rows) {
                canvases.push(await toCanvas(row as HTMLElement))
                alertWait(`${language.alerts.screenshotTaking} ${canvases.length}/${rows.length}`)
            }
            canvases.reverse()
            alertWait(language.alerts.screenshotMerging)
            const merged = document.createElement('canvas')
            merged.width = Math.max(1, ...canvases.map((canvas) => canvas.width))
            merged.height = Math.max(1, canvases.reduce((height, canvas) => height + canvas.height, 0))
            const context = merged.getContext('2d')
            if (!context) throw new Error('Canvas unavailable')
            context.fillStyle = getComputedStyle(document.querySelector('.default-chat-screen') ?? document.body).backgroundColor
            context.fillRect(0, 0, merged.width, merged.height)
            let y = 0
            for (const canvas of canvases) { context.drawImage(canvas, 0, y); y += canvas.height; canvas.remove() }
            await downloadFile(`chat-${v4()}.png`, Buffer.from(merged.toDataURL('image/png').split(',').at(-1) ?? '', 'base64'))
            merged.remove()
            alertNormal(downloadNotice(language.screenshotSaved))
        } catch (error) {
            console.error(error)
            alertError(language.errors.screenshotFailed)
        }
    }
</script>

{#snippet togglesItem(initial: boolean)}
    <button data-part="chat-sheet-item" data-kind="button" data-item="toggles" role="menuitem" data-sheet-initial={initial ? '' : undefined} onclick={() => { if (ontoggles) activate(() => ontoggles()) }}><span>{language.chatShellTogglesTitle}</span><span data-part="chat-sheet-item-value">{open ? togglesSummary?.() ?? '' : ''}</span></button>
{/snippet}

<ShellSheet {open} kind="menu" mode={typeof window !== 'undefined' && window.innerWidth >= 900 ? 'wide-menu' : chipsLead ? 'tall' : 'bottom'} label={language.chatShellMoreActions} {opener} {background} {onclose} innerescape={innerEscape}>
    <div data-part="chat-sheet-body" role="none" onkeydown={menuKey} bind:this={body}>
        {#if picker}
            <div data-part="plus-chip-options" role="group" aria-label={language.chatShellTogglesPickTitle(picker.row.label)}>
                <p data-part="plus-chip-options-head">{picker.row.label}</p>
                {#each picker.row.options as option, index (index)}
                    {@const checked = index === selectedIndex(chipValue(picker), picker.row.options)}
                    <button data-part="chat-sheet-item" data-kind="button" role="menuitemradio" aria-checked={checked} onclick={() => pickOption(index)}><span>{option}</span>{#if checked}<span aria-hidden="true">✓</span>{/if}</button>
                {/each}
            </div>
        {:else}
        {#if chipsLead}
            {@render togglesItem(true)}
            <div data-part="plus-chips" role="group" aria-label={language.chatShellTogglesChipsHead}>
                <p data-part="plus-chips-head" aria-hidden="true">{language.chatShellTogglesChipsHead}</p>
                <div data-part="plus-chip-row">
                    {#each shownChips as entry (entry.row.uid)}
                        {#if entry.row.kind === 'check'}
                            {@const on = isOn('check', chipValue(entry))}
                            <button data-part="plus-chip" data-kind="check" data-uid={entry.row.uid} data-key={entry.row.key} data-on={on} role="menuitemcheckbox" aria-checked={on} aria-label={on ? language.chatShellTogglesOnA11y(entry.row.label) : language.chatShellTogglesOffA11y(entry.row.label)} onclick={() => flipChip(entry)}><span data-part="plus-chip-mark" aria-hidden="true">{#if on}✓{/if}</span><span data-part="plus-chip-label">{entry.row.label}</span></button>
                        {:else if entry.row.kind === 'select'}
                            <button data-part="plus-chip" data-kind="select" data-uid={entry.row.uid} data-key={entry.row.key} role="menuitem" aria-haspopup="menu" onclick={() => { void openPicker(entry) }}><span data-part="plus-chip-label">{entry.row.label}: {entry.row.options[selectedIndex(chipValue(entry), entry.row.options)] ?? ''}</span><span aria-hidden="true">▾</span></button>
                        {:else}
                            <button data-part="plus-chip" data-kind={entry.row.kind} data-uid={entry.row.uid} data-key={entry.row.key} role="menuitem" aria-haspopup="dialog" onclick={() => { if (ontoggles) activate(() => ontoggles({ s: entry.ref.s, k: entry.ref.k })) }}><span data-part="plus-chip-label">{entry.row.label}</span><span aria-hidden="true">✎</span></button>
                        {/if}
                    {/each}
                    {#if chipRows.length > MAX_CHIPS}
                        <button data-part="plus-chip-more" role="menuitem" onclick={() => { if (ontoggles) activate(() => ontoggles()) }}><span data-part="plus-chip-label">{language.chatShellTogglesMore}</span><span aria-hidden="true">›</span></button>
                    {/if}
                </div>
            </div>
        {/if}
        <button data-part="chat-sheet-item" data-kind="button" role="menuitem" data-sheet-initial={chipsLead ? undefined : ''} disabled={!canContinue()} onclick={() => { if (canContinue()) activate(() => { void sendContinue(source) }) }}>{language.continueResponse}</button>
        {#if character && canChatSpeak(character, (id) => findCharacterbyId(id))}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(stopTTS)}>{language.ttsStop}</button>
        {/if}
        {#if DBState.db.useChatSticker && character?.type !== 'group'}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(onstickers)}>{language.chatShellStickers}</button>
        {/if}
        {#if DBState.db.showMenuChatList}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(onchatlist)}>{language.chatList}</button>
        {/if}
        {#if DBState.db.enableRisuaiProTools}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(() => { easyPanelStore.open = !easyPanelStore.open })}>{language.easyPanel}</button>
        {/if}
        {#each additionalChatMenu as menu (menu.id)}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(menu.callback)}><PluginDefinedIcon ico={menu} />{menu.name}</button>
        {/each}
        {#if DBState.db.showMenuHypaMemoryModal && ((DBState.db.supaModelType !== 'none' && DBState.db.hypav2) || DBState.db.hypaV3)}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(() => {
                if (DBState.db.hypav2 && chat) {
                    chat.hypaV2Data ??= { lastMainChunkID: 0, mainChunks: [], chunks: [] }
                    showHypaV2Alert()
                } else if (DBState.db.hypaV3) hypaV3ModalOpen.set(true)
            })}>{DBState.db.hypav2 ? language.hypaMemoryV2Modal : language.hypaMemoryV3Modal}</button>
        {/if}
        <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(() => { void screenshot() })}>{language.screenshot}</button>
        {#if DBState.db.showMenuChatList}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(() => { if (chat) chat.modules ??= []; onmodules() })}>{language.modules}</button>
        {/if}
        {#if DBState.db.sideMenuRerollButton}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(() => { void reroll(source) })}>{language.reroll}</button>
        {/if}
        {#if utilityVisible($pageStorageModeStore)}
            <button data-part="chat-sheet-item" data-kind="button" role="menuitem" onclick={() => activate(() => { selectedCharID.set(-1); utilityOpen.set(true) })}>{language.chatShellUtility}</button>
        {/if}
        {#if ontoggles && !chipsLead}
            {@render togglesItem(false)}
        {/if}
        {/if}
        <p role="status" aria-live="polite" data-part="plus-live">{announce}</p>
    </div>
</ShellSheet>

<style>
    [data-part="chat-sheet-body"] { display: flex; flex-direction: column; }
    [data-part="chat-sheet-body"] button { min-height: var(--size-touch); text-align: left; padding: var(--space-7) var(--space-10); color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="chat-sheet-body"] button:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="chat-sheet-body"] button:disabled { opacity: var(--opacity-half); }
    [data-part="chat-sheet-body"] button[data-item="toggles"] { display: flex; align-items: center; justify-content: space-between; gap: var(--space-7); width: 100%; }
    [data-part="chat-sheet-item-value"] { color: var(--nexus-text-secondary); font-size: var(--font-size-sm); }
    [data-part="plus-chips"] { padding: var(--space-7) var(--space-5) var(--space-5); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="plus-chips-head"], [data-part="plus-chip-options-head"] { margin: 0; padding: 0 var(--space-3) var(--space-5); font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    [data-part="plus-chip-options-head"] { padding: var(--space-7) var(--space-10) var(--space-5); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="plus-chip-row"] { display: flex; flex-wrap: wrap; gap: var(--space-5); }
    [data-part="chat-sheet-body"] button[data-part="plus-chip"], [data-part="chat-sheet-body"] button[data-part="plus-chip-more"] { display: inline-flex; align-items: center; gap: var(--space-5); width: auto; max-width: 100%; padding: 0 var(--space-10); border: 1px solid var(--nexus-edge-strong); border-radius: var(--radius-pill); font-size: var(--font-size-sm); }
    [data-part="chat-sheet-body"] button[data-part="plus-chip"][data-on="true"] { border-color: var(--nexus-accent); background: var(--color-accent-tint-strong); }
    [data-part="plus-chip-mark"] { display: inline-flex; width: var(--size-7); justify-content: center; color: var(--nexus-accent); }
    [data-part="plus-chip-mark"]:empty { display: none; }
    [data-part="plus-chip-label"] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: var(--size-rel-18); }
    [data-part="chat-sheet-body"] button[role="menuitemradio"] { display: flex; align-items: center; justify-content: space-between; gap: var(--space-7); width: 100%; }
    [data-part="plus-live"] { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>

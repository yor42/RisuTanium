<script lang="ts">
    import { tick } from 'svelte'
    import { v4 } from 'uuid'
    import { DBState, selIdState, selectedCharID, additionalChatMenu, easyPanelStore, hypaV3ModalOpen } from '../../ts/stores.svelte'
    import { pageStorageModeStore } from '../../ts/storage/pageStorageMode'
    import { utilityOpen, utilityVisible } from '../Utility/utilityGate'
    import { language } from '../../lang'
    import { sendContinue, reroll, type ComposerActionsSource } from '../../ts/process/composerActions.svelte'
    import { stopTTS } from '../../ts/process/tts'
    import { canChatSpeak } from '../../ts/process/ttsModes'
    import { findCharacterbyId } from '../../ts/util'
    import { showHypaV2Alert, alertWait, alertNormal, alertError } from '../../ts/alert'
    import { downloadNotice } from '../../ts/exportNotice'
    import { downloadFile } from '../../ts/globalApi.svelte'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
    import ShellSheet from './ShellSheet.svelte'

    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        onclose: () => void
        onstickers: () => void
        onchatlist: () => void
        onmodules: () => void
    }
    let { open, opener, background, onclose, onstickers, onchatlist, onmodules }: Props = $props()
    let character = $derived(DBState.db.characters[selIdState.selId])
    let chat = $derived(character?.chats?.[character.chatPage])
    const source: ComposerActionsSource = { closeMenu: onclose }

    function canContinue(): boolean {
        const messages = chat?.message ?? []
        return messages.length >= 2 && messages[messages.length - 1]?.role === 'char'
    }

    function activate(action: () => void): void {
        action()
        onclose()
    }

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

<ShellSheet {open} kind="menu" mode={typeof window !== 'undefined' && window.innerWidth >= 900 ? 'wide-menu' : 'bottom'} label={language.chatShellMoreActions} {opener} {background} {onclose}>
    <div data-part="chat-sheet-body" role="none" onkeydown={menuKey}>
        <button data-part="chat-sheet-item" data-kind="button" role="menuitem" data-sheet-initial disabled={!canContinue()} onclick={() => { if (canContinue()) activate(() => { void sendContinue(source) }) }}>{language.continueResponse}</button>
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
    </div>
</ShellSheet>

<style>
    [data-part="chat-sheet-body"] { display: flex; flex-direction: column; }
    [data-part="chat-sheet-body"] button { min-height: var(--size-touch); text-align: left; padding: var(--space-7) var(--space-10); color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="chat-sheet-body"] button:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="chat-sheet-body"] button:disabled { opacity: var(--opacity-half); }
</style>

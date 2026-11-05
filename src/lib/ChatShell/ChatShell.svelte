<script lang="ts">
    import { onMount } from 'svelte'
    import { DBState, selIdState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import type ShellHeaderComponent from './ShellHeader.svelte'
    import type ShellComposerComponent from './ShellComposer.svelte'
    import type PersonaSheetComponent from './PersonaSheet.svelte'
    import type PlusSheetComponent from './PlusSheet.svelte'
    import type ShellNoticesComponent from './ShellNotices.svelte'
    import type ShellFloatingButtonsComponent from './ShellFloatingButtons.svelte'

    interface Props {
        openChatList?: boolean
        openModuleList?: boolean
    }
    let { openChatList = $bindable(false), openModuleList = $bindable(false) }: Props = $props()

    let ShellHeader: typeof ShellHeaderComponent | null = $state(null)
    let ShellComposer: typeof ShellComposerComponent | null = $state(null)
    let PersonaSheet: typeof PersonaSheetComponent | null = $state(null)
    let PlusSheet: typeof PlusSheetComponent | null = $state(null)
    let ShellNotices: typeof ShellNoticesComponent | null = $state(null)
    let ShellFloatingButtons: typeof ShellFloatingButtonsComponent | null = $state(null)
    let surface = $state<{ hidden: boolean; closeEpoch: number } | null>(null)
    let surfaceHidden = $state(false)
    let busy = $state(false)

    let character = $derived(DBState.db.characters[selIdState.selId])
    let chat = $derived(character?.chats?.[character.chatPage])
    let headerHidden = $state(false)
    let hardwareKeyboardSeen = $state(false)
    let personaOpen = $state(false)
    let plusOpen = $state(false)
    let stickersOpen = $state(false)
    let opener = $state<HTMLElement | null>(null)
    let header = $state<HTMLElement>()
    let list = $state<HTMLElement>()
    let composer = $state<HTMLElement>()
    let lastScrollTop = 0
    let olderDistance = 0
    let previousBusy = false
    let seenCloseEpoch = 0

    $effect(() => {
        if (!surface) return
        surfaceHidden = surface.hidden
        const epoch = surface.closeEpoch
        if (epoch !== seenCloseEpoch) {
            seenCloseEpoch = epoch
            plusOpen = false
            stickersOpen = false
        }
    })

    onMount(() => {
        // The lightweight branch remains mountable while a chat fixture has no message list.
        if (!chat?.message || character?.type !== 'character') return
        let live = true
        let unsubscribe = () => {}
        void Promise.all([
            import('./ShellHeader.svelte'),
            import('./ShellComposer.svelte'),
            import('./PersonaSheet.svelte'),
            import('./PlusSheet.svelte'),
            import('./ShellNotices.svelte'),
            import('./ShellFloatingButtons.svelte'),
            import('../ChatScreens/chatSurface.svelte'),
            import('../../ts/process/index.svelte'),
        ]).then(([headerModule, composerModule, personaModule, plusModule, noticesModule, floatingModule, surfaceModule, processModule]) => {
            if (!live) return
            ShellHeader = headerModule.default
            ShellComposer = composerModule.default
            PersonaSheet = personaModule.default
            PlusSheet = plusModule.default
            ShellNotices = noticesModule.default
            ShellFloatingButtons = floatingModule.default
            surface = surfaceModule.chatSurface
            unsubscribe = processModule.doingChat.subscribe((value) => {
                busy = value
                if (previousBusy && !value) headerHidden = false
                previousBusy = value
            })
        })
        return () => { live = false; unsubscribe() }
    })

    function scroll(event: Event): void {
        const target = event.currentTarget as HTMLElement
        const movement = lastScrollTop - target.scrollTop
        lastScrollTop = target.scrollTop
        if (movement > 0) {
            olderDistance += movement
            if (olderDistance >= 24 && !hardwareKeyboardSeen) headerHidden = true
        } else if (movement < 0) {
            olderDistance = 0
            headerHidden = false
        }
    }

    function openPersona(element: HTMLElement): void {
        if (surfaceHidden) return
        opener = element
        personaOpen = true
    }

    function openPlus(element: HTMLElement): void {
        if (surfaceHidden) return
        opener = element
        plusOpen = true
    }

</script>

<div class="default-chat-screen" data-part="chat-shell" data-part-critical data-testid="chat-shell-stub">
    <div bind:this={header} data-part="chat-shell-header-host">
        {#if ShellHeader}<ShellHeader name={character?.name ?? ''} hidden={headerHidden} {hardwareKeyboardSeen} onpersona={openPersona} />{/if}
    </div>
    <main bind:this={list} data-part="chat-list-placeholder" aria-label={language.chatShellMessages} onscroll={scroll}>
        {#if ShellNotices && character?.type === 'character'}<ShellNotices />{/if}
    </main>
    {#if ShellFloatingButtons}<ShellFloatingButtons visible={false} onclick={() => list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })} />{/if}
    <div bind:this={composer} data-part="chat-shell-composer-host">
        {#if ShellComposer}<ShellComposer onplus={openPlus} onpersona={openPersona} bind:stickersOpen onhardwarechange={(seen) => { hardwareKeyboardSeen = seen; if (seen) headerHidden = false }} />{/if}
    </div>
    {#if PersonaSheet}<PersonaSheet open={personaOpen} {opener} background={[header, list, composer].filter((element): element is HTMLElement => !!element)} onclose={() => personaOpen = false} />{/if}
    {#if PlusSheet}<PlusSheet open={plusOpen} {opener} background={[header, list, composer].filter((element): element is HTMLElement => !!element)} onclose={() => plusOpen = false} onstickers={() => stickersOpen = !stickersOpen} onchatlist={() => openChatList = true} onmodules={() => openModuleList = true} />{/if}
</div>

<style>
    [data-part="chat-shell"] { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; background: var(--color-bgcolor); color: var(--color-textcolor); }
    [data-part="chat-shell-header-host"], [data-part="chat-shell-composer-host"] { flex: none; }
    [data-part="chat-list-placeholder"] { flex: 1; min-height: 0; overflow-y: auto; }
</style>

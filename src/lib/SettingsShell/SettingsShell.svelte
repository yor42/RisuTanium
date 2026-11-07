<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { get } from 'svelte/store'
    import { language } from '../../lang'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
    import { isReturnToChat } from '../Setting/settingsRoute'
    import {
        isPhoneWidth, readLastPage, resolveOpenIndex, setShellBackHandler, settingsShellBackStep, writeLastPage,
    } from '../../ts/settingsShell/settingsNavigation'
    import { restoreOpenerFocus, settingsOrigin } from '../../ts/settingsShell/settingsOrigin'
    import { firstIndexOf, pageEntry, pageForIndex, settingsLabel } from '../../ts/settingsShell/settingsPages'
    import SettingsShellHeader from './SettingsShellHeader.svelte'
    import SettingsShellIndex from './SettingsShellIndex.svelte'
    import SettingsShellPage from './SettingsShellPage.svelte'

    let innerWidth = $state(window.innerWidth)
    const phone = $derived(isPhoneWidth(innerWidth))
    const located = $derived(pageForIndex($SettingsMenuIndex))
    const origin = settingsOrigin()
    // The scroll position of each view is kept while Settings stays open and dropped with the shell on close.
    const scrollMemory = new Map<number, number>()

    let indexPane = $state<ReturnType<typeof SettingsShellIndex>>()
    let pagePane = $state<ReturnType<typeof SettingsShellPage>>()

    // While Settings is open the wide layout never shows index -1: it applies the stored last page, or Models.
    // Gated on the open state so a close (which resets the index) is not undone by this effect.
    $effect(() => {
        if (!$settingsOpen) return
        const index = $SettingsMenuIndex
        const resolved = resolveOpenIndex({ index, width: innerWidth, stored: readLastPage() })
        if (resolved !== index) SettingsMenuIndex.set(resolved)
    })

    // Only an index that a page hosts is recorded, so the phone index (-1) never erases the stored page.
    $effect(() => {
        if (!$settingsOpen) return
        const shown = pageForIndex($SettingsMenuIndex)
        if (shown) writeLastPage(shown.page)
    })

    // One Back handler on the stack while Settings is open. Escape runs this same instance, so the focused
    // field is blurred and effects are flushed before the close step.
    $effect(() => {
        if (!$settingsOpen) return
        const handler = backCloseHandler({
            isOpen: () => get(settingsOpen),
            snapshot: () => `${get(settingsOpen)}|${get(SettingsMenuIndex)}`,
            close: settingsShellBackStep,
        })
        const unregister = registerBackHandler(handler)
        setShellBackHandler(handler)
        return () => {
            unregister()
            setShellBackHandler(null)
        }
    })

    // Focus: on open it goes to the selected entry (wide), the first entry (phone index) or the page heading
    // (phone page); a phone drill-in lands on the heading and Back to the index returns to the opened entry.
    let previousIndex: number | null = null
    $effect(() => {
        const index = $SettingsMenuIndex
        const isPhone = phone
        const open = $settingsOpen
        const before = previousIndex
        previousIndex = index
        if (!open) return
        untrack(() => {
            void tick().then(() => {
                const now = get(SettingsMenuIndex)
                if (before === null) {
                    if (isPhone && now !== -1) pagePane?.focusHeading()
                    else indexPane?.focusSelected()
                } else if (isPhone && before !== -1 && now === -1) {
                    const opened = pageForIndex(before)
                    if (opened) indexPane?.focusPage(opened.page)
                    else indexPane?.focusSelected()
                } else if (isPhone && before === -1 && now !== -1) {
                    pagePane?.focusHeading()
                }
            })
        })
    })

    // After the close has flushed, focus goes back to what opened Settings; the helper decides where.
    onDestroy(() => {
        if (get(settingsOpen)) return
        void tick().then(() => {
            if (!get(settingsOpen)) restoreOpenerFocus()
        })
    })

    const backLabel = $derived(
        phone && $SettingsMenuIndex !== -1 && !isReturnToChat() ? language.settingsShellMenu
            : origin.kind === 'chat' ? language.settingsShellBackToChat(origin.name)
            : language.settingsShellBack
    )
    const title = $derived(phone && located ? settingsLabel(pageEntry(located.page).labelKey) : language.settingsShellTitle)
    const showIndex = $derived(!phone || $SettingsMenuIndex === -1)
    const showPage = $derived(!phone || $SettingsMenuIndex !== -1)
    const indexWidth = $derived(innerWidth >= 1024 ? '280px' : '240px')
</script>

<svelte:window bind:innerWidth />

<div class="h-full w-full flex flex-col bg-bgcolor text-textcolor rs-setting-cont" data-part="settings-shell">
    <SettingsShellHeader {backLabel} {title} {phone} onback={settingsShellBackStep} />
    <div class="flex grow min-h-0">
        {#if showIndex}
            <div class="shrink-0 h-full" style:width={phone ? '100%' : indexWidth}>
                <SettingsShellIndex
                    bind:this={indexPane}
                    selected={phone ? null : located?.page ?? null}
                    onselect={(page) => SettingsMenuIndex.set(firstIndexOf(page))}
                />
            </div>
        {/if}
        {#if showPage}
            <SettingsShellPage bind:this={pagePane} index={$SettingsMenuIndex} {phone} {scrollMemory} />
        {/if}
    </div>
</div>

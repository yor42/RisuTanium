<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { SparkleIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { additionalSettingsMenu, DBState, easyPanelStore, SettingsMenuIndex } from '../../ts/stores.svelte'
    import { arrivalInFlight } from '../../ts/settingsShell/settingsArrival'
    import { pageEntry, pageForIndex, settingsLabel } from '../../ts/settingsShell/settingsPages'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
    import UserSettings from '../Setting/Pages/UserSettings.svelte'
    import BotSettings from '../Setting/Pages/BotSettings.svelte'
    import OtherBotSettings from '../Setting/Pages/OtherBotSettings.svelte'
    import PluginSettings from '../Setting/Pages/PluginSettings.svelte'
    import AdvancedSettings from '../Setting/Pages/AdvancedSettings.svelte'
    import LanguageSettings from '../Setting/Pages/LanguageSettings.svelte'
    import AccessibilitySettings from '../Setting/Pages/AccessibilitySettings.svelte'
    import PersonaSettings from '../Setting/Pages/PersonaSettings.svelte'
    import PromptSettings from '../Setting/Pages/PromptSettings.svelte'
    import ModuleSettings from '../Setting/Pages/Module/ModuleSettings.svelte'
    import HotkeySettings from '../Setting/Pages/HotkeySettings.svelte'
    import DisplayShellPage from './DisplayShellPage.svelte'
    import ModeVisibilityGroup from './ModeVisibilityGroup.svelte'
    import ModeVisibilityConfirm from './ModeVisibilityConfirm.svelte'
    import { showAllModes, type HomeMode } from '../../ts/storage/homeModes'
    import type { PatternAnswer } from '../Nexus/pattern/patternWarning'

    interface Props {
        /** The legacy index of the view on screen; the shell passes only indexes a page hosts. */
        index: number
        /** On a phone the page replaces the index and slides in from the right. */
        phone: boolean
        /** Scroll position per view, owned by the shell so it outlives this page when a phone returns to the index. */
        scrollMemory: Map<number, number>
    }
    let { index, phone, scrollMemory }: Props = $props()

    let scroller = $state<HTMLElement>()
    let heading = $state<HTMLElement>()
    let shownIndex: number | null = null

    // The view the markup renders. Deliberate side effect: the scroll position of the view being left is
    // remembered while this is computed, because the markup reads it before it swaps the view in both
    // schedulers, whereas an `$effect.pre` runs after the block update under the async scheduler, when the
    // swapped content has already clamped the column's position. The memory stores the index being left.
    // This holds while: `scroller` and `scrollTop` are read untracked, so the capture adds no dependency;
    // every DOM-affecting read of the index, including the chip `class:` reads and the page lookup, goes
    // through this derived; and a single batch computes it once per update (a markup `await`, an async
    // derived or `fork()` here would need the capture revisited).
    const current = $derived.by(() => {
        const next = index
        if (shownIndex !== null && shownIndex !== next) {
            const leaving = shownIndex
            untrack(() => {
                if (scroller) scrollMemory.set(leaving, scroller.scrollTop)
            })
        }
        shownIndex = next
        return next
    })

    const located = $derived(pageForIndex(current))
    const page = $derived(located ? pageEntry(located.page) : null)

    let headBlock = $state<HTMLElement>()
    let showAllAsk = $state<{ trigger: HTMLElement, hidden: HomeMode[] } | null>(null)

    function answerShowAll(answer: PatternAnswer): void {
        if (answer === 'confirm') showAllModes(DBState.db)
        showAllAsk = null
    }

    // A phone leaves a view by destroying this page, so the position of the view on screen is saved on teardown too.
    onDestroy(() => {
        if (scroller && shownIndex !== null) scrollMemory.set(shownIndex, scroller.scrollTop)
    })

    // A search arrival lands at the top and scrolls to its row itself, so the remembered position yields to it.
    $effect(() => {
        const target = current
        const column = scroller
        if (!column) return
        if (arrivalInFlight(target)) return
        void tick().then(() => { column.scrollTop = scrollMemory.get(target) ?? 0 })
    })

    /** Moves focus to the page heading, where a phone drill-in lands. */
    export function focusHeading(): void {
        heading?.focus()
    }

    let displayPage = $state<ReturnType<typeof DisplayShellPage>>()

    /** Opens whatever hides the row and returns its element; null when the shown view has no such row. */
    export async function reveal(rowId: string): Promise<HTMLElement | null> {
        return displayPage ? displayPage.reveal(rowId) : null
    }
</script>

<main class="flex flex-col grow min-w-0 min-h-0 bg-bgcolor text-textcolor" class:settings-shell-drill={phone} data-part="settings-page">
    {#if page}
        <div class="px-4 pt-4 shrink-0" bind:this={headBlock}>
            <h2 class="text-xl font-semibold outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-textcolor2" tabindex="-1" bind:this={heading} data-part="settings-page-heading">{settingsLabel(page.labelKey)}</h2>
            {#if page.views.length > 1}
                <div class="flex flex-wrap gap-2 mt-3" role="group" aria-label={language.settingsShellViews}>
                    {#each page.views as view (view.id)}
                        <button
                            type="button"
                            class="px-3 min-h-11 rounded-md bg-darkbutton hover:text-textcolor"
                            class:bg-selected={view.legacyIndex === current}
                            class:text-textcolor={view.legacyIndex === current}
                            class:text-textcolor2={view.legacyIndex !== current}
                            data-part="settings-view-chip"
                            data-view={view.id}
                            aria-pressed={view.legacyIndex === current}
                            onclick={() => SettingsMenuIndex.set(view.legacyIndex)}
                        >{settingsLabel(view.labelKey)}</button>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
    <div class="grow min-h-0 overflow-y-auto px-4 py-4" bind:this={scroller} data-part="settings-page-scroll">
        {#key current}
            <div class="settings-shell-view flex flex-col" data-part="settings-view">
                {#if current === 0}
                    <UserSettings />
                {:else if current === 1}
                    <BotSettings goPromptTemplate={() => { SettingsMenuIndex.set(13) }} />
                {:else if current === 2}
                    <OtherBotSettings />
                {:else if current === 3}
                    <ModeVisibilityGroup onaskshowall={(trigger, hidden) => { showAllAsk = { trigger, hidden } }} />
                    <DisplayShellPage bind:this={displayPage} {phone} />
                {:else if current === 4}
                    <PluginSettings />
                {:else if current === 6}
                    <AdvancedSettings />
                {:else if current === 10}
                    <LanguageSettings />
                {:else if current === 11}
                    <AccessibilitySettings />
                {:else if current === 12}
                    <PersonaSettings />
                {:else if current === 13}
                    <PromptSettings onGoBack={() => { SettingsMenuIndex.set(1) }} />
                {:else if current === 14}
                    <ModuleSettings />
                {:else if current === 15}
                    <HotkeySettings />
                {/if}
            </div>
        {/key}
        {#if located?.page === 'extensions' && additionalSettingsMenu.length > 0}
            <div class="flex flex-col gap-2 mt-6" role="group" aria-label={language.settingsShellPluginRows} data-part="settings-plugin-rows">
                {#each additionalSettingsMenu as menu (menu.id)}
                    <button type="button" class="flex gap-2 items-center min-h-11 hover:text-textcolor text-textcolor2" data-part="settings-plugin-row" onclick={() => { menu.callback() }}>
                        <PluginDefinedIcon ico={menu} />
                        <span>{menu.name}</span>
                    </button>
                {/each}
            </div>
        {/if}
        {#if located?.page === 'advanced' && DBState.db.enableRisuaiProTools}
            <div class="flex flex-col gap-2 mt-6">
                <button type="button" class="flex gap-2 items-center min-h-11 hover:text-textcolor text-textcolor2" data-part="settings-easy-panel" onclick={() => { easyPanelStore.open = true }}>
                    <SparkleIcon aria-hidden="true" />
                    <span>{language.easyPanel}</span>
                </button>
            </div>
        {/if}
    </div>
    {#if showAllAsk}
        <ModeVisibilityConfirm hidden={showAllAsk.hidden} trigger={showAllAsk.trigger} background={[headBlock, scroller].filter((el): el is HTMLElement => el !== undefined)} onanswer={answerShowAll} />
    {/if}
</main>

<style>
    /* Page change fades in with an 8 px upward move; only transform and opacity animate. */
    .settings-shell-view {
        animation: settings-shell-in var(--chat-dur-base, 200ms) var(--chat-ease-out, ease-out);
    }
    @keyframes settings-shell-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: none; }
    }
    .settings-shell-drill {
        animation: settings-shell-drill-in var(--chat-dur-base, 200ms) var(--chat-ease-out, ease-out);
    }
    @keyframes settings-shell-drill-in {
        from { transform: translateX(100%); }
        to { transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
        .settings-shell-view, .settings-shell-drill {
            animation: settings-shell-fade 120ms linear;
        }
    }
    @keyframes settings-shell-fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }
</style>

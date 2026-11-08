<script lang="ts">
    import { onDestroy, tick } from 'svelte'
    import { SparkleIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { additionalSettingsMenu, DBState, easyPanelStore, SettingsMenuIndex } from '../../ts/stores.svelte'
    import { pageEntry, pageForIndex, settingsLabel } from '../../ts/settingsShell/settingsPages'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
    import UserSettings from '../Setting/Pages/UserSettings.svelte'
    import BotSettings from '../Setting/Pages/BotSettings.svelte'
    import OtherBotSettings from '../Setting/Pages/OtherBotSettings.svelte'
    import DisplaySettings from '../Setting/Pages/DisplaySettings.svelte'
    import PluginSettings from '../Setting/Pages/PluginSettings.svelte'
    import AdvancedSettings from '../Setting/Pages/AdvancedSettings.svelte'
    import LanguageSettings from '../Setting/Pages/LanguageSettings.svelte'
    import AccessibilitySettings from '../Setting/Pages/AccessibilitySettings.svelte'
    import PersonaSettings from '../Setting/Pages/PersonaSettings.svelte'
    import PromptSettings from '../Setting/Pages/PromptSettings.svelte'
    import ModuleSettings from '../Setting/Pages/Module/ModuleSettings.svelte'
    import HotkeySettings from '../Setting/Pages/HotkeySettings.svelte'
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

    const located = $derived(pageForIndex(index))
    const page = $derived(located ? pageEntry(located.page) : null)

    let scroller = $state<HTMLElement>()
    let heading = $state<HTMLElement>()
    let shownIndex: number | null = null
    let headBlock = $state<HTMLElement>()
    let showAllAsk = $state<{ trigger: HTMLElement, hidden: HomeMode[] } | null>(null)

    function answerShowAll(answer: PatternAnswer): void {
        if (answer === 'confirm') showAllModes(DBState.db)
        showAllAsk = null
    }

    // Runs before the DOM swaps views, so the column still holds the position of the view being left.
    $effect.pre(() => {
        const next = index
        if (scroller && shownIndex !== null && shownIndex !== next) scrollMemory.set(shownIndex, scroller.scrollTop)
        shownIndex = next
    })

    // A phone leaves a view by destroying this page, so the position of the view on screen is saved on teardown too.
    onDestroy(() => {
        if (scroller && shownIndex !== null) scrollMemory.set(shownIndex, scroller.scrollTop)
    })

    $effect(() => {
        const target = index
        const column = scroller
        if (!column) return
        void tick().then(() => { column.scrollTop = scrollMemory.get(target) ?? 0 })
    })

    /** Moves focus to the page heading, where a phone drill-in lands. */
    export function focusHeading(): void {
        heading?.focus()
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
                            class:bg-selected={view.legacyIndex === index}
                            class:text-textcolor={view.legacyIndex === index}
                            class:text-textcolor2={view.legacyIndex !== index}
                            data-part="settings-view-chip"
                            data-view={view.id}
                            aria-pressed={view.legacyIndex === index}
                            onclick={() => SettingsMenuIndex.set(view.legacyIndex)}
                        >{settingsLabel(view.labelKey)}</button>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
    <div class="grow min-h-0 overflow-y-auto px-4 py-4" bind:this={scroller} data-part="settings-page-scroll">
        {#key index}
            <div class="settings-shell-view flex flex-col" data-part="settings-view">
                {#if index === 0}
                    <UserSettings />
                {:else if index === 1}
                    <BotSettings goPromptTemplate={() => { SettingsMenuIndex.set(13) }} />
                {:else if index === 2}
                    <OtherBotSettings />
                {:else if index === 3}
                    <ModeVisibilityGroup onaskshowall={(trigger, hidden) => { showAllAsk = { trigger, hidden } }} />
                    <DisplaySettings />
                {:else if index === 4}
                    <PluginSettings />
                {:else if index === 6}
                    <AdvancedSettings />
                {:else if index === 10}
                    <LanguageSettings />
                {:else if index === 11}
                    <AccessibilitySettings />
                {:else if index === 12}
                    <PersonaSettings />
                {:else if index === 13}
                    <PromptSettings onGoBack={() => { SettingsMenuIndex.set(1) }} />
                {:else if index === 14}
                    <ModuleSettings />
                {:else if index === 15}
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

<script lang="ts">
    import {
        CpuIcon, DatabaseIcon, HandIcon, KeyboardIcon, LanguagesIcon, MessageSquareIcon, PaletteIcon, PuzzleIcon,
        SlidersHorizontalIcon, UserRoundIcon,
    } from '@lucide/svelte'
    import { language } from '../../lang'
    import SettingsLegalLinks from '../Setting/SettingsLegalLinks.svelte'
    import { orderedPages, settingsLabel, type SettingsPageId } from '../../ts/settingsShell/settingsPages'

    interface Props {
        /** The page on screen; null on the phone index, where no entry is selected. */
        selected: SettingsPageId | null
        onselect: (page: SettingsPageId) => void
    }
    let { selected, onselect }: Props = $props()

    // Icons live here, not in the page registry, so the navigation modules stay free of the icon library.
    const ICONS: Record<SettingsPageId, typeof CpuIcon> = {
        models: CpuIcon, features: MessageSquareIcon, display: PaletteIcon, input: HandIcon, language: LanguagesIcon,
        personas: UserRoundIcon, extensions: PuzzleIcon, data: DatabaseIcon, shortcuts: KeyboardIcon, advanced: SlidersHorizontalIcon,
    }

    const pages = orderedPages()
    let entries: HTMLButtonElement[] = []

    function buttons(): HTMLButtonElement[] {
        return entries.filter((entry) => entry !== undefined && entry.isConnected)
    }

    /** Focuses the entry of one page. */
    export function focusPage(page: SettingsPageId): void {
        entries[pages.findIndex((entry) => entry.id === page)]?.focus()
    }

    /** Focuses the selected entry, or the first one when none is selected. */
    export function focusSelected(): void {
        if (selected !== null) focusPage(selected)
        else buttons()[0]?.focus()
    }

    function moveTo(target: number): void {
        const list = buttons()
        list[Math.max(0, Math.min(list.length - 1, target))]?.focus()
    }

    function onkeydown(event: KeyboardEvent, at: number): void {
        if (event.key === 'ArrowDown') moveTo(at + 1)
        else if (event.key === 'ArrowUp') moveTo(at - 1)
        else if (event.key === 'Home') moveTo(0)
        else if (event.key === 'End') moveTo(pages.length - 1)
        else if (event.key === 'Enter') onselect(pages[at].id)
        else return
        event.preventDefault()
    }
</script>

<nav class="flex flex-col h-full min-h-0 overflow-y-auto bg-darkbg text-textcolor" aria-label={language.settingsShellMenu} data-part="settings-index">
    <ul class="flex flex-col gap-1 p-2 grow">
        {#each pages as page, at (page.id)}
            {@const Icon = ICONS[page.id]}
            <li>
                <button
                    type="button"
                    bind:this={entries[at]}
                    class="flex w-full items-center gap-3 px-3 min-h-12 rounded-md text-left hover:text-textcolor hover:bg-darkbutton"
                    class:bg-selected={selected === page.id}
                    class:text-textcolor={selected === page.id}
                    class:text-textcolor2={selected !== page.id}
                    data-part="settings-index-entry"
                    data-page={page.id}
                    aria-current={selected === page.id ? 'page' : undefined}
                    onclick={() => onselect(page.id)}
                    onkeydown={(event) => onkeydown(event, at)}
                >
                    <Icon aria-hidden="true" />
                    <span>{settingsLabel(page.labelKey)}</span>
                </button>
            </li>
        {/each}
    </ul>
    <div class="p-2 shrink-0">
        <SettingsLegalLinks />
    </div>
</nav>

<script lang="ts">
    import 'src/lib/Nexus/brand/nexus-mark.css'
    import { MenuIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { MARK_VIEWBOX, markInner } from 'src/lib/Nexus/brand/nexusMark'
    import HomeModeSwitcher from './HomeModeSwitcher.svelte'
    import HomePersonaChip from './HomePersonaChip.svelte'
    import type { HomeBand } from './homeLayout'

    interface Props {
        band: HomeBand
        /** The phone menu button, bound out so the drawer can return focus to it. */
        menuButton?: HTMLElement | null
        drawerOpen?: boolean
        /** The drawer panel's id; referenced by aria-controls only while the drawer is open. */
        drawerId?: string
        onmenu?: () => void
    }

    let { band, menuButton = $bindable(null), drawerOpen = false, drawerId, onmenu }: Props = $props()

    // The brand mark is decorative and static: it carries no status region, unlike the live status
    // mark, so the wordmark beside it is the only text alternative.
    const uid = $props.id()
    const inner = markInner(uid)

    // One DOM order in every band (menu button, brand, switcher, chip); only the grid placement
    // changes. The start inset keeps the brand clear of the sidebar arrow that sits at the top-left
    // corner; the phone has no arrow (the menu button replaces it), so it needs only the edge gap.
    // The switcher and the chip carry their own top margin, which the wrappers cancel.
    const insetClass: Record<HomeBand, string> = {
        phone: 'pl-4',
        mid: 'pl-14',
        wide: 'pl-14',
    }
    const barClass: Record<HomeBand, string> = {
        phone: 'flex flex-col items-start gap-2',
        mid: 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2',
        wide: 'grid grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center gap-x-4',
    }
    const switcherClass: Record<HomeBand, string> = {
        phone: 'w-full *:mt-0!',
        mid: 'col-span-2 row-start-2 flex justify-center *:mt-0!',
        wide: 'flex justify-center *:mt-0!',
    }
    const chipClass: Record<HomeBand, string> = {
        phone: 'max-w-full *:mt-0!',
        mid: 'col-start-2 row-start-1 flex justify-end *:mt-0!',
        wide: 'flex justify-end *:mt-0!',
    }
</script>

{#snippet brand()}
    <div data-part="home-brand" class="flex min-h-11 items-center gap-2 text-textcolor">
        <svg
            class="nexus-mark shrink-0"
            viewBox={MARK_VIEWBOX}
            width="28"
            height="28"
            aria-hidden="true"
            focusable="false"
            data-status="idle"
            data-still=""
        >
            {@html inner}
        </svg>
        <span class="text-lg font-semibold">RisuTanium</span>
    </div>
{/snippet}

<header
    data-part="home-topbar"
    data-layout={band}
    class="w-full {insetClass[band]} pr-4 pt-3 pb-2 {barClass[band]}"
>
    {#if band === 'phone'}
        <div class="flex w-full items-center gap-2">
            <button
                type="button"
                bind:this={menuButton}
                data-part="home-menu-button"
                aria-label={language.menu}
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
                aria-controls={drawerOpen ? drawerId : undefined}
                class="flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-borderc/10 bg-darkbg text-textcolor hover:bg-selected/50"
                onclick={() => onmenu?.()}
            >
                <MenuIcon size={22} />
            </button>
            {@render brand()}
        </div>
    {:else}
        {@render brand()}
    {/if}
    <div class={switcherClass[band]}>
        <HomeModeSwitcher />
    </div>
    <!-- Roleplay content: while Roleplay is the only built mode (BUILT_HOME_MODES) the landing is Roleplay. -->
    <div class={chipClass[band]}>
        <HomePersonaChip />
    </div>
</header>

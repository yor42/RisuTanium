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
    //
    // Centring (MC-1403, MC-1415): the switcher sits on the visible bar's centre in mid and wide
    // only; the phone layout is unchanged.
    // - Wide: the insets are equal and both side tracks are identical, so the auto track is
    //   centred; the chip wrapper's negative end margin equals the inset difference (pr-14 minus
    //   pr-4), which gives the chip back its 16 px right edge without moving the track.
    // - Mid: the switcher row spans both columns, so its box is the content box; the negative start
    //   margin equals the inset difference (pl-14 minus pr-4), which makes that box symmetric
    //   about the bar. From a viewport of 1025 px to about 1068 px with the sidebar docked open the
    //   bar stays on one row and the switcher may drift from the centre (MC-1414). The first track
    //   has a fixed minimum that keeps a clipped wordmark and the chip track has a zero minimum, so
    //   a long name truncates inside the bar and in mid the two tracks sum to the content box.
    // When a language's switcher labels do not fit one row, the fieldset wraps to two rows and each
    // row is centred (MC-1440); the wrapper centres the fieldset box itself.
    // The wordmark truncates rather than covering the switcher when its column is narrow (MC-1404).
    const insetClass: Record<HomeBand, string> = {
        phone: 'pl-4 pr-4',
        mid: 'pl-14 pr-4',
        wide: 'pl-14 pr-14',
    }
    const barClass: Record<HomeBand, string> = {
        phone: 'flex flex-col items-start gap-2',
        mid: 'grid grid-cols-[minmax(5.75rem,1fr)_minmax(0,auto)] items-center gap-x-4 gap-y-2',
        wide: 'grid grid-cols-[minmax(2.75rem,1fr)_auto_minmax(2.75rem,1fr)] items-center gap-x-4',
    }
    const switcherClass: Record<HomeBand, string> = {
        phone: 'w-full *:mt-0!',
        mid: 'col-span-2 row-start-2 -ml-10 flex justify-center *:justify-center *:mt-0!',
        wide: 'flex justify-center *:justify-center *:mt-0!',
    }
    const chipClass: Record<HomeBand, string> = {
        phone: 'max-w-full *:mt-0!',
        mid: 'col-start-2 row-start-1 flex justify-end *:mt-0!',
        wide: 'flex min-w-0 justify-end -mr-10 *:mt-0!',
    }
    // Wordmark sliver rule (MC-1443): the brand cell is an inline-size container in mid and wide. The
    // cell holds the 28 px mark and the 8 px gap, so a cell under 3.75rem (60 px) leaves the wordmark
    // under 24 px. Below that the wordmark text leaves the layout (visually hidden, not display:none,
    // so the brand keeps its text alternative); this only avoids a sliver. The side tracks stay equal
    // so the switcher stays centred, so the chip does not grow into the freed space (MC-1446). The mid
    // track minimum (5.75rem) keeps the wordmark above the threshold, and a clipped "Ris…" stays
    // visible (MC-1436). The phone band is unchanged (MC-1415): no container, no rule.
    const brandClass: Record<HomeBand, string> = {
        phone: 'flex min-h-11 min-w-0 items-center gap-2 text-textcolor',
        mid: '@container flex min-h-11 min-w-0 items-center gap-2 text-textcolor',
        wide: '@container flex min-h-11 min-w-0 items-center gap-2 text-textcolor',
    }
    const wordmarkClass: Record<HomeBand, string> = {
        phone: 'min-w-0 truncate text-lg font-semibold',
        mid: 'min-w-0 truncate text-lg font-semibold @max-[3.75rem]:sr-only',
        wide: 'min-w-0 truncate text-lg font-semibold @max-[3.75rem]:sr-only',
    }
</script>

{#snippet brand()}
    <div data-part="home-brand" class={brandClass[band]}>
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
        <span class={wordmarkClass[band]}>RisuTanium</span>
    </div>
{/snippet}

<header
    data-part="home-topbar"
    data-layout={band}
    class="w-full {insetClass[band]} pt-3 pb-2 {barClass[band]}"
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

<script lang="ts">
    import 'src/lib/Nexus/brand/nexus-mark.css'
    import { MenuIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { ColorSchemeTypeStore } from 'src/ts/gui/surfaceTone'
    import { DBState } from 'src/ts/stores.svelte'
    import { MARK_VIEWBOX, markInner } from 'src/lib/Nexus/brand/nexusMark'
    import HomeModeSwitcher from './HomeModeSwitcher.svelte'
    import HomePersonaChip from './HomePersonaChip.svelte'
    import HomeTasks from './HomeTasks.svelte'
    import SeasonalBrand from 'src/lib/UI/Seasonal/SeasonalBrand.svelte'
    import { WIDE_BAR_MIN, type HomeBand } from './homeLayout'
    import { switcherEntries } from './homeSwitcher'

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
    // mark, so the wordmark beside it is the only text alternative. The seasonal logo (SeasonalBrand)
    // finds the bar, the brand cell and the mark through the data-seasonal-* attributes below; a live
    // status on the mark later hides the seasonal mark again.
    const uid = $props.id()
    const inner = markInner(uid)

    // The phone bar draws the switcher row only when HomeModeSwitcher would list entries; hidden modes stay out of it.
    const hasSwitcher = $derived(switcherEntries({
        visibleModes: DBState.db.visibleModes,
        hideUnusedModes: DBState.db.hideUnusedModes,
    }).length > 0)

    // Lives here, not in HomeTasks: a band change replaces the Tasks instance, and the open dialog must survive it.
    let tasksOpen = $state(false)

    // The bar's own width, not the window's: a docked sidebar makes the bar narrower than the window. It is read only
    // while the band is wide, synchronously on entering and again on every resize of the bar's parent. The parent
    // is observed, never the header: the layout switch changes the header's height, and observing the element that
    // the switch resizes raises a ResizeObserver loop error, and the parent's height does not follow the bar.
    // The header is full width in a parent whose width is set from above, so the bar's width does not depend on
    // the layout and the switch needs no hysteresis. A width of 0 means unmeasured and keeps the band.
    let header: HTMLElement | undefined = $state()
    let barWidth = $state(0)

    // The layout the bar draws: a wide band whose bar is narrower than WIDE_BAR_MIN takes the mid layout, otherwise
    // it is the band. Everything that positions the bar's parts reads the layout; the phone/Tasks node conditionals
    // keep reading the band, so a layout switch changes classes on the same nodes and never re-creates the Tasks
    // button or the open dialog.
    const layout: HomeBand = $derived(band === 'wide' && barWidth > 0 && barWidth < WIDE_BAR_MIN ? 'mid' : band)

    // The chip wrapper's layout: outside the phone band the layout is always mid or wide.
    const chipLayout: 'mid' | 'wide' = $derived(layout === 'mid' ? 'mid' : 'wide')

    $effect(() => {
        if (band !== 'wide' || !header) {
            return
        }
        const bar = header
        const measure = (): void => {
            barWidth = bar.clientWidth
        }
        measure()
        const parent = bar.parentElement
        if (!parent || typeof ResizeObserver === 'undefined') {
            return
        }
        const observer = new ResizeObserver(measure)
        observer.observe(parent)
        return () => observer.disconnect()
    })

    // The phone order is menu button, brand, Tasks, icon chip (one row), then the switcher row when it has entries,
    // equal to its visual order. Mid (including a narrow wide bar) puts brand, the chip cluster (Tasks and the chip),
    // then the switcher row when it has entries; wide puts brand, switcher, then the chip cluster. Every layout's DOM
    // order matches its visual order, and the chip cluster node stays in place across a mid/wide layout switch so an
    // open Tasks dialog and its focused control are never recreated or moved.
    // The start inset keeps the brand clear of the sidebar arrow that sits at the top-left corner; the phone has
    // no arrow (the menu button replaces it), so it needs only the edge gap.
    // The switcher and the chip carry their own top margin, which the wrappers cancel.
    //
    // Centring (MC-1403, MC-1415): the switcher sits on the visible bar's centre in mid and wide
    // only; the phone layout is unchanged.
    // - Wide: the insets are equal and both side tracks are identical, so the auto track is
    //   centred; the chip wrapper's negative end margin equals the inset difference (pr-14 minus
    //   pr-4), which gives the chip back its 16 px right edge without moving the track. Wide holds
    //   only while the bar is at least WIDE_BAR_MIN wide; a narrower bar takes the mid layout.
    // - Mid: the switcher row spans both columns, so its box is the content box; the negative start
    //   margin equals the inset difference (pl-14 minus pr-4), which makes that box symmetric
    //   about the bar. From a viewport of 1025 px to about 1068 px with the sidebar docked open the
    //   bar stays on one row and the switcher may drift from the centre (MC-1414). The first track
    //   has a fixed minimum that keeps a clipped wordmark and the chip track has a zero minimum, so
    //   a long name truncates inside the bar and in mid the two tracks sum to the content box.
    // The chip cluster's children (Tasks and the chip) each keep at least 44 px in mid and wide, so the cluster
    // cannot shrink below that and spill over the wordmark or the switcher; the chip's label and hint still
    // truncate or wrap inside that width.
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
        mid: 'grid grid-cols-[minmax(6rem,1fr)_minmax(0,auto)] items-center gap-x-4 gap-y-2',
        wide: 'grid grid-cols-[minmax(2.75rem,1fr)_auto_minmax(2.75rem,1fr)] items-center gap-x-4',
    }
    const switcherClass: Record<HomeBand, string> = {
        phone: 'w-full *:mt-0!',
        mid: 'col-span-2 row-start-2 -ml-10 flex justify-center *:justify-center *:mt-0!',
        wide: 'flex justify-center *:justify-center *:mt-0!',
    }
    // The chip wrapper renders only outside the phone band, so it has no phone entry.
    const chipClass: Record<Exclude<HomeBand, 'phone'>, string> = {
        mid: 'col-start-2 row-start-1 flex items-center gap-2 justify-end *:min-w-11 *:mt-0!',
        wide: 'flex min-w-0 items-center gap-2 justify-end -mr-10 *:min-w-11 *:mt-0!',
    }
    // Wordmark sliver rule (MC-1443, sizes MC-3081): the brand cell is an inline-size container in mid and
    // wide. The cell holds the 32 px mark and the 8 px gap, so a cell under 4rem (64 px) leaves the
    // wordmark under 24 px. Below that the wordmark leaves the layout (visually hidden, not display:none,
    // so the brand keeps its text alternative); this only avoids a sliver. The wide side tracks stay equal
    // so the switcher stays centred, so the chip does not grow into the freed space (MC-1446). A bar
    // too narrow for them (under WIDE_BAR_MIN) takes the mid layout instead of squeezing the wide tracks. The mid
    // track minimum (6rem) keeps the wordmark at 56 px or more, above the threshold, so a clipped
    // "Ris" stays visible (MC-1436). The wordmark is a fixed-width box, so a narrow cell clips it
    // horizontally (overflow-x-clip on the cell) instead of ellipsising it; the 6 px clip margin keeps the
    // replay button's focus ring (2 px outline, 3 px offset) visible past the cell edge where the engine honours it.
    // While a seasonal occasion shows (the host's data-seasonal-active), the cell adds 22 px of end padding: a scene's
    // final pose may reach 22 px right of the word and the focus ring sits past it, and the clip edge is the padding
    // box, so both stay visible without the cell drawing into the next track; the phone band takes this padding too.
    // The phone cell's 4 px of end padding keeps the last letter of the wordmark inside the clip edge (the padding box).
    // The phone band has no container and no sliver rule (MC-1415); its wordmark leaves the layout under 350 px of
    // viewport (a viewport variant, since there is no container), visually hidden so the brand keeps its text.
    const brandClass: Record<HomeBand, string> = {
        phone: 'flex min-h-11 min-w-0 items-center gap-2 overflow-x-clip pe-1 [overflow-clip-margin:6px] data-seasonal-active:pe-[22px] text-textcolor',
        mid: '@container flex min-h-11 min-w-0 items-center gap-2 overflow-x-clip [overflow-clip-margin:6px] data-seasonal-active:pe-[22px] text-textcolor',
        wide: '@container flex min-h-11 min-w-0 items-center gap-2 overflow-x-clip [overflow-clip-margin:6px] data-seasonal-active:pe-[22px] text-textcolor',
    }
    const wordmarkClass: Record<HomeBand, string> = {
        phone: 'min-w-0 max-[349.98px]:sr-only',
        mid: 'min-w-0 @max-[4rem]:sr-only',
        wide: 'min-w-0 @max-[4rem]:sr-only',
    }
</script>

{#snippet brand()}
    <div data-part="home-brand" data-seasonal-brand class={brandClass[layout]}>
        <svg
            class="nexus-mark size-8 shrink-0 max-[639.98px]:size-7"
            viewBox={MARK_VIEWBOX}
            width="32"
            height="32"
            aria-hidden="true"
            focusable="false"
            data-status="idle"
            data-still=""
            data-tone={$ColorSchemeTypeStore === 'light' ? 'light' : undefined}
            data-seasonal-mark
        >
            {@html inner}
        </svg>
        <SeasonalBrand class={wordmarkClass[layout]} />
    </div>
{/snippet}

<header
    data-part="home-topbar"
    data-layout={layout}
    data-seasonal-anchor
    bind:this={header}
    class="w-full {insetClass[layout]} pt-3 pb-2 {barClass[layout]}"
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
            <HomeTasks bind:open={tasksOpen} class="ms-auto" />
            <HomePersonaChip compact />
        </div>
        {#if hasSwitcher}
            <div class={switcherClass.phone}>
                <HomeModeSwitcher />
            </div>
        {/if}
    {:else}
        {@render brand()}
        {#if layout === 'wide'}
            <div class={switcherClass.wide}>
                <HomeModeSwitcher />
            </div>
        {/if}
        <!-- Roleplay content: while Roleplay is the only built mode (BUILT_HOME_MODES) the landing is Roleplay. -->
        <div class={chipClass[chipLayout]}>
            <HomeTasks bind:open={tasksOpen} />
            <HomePersonaChip />
        </div>
        {#if layout === 'mid' && hasSwitcher}
            <!-- Omitted when empty so the mid grid never adds an empty row gap. -->
            <div class={switcherClass.mid}>
                <HomeModeSwitcher />
            </div>
        {/if}
    {/if}
</header>

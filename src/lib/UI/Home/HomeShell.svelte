<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { LayoutGridIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import MainMenu from '../MainMenu.svelte'
    import HomeEmptyHero from './HomeEmptyHero.svelte'
    import HomeGreeting from './HomeGreeting.svelte'
    import HomeJumpRow from './HomeJumpRow.svelte'
    import HomeLibrary from './HomeLibrary.svelte'
    import '../../../styles/home-tokens.css'
    import NexusNetworkBackground from '../../Nexus/network/NexusNetworkBackground.svelte'
    import { chatSurface } from '../../ChatScreens/chatSurface.svelte'
    import { coversPage } from 'src/ts/alertEscape'
    import { DBState, OpenRealmStore, alertStore, sideBarStore } from 'src/ts/stores.svelte'
    import HomeDrawer from './HomeDrawer.svelte'
    import HomeStoryShelf from './HomeStoryShelf.svelte'
    import HomeTopBar from './HomeTopBar.svelte'
    import { holdHomeChrome } from './homeChrome.svelte'
    import { hasLibraryContent, liveCharacterCount } from './homeEmpties'
    import { homeBand } from './homeLayout'
    import { freezeStories, resolveFrozen } from './homeStories'
    import { jumpToSection, revealInScrollContainer, scrollContainerOf } from './homeJump'
    import { engageHomeLibrary, homeView, openHomeLibrary, startHomeView, takeHomeReturnFocus } from './homeView.svelte'
    import { reducedMotionActive } from 'src/ts/chatShell/motionPrefs.svelte'

    // Every creation starts at the top of the landing: a selection change, the language remount and a return
    // to Home all create a fresh shell. Covers (Settings, Studio) keep it mounted. The one exception is the
    // return from a Home-opened Studio visit, which reveals the library once (`resumedLibrary`).
    const resumedLibrary = startHomeView()

    // The story shelf's order, chat labels and last lines are taken once per shell, here and not in the
    // shelf: the shelf unmounts when the Realm view opens, and a freeze there would re-sort on every
    // close. Removals, names, pictures, times and the archived state stay live through `resolveFrozen`.
    const frozenStories = untrack(() => freezeStories(DBState.db.characters ?? [], language.settingsPage.unnamed))
    const stories = $derived(resolveFrozen(frozenStories, DBState.db.characters ?? []))

    // Home's width band is read here and nowhere else; the chat shell keeps its own bands.
    let viewportWidth = $state(window.innerWidth)
    const band = $derived(homeBand(viewportWidth))

    // The library section exists while any slot would be listed, the Trash included, so the Trash stays
    // reachable. With none, the Create/Import hero is the only content and there is no library to enter.
    const libraryShown = $derived(hasLibraryContent(DBState.db.characters))

    // The phone landing: the Realm view is closed and the band is phone. Only here are the menu button and
    // the drawer offered.
    const phoneLanding = $derived(!$OpenRealmStore && band === 'phone')
    let drawerOpen = $state(false)
    let menuButton: HTMLElement | null = $state(null)
    const uid = $props.id()
    const drawerId = `${uid}-home-drawer`
    const libraryHeadingId = `${uid}-home-library`

    // Runs before the first render and on every change, so the sidebar arrow never shows for a
    // frame on the phone landing. The shell holds the flag only while the phone landing shows; leaving
    // the landing and unmounting release it, and a release never clears the hold of a shell built
    // before this one was destroyed. The release-then-rehold on a re-run is intended: do not turn it
    // into a write-only-on-change. Arriving on the phone landing closes a legacy sidebar overlay that
    // was already open: it is not modal here, and the arrow that reopens it is gone. `sideBarStore` is
    // read only here, at that point.
    $effect.pre(() => {
        if (!phoneLanding) return
        sideBarStore.set(false)
        return holdHomeChrome('phoneDrawer')
    })

    // The sidebar's Home look holds for the shell's whole life, Realm view included. It reads nothing,
    // so it runs once before the first render and releases on destroy.
    $effect.pre(() => holdHomeChrome('landing'))

    // The drawer goes with the phone landing: a resize out of the band and the Realm view both end it, so it
    // never comes back by itself.
    $effect(() => {
        if (!phoneLanding) {
            drawerOpen = false
        }
    })

    // The embedded library mounts after the landing has painted, so its mount cost is not part of the first
    // frames: until then the section holds a placeholder of the same height. Once true it stays true for the
    // shell's life (the Realm view unmounts the landing body, not this component), so a return to the landing
    // mounts the library at once.
    let libraryMounted = $state(false)
    let landingRoot: HTMLElement | null = $state(null)
    let landingBody: HTMLElement | null = $state(null)
    let placeholder: HTMLElement | null = $state(null)

    // Triggers, each torn down when the library mounts and when the shell is destroyed: idle time, armed only
    // after a double animation frame so the first paint is never delayed; and a scroll that brings the
    // placeholder within half a screen. The nearness is never checked at arm time: a fresh scroller emits no
    // scroll event, so a placeholder that starts in view waits for idle.
    $effect(() => {
        if (libraryMounted || !libraryShown || $OpenRealmStore || !landingBody) return
        const scroller = landingBody.firstElementChild
        let firstFrame = 0
        let secondFrame = 0
        let idleHandle = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        const mountLibrary = () => {
            libraryMounted = true
        }
        const onScroll = () => {
            if (!placeholder || !scroller) return
            const reach = scroller.getBoundingClientRect().bottom + 0.5 * scroller.clientHeight
            if (placeholder.getBoundingClientRect().top < reach) mountLibrary()
        }
        firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                scroller?.addEventListener('scroll', onScroll, { passive: true })
                if (typeof requestIdleCallback === 'function') {
                    idleHandle = requestIdleCallback(mountLibrary, { timeout: 2000 })
                } else {
                    timer = setTimeout(mountLibrary, 0)
                }
            })
        })
        return () => {
            cancelAnimationFrame(firstFrame)
            cancelAnimationFrame(secondFrame)
            if (idleHandle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
            if (timer !== undefined) clearTimeout(timer)
            scroller?.removeEventListener('scroll', onScroll)
        }
    })

    // The network lattice exists from two animation frames after the shell's creation on, so its cost is not
    // part of the first frames. Once armed it stays armed for the shell's life.
    let latticeArmed = $state(false)
    $effect(() => {
        let second = 0
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                latticeArmed = true
            })
        })
        return () => {
            cancelAnimationFrame(first)
            cancelAnimationFrame(second)
        }
    })

    // Only the wide band animates; the phone and mid bands show one coarse still frame. A covered page (a
    // hidden chat surface, a page-covering alert) runs no field. A user background image replaces the lattice.
    const latticeStill = $derived(band !== 'wide')
    const latticePaused = $derived(chatSurface.hidden || coversPage($alertStore.type))
    const latticeShown = $derived(latticeArmed && !DBState.db.customBackground)

    // A background press may raise a wave; presses on interactive elements and on every named block do not.
    const WAVE_BLOCKERS = 'button, a, input, select, textarea, label, summary, details, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [contenteditable], [data-part]:not([data-part="home-landing"]):not([data-part="home-body"])'
    function canWave(event: PointerEvent): boolean {
        const target = event.target
        if (!(target instanceof Element) || !landingRoot?.contains(target)) return false
        return target.closest(WAVE_BLOCKERS) === null
    }

    // The re-aim of the latest jump (jumpToSection): a new reveal and the shell's destruction both end it.
    let reaim: AbortController | null = null
    onDestroy(() => reaim?.abort())

    // Brings the library into view: mounts it first when it is still deferred (the mount must be in the DOM before
    // anything is scrolled or focused), then scrolls to and focuses the target. The library section wins whenever
    // it exists, the Trash-only case included: the focus goes to the character's Studio control when a Studio
    // visit ended on it and the control is drawn, else to the library heading. With no library content the header
    // hero is the only content and takes both. Resolved inside this landing only.
    async function revealLibrary(focusChaId: string | null): Promise<void> {
        reaim?.abort()
        reaim = new AbortController()
        const { signal } = reaim
        if (!libraryMounted) {
            libraryMounted = true
            await tick()
        }
        const root = landingRoot
        if (!root) return
        const scroller = landingBody?.firstElementChild instanceof HTMLElement ? landingBody.firstElementChild : null
        const reduced = reducedMotionActive()
        const section = root.querySelector<HTMLElement>('[data-part="home-library"]')
        if (section) {
            const control = focusChaId === null ? undefined : Array.from(section.querySelectorAll<HTMLElement>('[data-part="library-studio"]'))
                .find((candidate) => candidate.getAttribute('data-cha-id') === focusChaId)
            // The focus never scrolls, so a Studio control deep in the library's own list is brought into view there,
            // right after the focus and again whenever the layout changes while the jump settles; the list is observed
            // too, because the section's height cap keeps the section from resizing when only the list shrinks.
            const inner = control ? scrollContainerOf(control, section) : null
            jumpToSection({
                scroller,
                target: section,
                focus: control ?? section.querySelector<HTMLElement>('[data-jump-target="library"]'),
                reduced,
                signal,
                onLayout: control ? () => revealInScrollContainer(control, section) : undefined,
                observe: inner ? [inner] : [],
            })
            return
        }
        const hero = root.querySelector<HTMLElement>('section[data-part="home-empty-hero"]')
        if (hero) {
            jumpToSection({ scroller, target: hero, focus: hero.querySelector<HTMLElement>('[data-jump-target="home-hero"]'), reduced, signal })
        }
    }

    // The jump row's RisuRealm entry: the same mechanism as the library reveal, on the panel's heading. Resolved
    // inside this landing only; the panel is absent while the Realm view is open, and then nothing happens.
    function jumpToRealm(): void {
        reaim?.abort()
        reaim = new AbortController()
        const root = landingRoot
        if (!root) return
        const scroller = landingBody?.firstElementChild instanceof HTMLElement ? landingBody.firstElementChild : null
        jumpToSection({
            scroller,
            target: root.querySelector<HTMLElement>('[data-jump-target="realm"]'),
            reduced: reducedMotionActive(),
            signal: reaim.signal,
        })
    }

    // Each explicit request (`openHomeLibrary`, `requestHomeLibrary`) reveals the library. The counter value read
    // at creation is not a request: a shell created after the Studio visit's window starts at the top. A shell
    // created by that visit's end reveals once instead (`resumedLibrary`).
    let seenRequest = untrack(() => homeView.libraryRequest)
    $effect(() => {
        const request = homeView.libraryRequest
        if (request === seenRequest) return
        seenRequest = request
        untrack(() => {
            void revealLibrary(takeHomeReturnFocus())
        })
    })

    $effect(() => {
        if (!resumedLibrary) return
        untrack(() => {
            void revealLibrary(takeHomeReturnFocus())
        })
    })
</script>

<svelte:window bind:innerWidth={viewportWidth} />

{#snippet homeHeader()}
    <HomeGreeting />
    <HomeJumpRow {band} realmShown={!DBState.db.hideRealm} {libraryShown} liveCount={liveCharacterCount(DBState.db.characters)} onjumprealm={jumpToRealm} />
    <!-- On the phone the drawer carries the Characters entry. With no library content the hero is the only
         content, so there is no Characters button; the drawer keeps its entry (MC-2931). -->
    {#if band !== 'phone' && libraryShown}
        <button
            type="button"
            class="mt-2 flex items-center gap-2 rounded-md border border-borderc/10 bg-darkbg px-4 py-2 text-textcolor hover:bg-selected/50"
            onclick={openHomeLibrary}
        >
            <LayoutGridIcon size={18} />
            {language.character}
        </button>
    {/if}
    <HomeEmptyHero />
{/snippet}

{#snippet homeStage()}
    {#if stories.length > 0}
        <HomeStoryShelf {stories} {band} />
    {/if}
    {#if libraryShown}
        <!--
          The library is a bounded section: one scroller-height tall at most (the MainMenu scroller is a size
          container), its list scrolling inside. Any touch inside, in the capture phase so a control that stops
          propagation cannot hide it, marks the library as used this visit and so cancels a pending restore.
        -->
        <section
            data-part="home-library"
            aria-labelledby={libraryHeadingId}
            class="flex max-h-[100cqh] min-h-0 flex-col"
            onpointerdowncapture={engageHomeLibrary}
            onkeydowncapture={engageHomeLibrary}
            onfocusin={engageHomeLibrary}
        >
            <h2
                id={libraryHeadingId}
                tabindex="-1"
                data-jump-target="library"
                class="mb-[var(--home-space-8)] border-b-[length:var(--home-hairline)] border-[color:var(--nexus-edge)] pb-[var(--home-space-6)] text-[length:var(--home-text-lg)] font-bold tracking-[var(--home-tracking-h1)]"
            >{language.homeLibraryHeading}</h2>
            <div class="flex min-h-0 flex-1 flex-col">
                {#if libraryMounted}
                    <HomeLibrary />
                {:else}
                    <div bind:this={placeholder} data-part="home-library-placeholder" class="h-[100cqh]" aria-hidden="true"></div>
                {/if}
            </div>
        </section>
    {/if}
{/snippet}

{#if latticeShown}
    <!-- A previous sibling of the landing in a positioned parent: it paints first and all Home content paints over
         it with no z-index. The part's opacity cannot exceed the inner alpha. -->
    <div data-part="home-network" aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden text-[color:var(--nexus-edge-strong)] forced-colors:hidden">
        <div class="absolute inset-0 opacity-[var(--home-network-alpha)]">
            <NexusNetworkBackground still={latticeStill} lowPower={latticeStill} paused={latticePaused} tint="inherit" {canWave} />
        </div>
    </div>
{/if}

<div bind:this={landingRoot} data-part="home-landing" data-layout={band} class="home-root relative flex h-full w-full flex-col">
    {#if !$OpenRealmStore}
        <HomeTopBar
            {band}
            bind:menuButton
            {drawerOpen}
            {drawerId}
            onmenu={() => {
                drawerOpen = true
            }}
        />
    {/if}
    <div bind:this={landingBody} class="min-h-0 flex-1">
        <MainMenu header={homeHeader} stage={stories.length > 0 || libraryShown ? homeStage : undefined} />
    </div>
    {#if drawerOpen && phoneLanding}
        <HomeDrawer
            id={drawerId}
            trigger={menuButton}
            onclose={() => {
                drawerOpen = false
            }}
        />
    {/if}
</div>

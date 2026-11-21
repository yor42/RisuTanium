<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { LayoutGridIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import MainMenu from '../MainMenu.svelte'
    import HomeEmptyHero from './HomeEmptyHero.svelte'
    import HomeGreeting from './HomeGreeting.svelte'
    import HomeLibrary from './HomeLibrary.svelte'
    import '../../../styles/home-tokens.css'
    import { DBState, OpenRealmStore, sideBarStore } from 'src/ts/stores.svelte'
    import HomeDrawer from './HomeDrawer.svelte'
    import HomeStoryShelf from './HomeStoryShelf.svelte'
    import HomeTopBar from './HomeTopBar.svelte'
    import { homeChrome } from './homeChrome.svelte'
    import { hasLibraryContent } from './homeEmpties'
    import { homeBand } from './homeLayout'
    import { freezeStories, resolveFrozen } from './homeStories'
    import { jumpToSection, revealInScrollContainer } from './homeJump'
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
    // frame on the phone landing. The flag clears when the landing is left and on unmount. Arriving
    // on the phone landing closes a legacy sidebar overlay that was already open: it is not modal
    // here, and the arrow that reopens it is gone. `sideBarStore` is read only here, at that point.
    $effect.pre(() => {
        homeChrome.phoneDrawer = phoneLanding
        if (phoneLanding) {
            sideBarStore.set(false)
        }
        return () => {
            homeChrome.phoneDrawer = false
        }
    })

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
            jumpToSection({ scroller, target: section, focus: control ?? section.querySelector<HTMLElement>('[data-jump-target="library"]'), reduced, signal })
            // The focus never scrolls, so a Studio control deep in the library's own list is brought into view there.
            if (control) revealInScrollContainer(control, section)
            return
        }
        const hero = root.querySelector<HTMLElement>('section[data-part="home-empty-hero"]')
        if (hero) {
            jumpToSection({ scroller, target: hero, focus: hero.querySelector<HTMLElement>('[data-jump-target="home-hero"]'), reduced, signal })
        }
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
                class="mb-[var(--home-space-8)] text-[length:var(--home-text-lg)] font-bold tracking-[var(--home-tracking-h1)]"
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

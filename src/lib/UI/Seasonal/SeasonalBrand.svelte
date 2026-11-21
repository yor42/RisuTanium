<script lang="ts">
    import 'src/ts/seasonal/host.css'
    import { untrack } from 'svelte'
    import { get } from 'svelte/store'
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import { openURL } from 'src/ts/globalApi.svelte'
    import { ColorSchemeTypeStore, packBaseTone, surfaceToneFor } from 'src/ts/gui/surfaceTone'
    import { motionPrefs, reducedMotionActive } from 'src/ts/chatShell/motionPrefs.svelte'
    import { lowPowerMarked } from 'src/ts/chatShell/lowPower'
    import { resolveOccasion } from 'src/ts/seasonal/calendar'
    import { PLAIN_WORDMARK_HTML, mountSeasonal, type HostController, type SeasonalStrings } from 'src/ts/seasonal/host'
    import { localYmd, markPlayed, playedToday, seasonalLogoEnabled } from 'src/ts/seasonal/seasonalPrefs.svelte'

    interface Props {
        class?: string
    }

    let { class: className = '' }: Props = $props()

    const ANNIVERSARY_URL = 'https://github.com/yor42/RisuTanium'

    // The wordmark of the top bar. Markup is the everyday wordmark; the host replaces it only on an occasion day, so
    // with the toggle off, or on a day without an occasion, no host, no listener and no scene chunk exists.
    // The brand cell, the status mark and the top bar are found by data attributes of the surrounding bar.
    let hostEl = $state<HTMLElement | null>(null)
    let controller: HostController | null = null

    // Bumped when the page becomes visible again, so the occasion is re-read. No timer runs on an ordinary day: a
    // mounted host keeps its own midnight timer, and the top bar remounts whenever Home is reopened.
    let dayTick = $state(0)
    const mountedDay = localYmd(new Date())
    let sessionCrossedMidnight = false

    const occasion = $derived.by(() => {
        void dayTick
        return seasonalLogoEnabled() ? resolveOccasion(new Date(), DBState.db.language) : ''
    })

    $effect(() => {
        const onVisible = (): void => {
            if (document.hidden) return
            // A view on a later day than the one this bar was mounted on shows the final pose, never the animation.
            if (localYmd(new Date()) !== mountedDay) sessionCrossedMidnight = true
            dayTick++
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    })

    function strings(): SeasonalStrings {
        return {
            replayHint: language.seasonalReplayHint,
            skipHint: language.seasonalSkipHint,
            santaHat: language.seasonalSantaHat,
            gameTitle: language.seasonalGameTitle,
            gameClose: language.seasonalGameClose,
            gameScore: language.seasonalGameScore,
            gameTime: language.seasonalGameTime,
            gamePlay: language.seasonalGamePlay,
            gamePlayAgain: language.seasonalGamePlayAgain,
            gameTarget: language.seasonalGameTarget,
            gameHint: language.seasonalGameHint,
            gameTimeUp: language.seasonalGameTimeUp,
            gameClosed: language.seasonalGameClosed,
        }
    }

    function currentTheme(): 'light' | 'dark' {
        return surfaceToneFor(get(ColorSchemeTypeStore), get(packBaseTone))
    }

    $effect(() => {
        const key = occasion
        const lang = DBState.db.language
        const el = hostEl
        if (!key || !el) return
        const brand = el.closest<HTMLElement>('[data-seasonal-brand]')
        const ctrl = untrack(() => mountSeasonal(el, {
            language: lang,
            strings: strings(),
            playedToday,
            markPlayed,
            anchorEl: el.closest<HTMLElement>('[data-seasonal-anchor]'),
            brandEl: brand,
            fitEl: brand,
            markEl: brand?.querySelector<HTMLElement>('[data-seasonal-mark]') ?? null,
            reducedMotion: () => reducedMotionActive(),
            lowPower: () => lowPowerMarked(),
            theme: currentTheme,
            anniversaryUrl: ANNIVERSARY_URL,
            onLink: (url) => {
                if (url) openURL(url)
            },
            autoplay: !sessionCrossedMidnight,
        }))
        controller = ctrl
        return () => {
            ctrl.destroy()
            if (controller === ctrl) controller = null
        }
    })

    // The device's motion choices and the colour scheme change while the logo is mounted: re-read them.
    $effect(() => {
        void motionPrefs.lowPower
        void motionPrefs.reducedMotion
        void motionPrefs.systemReduced
        void $ColorSchemeTypeStore
        void $packBaseTone
        controller?.refresh()
    })
</script>

<span class="rt-sw-host {className}" bind:this={hostEl} data-seasonal-host>{@html PLAIN_WORDMARK_HTML}</span>

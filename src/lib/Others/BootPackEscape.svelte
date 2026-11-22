<script lang="ts">
    // The boot escape banner and the pack safe mode notice. Nothing a theme pack controls may reach it, so it reads no theme
    // token, no Tailwind utility and no scope attribute: every colour is a literal from `bannerPalette`, every size is an
    // inline px literal, and the markup has no style block. The one inherited value is the user's font family, which the
    // unlayered `*` rule sets from the reserved font setting.
    import { language } from 'src/lang'
    import { DBState, loadedStore } from 'src/ts/stores.svelte'
    import { bannerAccess, bannerPalette, dismissPackBanner, packAnnouncement, packBanner, tapTurnOff } from 'src/ts/themePack/packSafeMode.svelte'

    // The offer stays until this long after the app shows, unless it holds focus or the pointer. With touch exploration on it
    // stays until Dismiss or turn-off: the screen reader's focus is not DOM focus, so the focus pause cannot hold.
    const OFFER_SHOWN_MS = 5000

    let held = $state(false)
    let focusWithin = false
    let pointerWithin = false

    const palette = $derived(bannerPalette(DBState.db))

    $effect(() => {
        if (!$loadedStore || packBanner.mode !== 'offer' || held || bannerAccess.touchExploration) {
            return
        }
        const timer = setTimeout(dismissPackBanner, OFFER_SHOWN_MS)
        return () => clearTimeout(timer)
    })

    function updateHeld(): void {
        held = focusWithin || pointerWithin
    }
</script>

<!-- The live region is always present, so it announces the result even after the banner is removed (a successful turn-off).
     It is visually hidden with inline literals only. -->
<div
    role="status"
    aria-live="polite"
    aria-atomic="true"
    style:position="absolute"
    style:width="1px"
    style:height="1px"
    style:margin="-1px"
    style:padding="0px"
    style:overflow="hidden"
    style:clip="rect(0, 0, 0, 0)"
    style:white-space="nowrap"
    style:border="0px"
>{packAnnouncement.turnedOff ? language.packTurnedOffNotice : packAnnouncement.off ? language.packSafeModeNotice : ''}</div>

{#if packBanner.mode !== 'hidden'}
    <div
        data-part="boot-pack-escape"
        data-part-critical
        role="region"
        aria-label={language.packEscapeLabel}
        onfocusin={() => { focusWithin = true; updateHeld() }}
        onfocusout={() => { focusWithin = false; updateHeld() }}
        onpointerenter={() => { pointerWithin = true; updateHeld() }}
        onpointerleave={() => { pointerWithin = false; updateHeld() }}
        style:position="fixed"
        style:top="0px"
        style:left="0px"
        style:right="0px"
        style:z-index="1000"
        style:box-sizing="border-box"
        style:display="flex"
        style:flex-wrap="wrap"
        style:align-items="center"
        style:justify-content="space-between"
        style:gap="8px"
        style:padding="calc(12px + env(safe-area-inset-top, 0px)) 12px 12px 12px"
        style:font-size="15px"
        style:line-height="20px"
        style:color-scheme={palette.colorScheme}
        style:color={palette.text}
        style:background-color={palette.background}
        style:border-bottom={`1px solid ${palette.border}`}
    >
        <span
            style:flex="1 1 12em"
            style:min-width="0px"
            style:font-size="15px"
            style:line-height="20px"
            style:color={palette.text}
        >{packBanner.mode === 'notice' ? language.packSafeModeNotice : language.packEscapeLabel}</span>
        <span style:display="flex" style:flex-wrap="wrap" style:gap="8px">
            {#if packBanner.mode === 'offer' || packBanner.canTurnOff}
                <button
                    type="button"
                    onclick={tapTurnOff}
                    style:min-height="44px"
                    style:padding="0px 16px"
                    style:font-size="15px"
                    style:line-height="20px"
                    style:border-radius="8px"
                    style:cursor="pointer"
                    style:color={palette.buttonText}
                    style:background-color={palette.buttonFill}
                    style:border={`1px solid ${palette.border}`}
                >{language.packEscapeTurnOff}</button>
            {/if}
            <button
                type="button"
                onclick={dismissPackBanner}
                style:min-height="44px"
                style:padding="0px 16px"
                style:font-size="15px"
                style:line-height="20px"
                style:border-radius="8px"
                style:cursor="pointer"
                style:color={palette.buttonText}
                style:background-color={palette.buttonFill}
                style:border={`1px solid ${palette.border}`}
            >{language.packEscapeDismiss}</button>
        </span>
    </div>
{/if}

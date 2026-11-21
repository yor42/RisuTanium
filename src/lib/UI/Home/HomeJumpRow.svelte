<script lang="ts">
    import { language } from 'src/lang'
    import type { HomeBand } from './homeLayout'
    import { openHomeLibrary } from './homeView.svelte'

    interface Props {
        band: HomeBand
        /** Whether the RisuRealm panel is on the landing (the user has not hidden it), whatever its fetch state. */
        realmShown: boolean
        /** Whether the library section exists (any slot it would list, the Trash included). */
        libraryShown: boolean
        /** The number of characters outside the Trash; may be 0. */
        liveCount: number
        /** Brings the RisuRealm panel into view and focuses its heading; the host owns the landing scroller. */
        onjumprealm: () => void
    }

    let { band, realmShown, libraryShown, liveCount, onjumprealm }: Props = $props()

    // The row exists only on the phone, where the library and the panel are far apart, and only when it
    // offers a choice: a single entry would be a lone shortcut.
    const entryCount = $derived((libraryShown ? 1 : 0) + (realmShown ? 1 : 0))

    const linkClass = 'risu-focus-ring flex min-h-11 items-center rounded-md border border-borderc/10 bg-darkbg px-4 py-2 text-textcolor hover:bg-selected/50'
</script>

{#if band === 'phone' && entryCount >= 2}
    <nav data-part="home-jump" aria-label={language.homeJumpLabel} class="mt-2 flex flex-wrap gap-2">
        {#if libraryShown}
            <button type="button" data-part="home-jump-link" class={linkClass} onclick={openHomeLibrary}>
                {language.homeJumpCharacters(liveCount)}
            </button>
        {/if}
        {#if realmShown}
            <button type="button" data-part="home-jump-link" class={linkClass} onclick={onjumprealm}>
                {language.hub}
            </button>
        {/if}
    </nav>
{/if}

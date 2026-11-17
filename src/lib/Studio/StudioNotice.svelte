<script lang="ts">
    import { XIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { placeLabelOf } from '../../ts/studio/assets/mergeCommit'

    // A persistent status line under the header, not a toast: it stays until dismissed or until the
    // user navigates on. The live region exists even while empty so a new message is announced.
    // `places` are the registry targets a merge undo left as they were: Show lists them by their labels. A newer notice
    // brings its own list (or none), so the list never outlives the message it belongs to.
    interface Props {
        message: string | null
        places?: readonly string[] | null
        ownerKind?: 'character' | 'module'
        ondismiss: () => void
    }

    let { message, places = null, ownerKind = 'character', ondismiss }: Props = $props()

    // The list that Show opened; a different list is closed until its own Show is pressed.
    let openedFor = $state.raw<readonly string[] | null>(null)
    const listed = $derived(message !== null && places !== null && places.length > 0 ? places : null)
    const showing = $derived(listed !== null && openedFor === listed)
</script>

<div role="status" data-part="studio-notice" class="flex flex-wrap items-center gap-2 px-3 text-sm text-textcolor2" hidden={message === null}>
    {#if message !== null}
        <span class="min-w-0 flex-1 py-2" data-part="studio-notice-text">{message}</span>
        {#if listed !== null}
            <button type="button" class="min-h-9 shrink-0 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" aria-expanded={showing} data-part="studio-notice-show" onclick={() => { openedFor = showing ? null : listed }}>{language.studioAssetShow}</button>
        {/if}
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-selected cursor-pointer" aria-label={language.studioNoticeDismiss} data-part="studio-notice-dismiss" onclick={ondismiss}>
            <XIcon size={16} />
        </button>
        {#if showing && listed !== null}
            <ul data-part="studio-notice-places" class="flex w-full basis-full flex-col gap-1 pb-2">
                {#each listed as place (place)}
                    <li data-part="studio-notice-place">{placeLabelOf(ownerKind, place)}</li>
                {/each}
            </ul>
        {/if}
    {/if}
</div>

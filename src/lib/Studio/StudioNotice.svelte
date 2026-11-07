<script lang="ts">
    import { XIcon } from '@lucide/svelte'
    import { language } from '../../lang'

    // A persistent status line under the header, not a toast: it stays until dismissed or until the
    // user navigates on. The live region exists even while empty so a new message is announced.
    interface Props {
        message: string | null
        ondismiss: () => void
    }

    let { message, ondismiss }: Props = $props()
</script>

<div role="status" data-part="studio-notice" class="flex items-center gap-2 px-3 text-sm text-textcolor2" hidden={message === null}>
    {#if message !== null}
        <span class="min-w-0 flex-1 py-2" data-part="studio-notice-text">{message}</span>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-selected cursor-pointer" aria-label={language.studioNoticeDismiss} data-part="studio-notice-dismiss" onclick={ondismiss}>
            <XIcon size={16} />
        </button>
    {/if}
</div>

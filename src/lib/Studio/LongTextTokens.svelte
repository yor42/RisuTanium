<script lang="ts">
    import { language } from '../../lang'
    import type { TokenChipView } from '../../ts/studio/longText/tokenChip'

    // The token count of one long-text field and its disclosure. It only shows what the field hands it: a tap on
    // the count asks the field for a fresh count, and the disclosure is local.
    interface Props {
        view: TokenChipView | null
        chipId: string
        panelId: string
        onrefresh: () => void
    }

    let { view, chipId, panelId, onrefresh }: Props = $props()

    let open = $state(false)
</script>

<div class="ml-auto flex min-w-0 flex-col items-end gap-1 text-xs text-textcolor2">
    <div class="flex items-center gap-1">
        <button type="button" id={chipId} data-part="studio-lt-tokens" data-estimate={view?.estimate ? 'true' : 'false'} class="rounded px-1 hover:text-textcolor" onclick={onrefresh}>{view?.text ?? '…'}</button>
        <button
            type="button"
            data-part="studio-lt-tokens-info"
            class="rounded px-1.5 hover:text-textcolor"
            aria-label={language.ltTokInfo}
            aria-expanded={open}
            aria-controls={panelId}
            onclick={() => { open = !open }}
        >i</button>
    </div>
    <div id={panelId} role="group" aria-label={language.ltTokInfo} data-part="studio-lt-tokens-panel" class="max-w-full rounded bg-darkbg p-2 text-textcolor2" hidden={!open}>
        {#if view?.reason}<p>{view.reason}</p>{/if}
        <p>{view?.note ?? language.ltTokNoteRaw}</p>
    </div>
</div>

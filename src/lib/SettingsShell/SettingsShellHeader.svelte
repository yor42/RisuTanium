<script lang="ts">
    import { ArrowLeftIcon } from '@lucide/svelte'

    interface Props {
        /** What Back does next: the origin, the settings menu or a plain Back. It is also the button's accessible name. */
        backLabel: string
        title: string
        phone: boolean
        onback: () => void
    }
    let { backLabel, title, phone, onback }: Props = $props()
</script>

<header class="flex items-center gap-2 px-2 shrink-0 bg-darkbg text-textcolor border-b border-darkborderc" style:min-height={phone ? '48px' : '56px'} data-part="settings-header">
    <button type="button" class="flex items-center gap-2 px-2 min-h-11 min-w-11 rounded-md hover:text-textcolor text-textcolor2 hover:bg-darkbutton" data-part="settings-back" aria-label={backLabel} onclick={onback}>
        <ArrowLeftIcon aria-hidden="true" />
        {#if !phone}<span>{backLabel}</span>{/if}
    </button>
    <div class="flex flex-col min-w-0">
        <h1 class="font-semibold truncate" data-part="settings-title">{title}</h1>
        {#if phone}<span class="text-xs text-textcolor2 truncate" aria-hidden="true" data-part="settings-back-subtitle">{backLabel}</span>{/if}
    </div>
</header>

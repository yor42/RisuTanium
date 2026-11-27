<script lang="ts">
    import { PencilIcon } from "@lucide/svelte";

    interface Props {
        // The accessible name: what a tap stops, named by the chat or character it belongs to.
        label: string;
        onstop: () => void;
        // Position and size come from the caller; the hit area is never smaller than 24 px.
        class?: string;
        tabindex?: number;
    }

    let { label, onstop, class: className = "", tabindex }: Props = $props();

    // A tap stops one reply and nothing else: the row or tile around it must neither open nor start its hold.
    function stop(event: Event) {
        event.stopPropagation();
    }
</script>
<button
    type="button"
    data-part="reply-writing-badge"
    aria-label={label}
    title={label}
    {tabindex}
    class="flex min-h-6 min-w-6 items-center justify-center rounded-md text-textcolor2 hover:bg-selected hover:text-textcolor focus-visible:outline-hidden risu-focus-ring cursor-pointer {className}"
    onpointerdown={stop}
    oncontextmenu={stop}
    onclick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onstop();
    }}
>
    <span class="flex animate-pulse"><PencilIcon size={14} aria-hidden="true" /></span>
</button>

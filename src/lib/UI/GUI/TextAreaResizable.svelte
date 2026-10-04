<script lang="ts">
    import { onMount } from 'svelte';
    
    import { DBState } from 'src/ts/stores.svelte';
    import { longpress, type LongpressCallback } from 'src/ts/gui/longtouch';

    let textarea:HTMLElement = $state();
    let previousScrollHeight = 0;
    interface Props {
        value?: string;
        handleLongPress?: LongpressCallback;
        // Dark text for an editor that sits on an always-light surface.
        lightSurface?: boolean;
        // Fires on a real `input` event on this textarea, with the
        // element's current value -- never on a programmatic assignment to
        // `value` (Svelte's own `bind:value` does not raise an `input` event
        // when the bound variable is set from script). Optional and additive:
        // omitting it leaves this component's behaviour unchanged.
        onUserEdit?: (value: string) => void;
    }

  let { value = $bindable(''), handleLongPress = () => {}, lightSurface = false, onUserEdit }: Props = $props();

    function resize() {
        textarea.style.height = '0px'; // Reset the textarea height
        textarea.style.height = `calc(${textarea.scrollHeight}px + 1rem)`; // Set the new height
    }

    function handleInput() {
        if (textarea.scrollHeight !== previousScrollHeight) {
            previousScrollHeight = textarea.scrollHeight;
            resize();
        }
        onUserEdit?.((textarea as HTMLTextAreaElement).value);
    }

    onMount(() => {
        resize();
    });
</script>
  
<textarea
    bind:this={textarea}
    oninput={handleInput}
    use:longpress={handleLongPress}
    bind:value={value}
    class={["rounded-md p-2 bg-transparent resize-none overflow-y-hidden border border-darkborderc w-full message-edit-area", lightSurface ? "text-gray-800" : "text-textcolor"]}
    style:font-size="{0.875 * (DBState.db.zoomsize / 100)}rem"
    style:line-height="{(DBState.db.lineHeight ?? 1.25) * (DBState.db.zoomsize / 100)}rem"
></textarea>
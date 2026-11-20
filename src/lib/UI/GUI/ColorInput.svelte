<script lang="ts">
    import ColorPicker from 'svelte-awesome-color-picker';
    import { onMount, tick } from 'svelte';
    import { fieldNameIds } from './fieldNameIds';

    interface Props {
        value?: string | null;
        nullable?: boolean;
        oninput?: () => void;
        /** Id of an existing visible label element that names the colour input. */
        labelId?: string;
        /** Name text for a colour input with no visible label; rendered as a screen-reader-only span. */
        label?: string;
        /** Extra description ids, listed after the naming element. */
        describedBy?: string;
    }

    let { value = $bindable('#000000'), nullable = false, oninput, labelId = undefined, label = '', describedBy = undefined }: Props = $props();
    let acceptsInput = false;

    const uid = $props.id();

    let ids = $derived(fieldNameIds(uid, labelId, label, describedBy));

    // The library renders its own input[type=color] inside a label with no text and takes no name props.
    // TalkBack speaks only the description in the input's own stop, so the naming element is also the first description.
    // Reading the derived ids here re-runs the attachment, and the cleanup removes the attributes, when they change.
    function nameLibraryInput(node: HTMLElement) {
        const input = node.querySelector<HTMLInputElement>('input[type="color"]');
        if (!input) return;
        const nameId = ids.nameId;
        const describedIds = ids.describedIds;
        if (nameId) input.setAttribute('aria-labelledby', nameId);
        if (describedIds) input.setAttribute('aria-describedby', describedIds);
        return () => {
            input.removeAttribute('aria-labelledby');
            input.removeAttribute('aria-describedby');
        };
    }

    onMount(() => {
        tick().then(() => {
            acceptsInput = true;
        });
    });

    const handleInput = () => {
        if (!acceptsInput) return;
        oninput?.();
    };
</script>

{#if ids.srOnly}
    <span id={ids.nameId} class="sr-only">{label}</span>
{/if}
<div class="cl rounded-full bg-white" {@attach nameLibraryInput}>
    <ColorPicker
        label=""
        bind:hex={value}
        nullable={nullable}
        onInput={handleInput}
    />
</div>

<style>
    .cl{
        --cp-bg-color: var(--risu-theme-bgcolor);
        --cp-border-color: var(--risu-theme-darkborderc);
        --cp-text-color: var(--risu-theme-textcolor);
        --cp-input-color: #555;
        --cp-button-hover-color: #777;
    }
</style>

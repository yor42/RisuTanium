{#if ids.srOnly}
    <span id={ids.nameId} class="sr-only">{label}</span>
{/if}
<select
    class={"risu-select border border-darkborderc focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent risu-focus-ring transition-colors duration-200" + ((className) ? (' ' + className) : '')}
    class:text-sm={size === 'sm'}
    class:text-md={size === 'md'}
    class:text-lg={size === 'lg'}
    class:text-xl={size === 'xl'}
    class:px-4={size === 'md'}
    class:py-2={size === 'md'}
    class:px-2={size === 'sm'}
    class:py-1={size === 'sm'}
    class:px-6={size === 'lg'}
    class:py-3={size === 'lg'}
    aria-labelledby={ids.nameId}
    aria-describedby={ids.describedIds}
    bind:value
    onchange={onchange}
>
    {@render children?.()}
</select>
<script lang="ts">
    import { fieldNameIds } from './fieldNameIds';

    interface Props {
        value: string | number;
        className?: string;
        size?: 'sm'|'md'|'lg'|'xl';
        /** Id of an existing visible label element that names the select. */
        labelId?: string;
        /** Name text for a select with no visible label; rendered as a screen-reader-only span. */
        label?: string;
        /** Extra description ids, listed after the naming element; no attribute is rendered when both are absent. */
        describedBy?: string;
        children?: import('svelte').Snippet;
        onchange?: (event: Event & {
            currentTarget: EventTarget & HTMLSelectElement;
        }) => any;
    }

    let {
        value = $bindable(),
        className = "",
        size = 'md',
        labelId = undefined,
        label = '',
        describedBy = undefined,
        children,
        onchange
    }: Props = $props();

    const uid = $props.id();

    // TalkBack speaks only the description in the select's own stop, so the naming element is also the first description.
    let ids = $derived(fieldNameIds(uid, labelId, label, describedBy));

</script>
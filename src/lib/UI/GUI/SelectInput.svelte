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
    aria-describedby={ariaDescribedby}
    bind:value
    onchange={onchange}
>
    {@render children?.()}
</select>
<script lang="ts">
    interface Props {
        value: string | number;
        className?: string;
        size?: 'sm'|'md'|'lg'|'xl';
        /** The id of the element that describes this select; no attribute is rendered when absent. */
        ariaDescribedby?: string;
        children?: import('svelte').Snippet;
        onchange?: (event: Event & {
            currentTarget: EventTarget & HTMLSelectElement;
        }) => any;
    }

    let {
        value = $bindable(),
        className = "",
        size = 'md',
        ariaDescribedby,
        children,
        onchange
    }: Props = $props();

</script>
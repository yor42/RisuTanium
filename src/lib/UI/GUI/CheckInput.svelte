<script lang="ts">

    interface Props {
        check?: boolean;
        onChange?: (check:boolean) => any,
        margin?: boolean;
        name?: string;
        /** Accessible name when it differs from the visible `name` text. */
        label?: string;
        hiddenName?: boolean;
        reverse?: boolean;
        className?: string;
        grayText?: boolean;
        children?: import('svelte').Snippet;
    }

    let {
        check = $bindable(),
        onChange = (check:boolean) => {},
        margin = true,
        name = '',
        label = '',
        hiddenName = false,
        reverse = false,
        className = "",
        grayText = false,
        children
    }: Props = $props();

    // A checkbox is named through aria-label only, because that is the one name TalkBack speaks in the control's own stop.
    let accessibleName = $derived(label.trim() ? label : name.trim() ? name : undefined);
</script>

<label 
    class={"relative flex items-center gap-2 cursor-pointer" + (className ? " " + className : "") + (grayText ? " text-textcolor2" : " text-textcolor")}
    class:mr-2={margin}
>
    {#if reverse}
        <span>{name} {@render children?.()}</span>
    {/if}
    <input 
        class="sr-only peer"
        type="checkbox"
        alt={name}
        aria-label={accessibleName}
        bind:checked={check}
        onchange={() => {
            onChange(check)
        }}
    />
    <span
        class="w-5 h-5 min-w-5 min-h-5 rounded-md border-2 border-darkborderc flex justify-center items-center {check ? 'bg-darkborderc' : 'bg-darkbutton'} transition-colors duration-200 risu-focus-ring-peer"
        aria-hidden="true"
    >
        {#if check}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="white" class="w-3 h-3" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
        {/if}
    </span>
    {#if !hiddenName && !reverse}
        <span>{name} {@render children?.()}</span>
    {/if}
</label>
<button
    onclick={onclick}
    {disabled}
    aria-pressed={ariaPressed}
    class="{
        styled === 'primary' ? ((selected ? 'bg-selected risu-on-selected' : 'bg-darkbutton') + " hover:bg-selected border-darkborderc")
        : styled === 'outlined' ? 'bg-transparent hover:bg-darkbg border-darkborderc text-textcolor2'
        : ((selected ? 'bg-red-800' : 'bg-red-700') + ' hover:bg-red-600 border-red-600 risu-on-danger')
    } border text-textcolor rounded-md shadow-xs risu-focus-ring transition-colors duration-200{className ? (" " + className) : ""}"
    class:opacity-50={disabled}
    class:cursor-not-allowed={disabled}
    class:px-4 = {size == "md"}
    class:px-2 = {size == "sm"}
    class:px-6 = {size == "lg"}
    class:py-2 = {size == "md"}
    class:py-1 = {size == "sm"}
    class:py-3 = {size == "lg"}
    class:text-md = {size == "md"}
    class:text-sm = {size == "sm"}
    class:text-lg = {size == "lg"}>
    {@render children?.()}
</button>
<script lang="ts">

    interface Props {
        selected?: boolean;
        styled?: 'primary'|'danger'|'outlined';
        className?: string;
        size?: "sm" | "md" | "lg";
        disabled?: boolean;
        // Set only by a button that toggles a state; left out, the attribute is not rendered.
        ariaPressed?: boolean;
        children?: import('svelte').Snippet;
        onclick?: (event: MouseEvent & {
            currentTarget: EventTarget & HTMLButtonElement;
        }) => any
    }

    let {
        selected = false,
        styled = 'primary',
        className = "",
        size = "md",
        disabled = false,
        ariaPressed,
        children,
        onclick
    }: Props = $props();
</script>
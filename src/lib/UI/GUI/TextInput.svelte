
<!-- Svelte doesn't allow two-way binding on an input with a dynamic type, so the value is written back by hand. -->

<!-- One element for both states, so the caret and focus survive the masked/plain switch while typing. new-password disables autofill on the masked input. -->
<input
    class={"border border-darkborderc peer focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent focus:ring-borderc focus:ring-2 focus:outline-hidden transition-colors duration-200" + ((className) ? (' ' + className) : '')}
    class:text-sm={size === 'sm'}
    class:text-md={size === 'md'}
    class:text-lg={size === 'lg'}
    class:text-xl={size === 'xl'}

    class:px-4={size === 'md' && padding}
    class:py-2={size === 'md' && padding}
    class:px-2={size === 'sm' && padding}
    class:py-1={size === 'sm' && padding}
    class:px-6={size === 'lg' || size === 'xl' && padding}
    class:py-3={size === 'lg' || size === 'xl'&& padding}

    class:mb-4={marginBottom}
    class:mt-4={marginTop}
    class:w-full={fullwidth}
    class:h-full={fullh}
    class:text-textcolor2={disabled}

    autocomplete={masked ? 'new-password' : autocomplete}
    {placeholder}
    id={id}
    type={masked ? 'password' : 'text'}
    value={value}
    {@attach writeBack}
    oninput={oninput}
    disabled={disabled}
    onchange={onchange}
    list={list}
/>

<script lang="ts">
    import { isSecretRef } from 'src/ts/secretRefPattern'

    type FormEventHandler<T extends EventTarget> = (event: Event & {
        currentTarget: EventTarget & T;
    }) => any

    interface Props {
        size?: 'sm'|'md'|'lg'|'xl';
        autocomplete?: 'on'|'off';
        placeholder?: string;
        value: string;
        id?: string;
        padding?: boolean;
        marginBottom?: boolean;
        marginTop?: boolean;
        oninput?: FormEventHandler<HTMLInputElement>
        onchange?: FormEventHandler<HTMLInputElement>;
        fullwidth?: boolean;
        fullh?: boolean;
        className?: string;
        disabled?: boolean;
        hideText?: boolean;
        list?: string;
    }

    let {
        size = 'md',
        autocomplete = 'off',
        placeholder = '',
        value = $bindable(),
        id = undefined,
        padding = true,
        marginBottom = false,
        marginTop = false,
        oninput,
        onchange,
        fullwidth = false,
        fullh = false,
        className = '',
        disabled = false,
        hideText = false,
        list = undefined

    }: Props = $props();

    // A value that is wholly a ${NAME} reference holds no secret, so it is shown as typed.
    let masked = $derived(hideText && !isSecretRef(value));

    // Listens on the element itself, like bind:value does, so the bound value is written before the
    // caller's delegated oninput runs and even when an input event does not bubble.
    function writeBack(node: HTMLInputElement) {
        const update = () => { value = node.value };
        node.addEventListener('input', update);
        return () => node.removeEventListener('input', update);
    }
</script>

<style>
    .hide-text:not(:focus):not(:hover) {
        text-indent: -9999px;
    }
</style>
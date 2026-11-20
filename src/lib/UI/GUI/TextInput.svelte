
<!-- Svelte doesn't allow two-way binding on an input with a dynamic type, so the value is written back by hand. -->

<!-- The screen-reader-only name goes before the input so the input stays the last sibling. -->
{#if !labelId && label.trim()}
    <span id={nameId} class="sr-only">{label}</span>
{/if}
<!-- One element for both states, so the caret and focus survive the masked/plain switch while typing. new-password disables autofill on the masked input. -->
<input
    class={"border border-darkborderc peer focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent risu-focus-ring transition-colors duration-200" + ((className) ? (' ' + className) : '')}
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
    aria-labelledby={nameId}
    aria-describedby={describedIds}
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
        /** Id of an existing visible label element that names the field. */
        labelId?: string;
        /** Name text for a field with no visible label; rendered as a screen-reader-only span. */
        label?: string;
        /** Extra description ids, listed after the naming element. */
        describedBy?: string;
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
        list = undefined,
        labelId = undefined,
        label = '',
        describedBy = undefined

    }: Props = $props();

    const uid = $props.id();

    // TalkBack speaks only the description in the field's own stop, so the naming element is also the first description.
    let nameId = $derived(labelId || (label.trim() ? `${uid}-label` : undefined));
    let describedIds = $derived([nameId, describedBy].filter(Boolean).join(' ') || undefined);

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
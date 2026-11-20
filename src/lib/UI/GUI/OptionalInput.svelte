<script lang="ts">
    import CheckInput from "./CheckInput.svelte";
    import { language } from "src/lang";
    import NumberInput from "./NumberInput.svelte";
    import TextInput from "./TextInput.svelte";
    import { fieldNameIds } from "./fieldNameIds";
    interface Props {
        value: string|number|boolean;
        numberMode?: boolean;
        boolMode?: boolean;
        marginBottom?: boolean;
        /** Id of an existing visible label element that names the inner field. */
        labelId?: string;
        /** Field label text: the checkbox name in every branch, and the inner field's screen-reader-only name when no labelId is given. */
        label?: string;
        /** Extra description ids for the inner field, listed after the naming element. */
        describedBy?: string;
    }

    let {
        value = $bindable(),
        numberMode = false,
        boolMode = false,
        marginBottom = false,
        labelId = undefined,
        label = '',
        describedBy = undefined
    }: Props = $props();

    const uid = $props.id();

    let ids = $derived(fieldNameIds(uid, labelId, label, describedBy));
    const valToggle = () => {
            value = !value
    }
</script>

<div class="flex items-center justify-center" class:mb-4={marginBottom}>
    {#if ids.srOnly}
        <span id={ids.nameId} class="sr-only">{label}</span>
    {/if}
    <div class="flex justify-center items-center border-darkborderc rounded-l-md rounded-t-md rounded-b-md border h-full">
        <CheckInput hiddenName {label} check={!(value === null || value === undefined)} onChange={() => {
            if(value === null || value === undefined){
                if(numberMode){
                    value = 0
                }
                else if(boolMode){
                    value = false
                }
                else{
                    value = ""
                }
            }
            else{
                value = null
            }
        }} />
    </div>

    {#if (value === null || value === undefined)}
        <TextInput value={language.uiCommon.usingDefault}  className="flex-1" disabled labelId={ids.nameId} {describedBy}/>
    {:else if typeof(value) === 'string'}
        <TextInput bind:value={value}  className="flex-1" labelId={ids.nameId} {describedBy}/>
    {:else if typeof(value) === 'number'}
        <NumberInput bind:value={value}  className="flex-1" labelId={ids.nameId} {describedBy}/>
    {:else if typeof(value) === 'boolean'}
        <button class="px-2 py-2 border border-darkborderc flex-1" class:text-textcolor2={!value} onclick={valToggle}>{language.uiCommon.trueLabel}</button>
        <button class="px-2 py-2 border border-darkborderc flex-1" class:text-textcolor2={value} onclick={valToggle}>{language.uiCommon.falseLabel}</button>
    {:else}
        <TextInput value={language.uiCommon.usingDefault}  className="flex-1" disabled labelId={ids.nameId} {describedBy}/>
    {/if}
</div>
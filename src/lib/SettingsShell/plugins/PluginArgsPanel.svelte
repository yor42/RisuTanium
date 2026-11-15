<script lang="ts">
    import { onDestroy } from 'svelte'
    import { language } from '../../../lang'
    import { commitPluginArg, type ArgCommitKind } from '../../../ts/setting/pluginArgCommit'
    import type { RisuPlugin } from '../../../ts/plugins/plugins.svelte'
    import { DBState } from '../../../ts/stores.svelte'
    import CheckInput from '../../UI/GUI/CheckInput.svelte'
    import OptionInput from '../../UI/GUI/OptionInput.svelte'
    import SelectInput from '../../UI/GUI/SelectInput.svelte'

    /**
     * The saved arguments of one plugin. Choices (select, radio, checkbox) save on change. Typed values
     * (text, textarea, number) are drafts: they save on blur, on Enter (not in a textarea) and when the panel
     * is torn down, never per keystroke, and a number that does not parse is refused and shown again as stored.
     */
    interface Props {
        plugin: RisuPlugin
    }

    let { plugin }: Props = $props()

    const uid = $props.id()
    const keys = $derived(Object.keys(plugin.arguments ?? {}).filter((key) => !key.startsWith('hidden_')))

    // Drafts are not rendered, so they are plain data; the inputs are uncontrolled and keep what was typed.
    const drafts = new Map<string, { kind: ArgCommitKind, raw: string }>()
    let invalidKey = $state<string | null>(null)

    const stored = (key: string): string => String(plugin.realArg?.[key] ?? '')

    function save(key: string, kind: ArgCommitKind, raw: string): void {
        drafts.delete(key)
        const result = commitPluginArg(DBState.db.plugins, plugin, key, kind, raw)
        invalidKey = result === 'invalid' ? key : null
    }

    function onDraft(key: string, kind: ArgCommitKind, event: Event & { currentTarget: HTMLInputElement | HTMLTextAreaElement }): void {
        if (invalidKey === key) invalidKey = null
        drafts.set(key, { kind, raw: event.currentTarget.value })
    }

    function commitField(key: string, kind: ArgCommitKind, field: HTMLInputElement | HTMLTextAreaElement): void {
        // A field the user never edited has no draft: leaving it must not write, coerce or complain.
        if (!drafts.has(key)) return
        save(key, kind, field.value)
        // A refused number shows the stored value again instead of the rejected text.
        if (kind === 'int' && invalidKey === key) field.value = stored(key)
    }

    function onEnter(key: string, kind: ArgCommitKind, event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
        if (event.key === 'Enter') commitField(key, kind, event.currentTarget)
    }

    onDestroy(() => {
        for (const [key, draft] of [...drafts]) {
            save(key, draft.kind, draft.raw)
        }
    })

    const fieldClass = 'border border-darkborderc focus:border-borderc rounded-md bg-transparent text-textcolor px-3 py-2 min-h-11 w-full focus:ring-borderc focus:ring-2 focus:outline-hidden'
</script>

<div class="flex flex-col pt-1" data-part="plugin-args">
    {#each keys as key, i (key)}
        {@const meta = plugin.argMeta?.[key]}
        {@const kind = plugin.arguments[key]}
        {@const fieldId = `${uid}-arg-${i}`}
        {@const hasField = kind === 'string' ? !meta?.radio : kind === 'int' ? !meta?.checkbox && !meta?.radio : false}
        {#if typeof meta?.divider === 'string'}
            {#if meta.divider}
                <div class="flex items-center mt-4">
                    <div aria-hidden="true" class="w-full border-t border-darkborderc"></div>
                    <span class="px-2 text-sm text-textcolor2 text-nowrap">{meta.divider}</span>
                    <div aria-hidden="true" class="w-full border-t border-darkborderc"></div>
                </div>
            {:else}
                <div aria-hidden="true" class="w-full border-t border-darkborderc mt-4"></div>
            {/if}
        {/if}
        {#if hasField}
            <label class="mb-1 mt-4" for={fieldId}>{meta?.name || key}</label>
        {:else}
            <span class="mb-1 mt-4" id="{fieldId}-label">{meta?.name || key}</span>
        {/if}
        {#if meta?.description}
            <span class="mb-1 text-sm text-textcolor2">{meta.description}</span>
        {/if}
        {#if Array.isArray(kind)}
            <div role="group" aria-labelledby="{fieldId}-label" class="flex flex-col">
                <SelectInput
                    className="mb-2 min-h-11"
                    value={stored(key)}
                    onchange={(event) => save(key, 'string', event.currentTarget.value)}
                >
                    {#each kind as option}
                        <OptionInput value={option}>{option}</OptionInput>
                    {/each}
                </SelectInput>
            </div>
        {:else if kind === 'string'}
            {#if meta?.textarea}
                <textarea
                    id={fieldId}
                    class="{fieldClass} min-h-24"
                    placeholder={meta?.placeholder}
                    value={stored(key)}
                    oninput={(event) => onDraft(key, 'string', event)}
                    onblur={(event) => commitField(key, 'string', event.currentTarget)}
                ></textarea>
            {:else if meta?.radio}
                <div role="radiogroup" aria-labelledby="{fieldId}-label" class="flex flex-col gap-1">
                    {#each meta.radio.split(',') as option}
                        <CheckInput
                            check={plugin.realArg?.[key] === option.split('|').at(-1)}
                            onChange={(on) => { if (on) save(key, 'string', option.split('|').at(-1) ?? '') }}
                            margin={false}
                            name={option.split('|').at(0)}
                        />
                    {/each}
                </div>
            {:else}
                <input
                    id={fieldId}
                    type="text"
                    class={fieldClass}
                    placeholder={meta?.placeholder}
                    value={stored(key)}
                    oninput={(event) => onDraft(key, 'string', event)}
                    onblur={(event) => commitField(key, 'string', event.currentTarget)}
                    onkeydown={(event) => onEnter(key, 'string', event)}
                />
            {/if}
        {:else if kind === 'int'}
            {#if meta?.checkbox}
                <CheckInput
                    check={plugin.realArg?.[key] === '1'}
                    onChange={(on) => save(key, 'string', on ? '1' : '0')}
                    margin={false}
                    name={meta.checkbox === '1' ? language.enable : meta.checkbox}
                />
            {:else if meta?.radio}
                <div role="radiogroup" aria-labelledby="{fieldId}-label" class="flex flex-col gap-1">
                    {#each meta.radio.split(',') as option}
                        <CheckInput
                            check={plugin.realArg?.[key] === parseInt(option.split('|').at(-1) ?? '')}
                            onChange={(on) => { if (on) save(key, 'int', option.split('|').at(-1) ?? '') }}
                            margin={false}
                            name={option.split('|').at(0)}
                        />
                    {/each}
                </div>
            {:else}
                <input
                    id={fieldId}
                    type="text"
                    inputmode="decimal"
                    class={fieldClass}
                    placeholder={meta?.placeholder}
                    value={stored(key)}
                    aria-invalid={invalidKey === key ? 'true' : undefined}
                    oninput={(event) => onDraft(key, 'int', event)}
                    onblur={(event) => commitField(key, 'int', event.currentTarget)}
                    onkeydown={(event) => onEnter(key, 'int', event)}
                />
                <span class="text-sm text-draculared" role="status" aria-live="polite" data-part="plugin-arg-invalid">{invalidKey === key ? language.pluginsPage.numberInvalid : ''}</span>
            {/if}
        {/if}
    {/each}
</div>

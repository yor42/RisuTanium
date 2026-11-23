<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import { isUsableContainer, slotOf } from '../../ts/studio/history/fieldAccess'
    import { FIELD_PRESENTATION, type SetPath } from '../../ts/studio/history/fieldRegistry'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService } from '../../ts/studio/history/studioHistoryService.svelte'
    import type { LongTextMode, LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import { DBState } from '../../ts/stores.svelte'
    import LongTextField from './LongTextField.svelte'
    import StudioCreatorNotesField from './StudioCreatorNotesField.svelte'
    import StudioRiskySection from './StudioRiskySection.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'

    // The text fields of the advanced kind that are not the example dialogue: the prompt texts and the character's
    // details. Every edit goes through the history service, which writes the live character, marks it for saving and
    // records the step. The history banner, the loading line and the retry button belong to the example form mounted
    // between the two sections under the same condition, so this form shows none of them: its fields are read-only
    // while the owner's history is not editable, and a refused write shows the refusal line of the section.
    type TextPath = Extract<SetPath, 'systemPrompt' | 'replaceGlobalNote' | 'additionalText' | 'personality' | 'scenario' | 'depth_prompt.prompt' | 'additionalData.creator' | 'additionalData.character_version' | 'nickname' | 'defaultVariables' | 'translatorNote'>

    interface LongSpec {
        path: TextPath
        label: () => string
        mode: LongTextMode
        // Shown only while it holds text or the unrecommended-fields setting is on (see `shown`).
        gated: boolean
    }
    interface LineSpec {
        path: TextPath
        label: () => string
    }

    interface Props {
        chaId: string
        section: 'prompts' | 'details'
    }

    let { chaId, section }: Props = $props()

    const PROMPTS: readonly LongSpec[] = [
        { path: 'systemPrompt', label: () => language.systemPrompt, mode: 'cbs', gated: false },
        { path: 'replaceGlobalNote', label: () => language.replaceGlobalNote, mode: 'cbs', gated: false },
        { path: 'additionalText', label: () => language.additionalText, mode: 'cbs', gated: false },
        { path: 'personality', label: () => language.personality, mode: 'cbs', gated: true },
        { path: 'scenario', label: () => language.scenario, mode: 'cbs', gated: true },
        { path: 'depth_prompt.prompt', label: () => language.depthPrompt, mode: 'cbs', gated: false },
    ]
    const LINES: readonly LineSpec[] = [
        { path: 'additionalData.creator', label: () => language.creator },
        { path: 'additionalData.character_version', label: () => language.CharVersion },
        { path: 'nickname', label: () => language.nickname },
    ]
    const DETAIL_LONG: readonly LongSpec[] = [
        { path: 'defaultVariables', label: () => language.defaultVariables, mode: 'plain', gated: false },
        { path: 'translatorNote', label: () => language.translatorNote, mode: 'plain', gated: false },
    ]

    const owner = characterOwnerKey(untrack(() => chaId))

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (service) {
            untrack(() => beginOwnerVisit(owner))
        } else {
            ensureStudioHistory()
        }
    })

    const live = $derived.by(() => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    const previewSource = (): PreviewSourceInput => ({ owner: live ?? null, chat: live?.chats?.[live.chatPage] ?? null, globals: DBState.db.globalChatVariables ?? {} })
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(live === undefined || live.license === 'private' || view?.restricted === true)
    const editable = $derived(view?.editable === true)

    // The live text of a path as a string. A key or container that is absent (or not a string) reads as empty: an
    // absent container is the empty text of its seed, and a write to an absent required key is refused by the service.
    function readText(path: TextPath): string {
        if (!live) return ''
        const { container, key } = slotOf(path)
        const holder = live as unknown as Record<string, unknown>
        const box = container === null ? holder : holder[container]
        if (!isUsableContainer(box)) return ''
        const value = box[key]
        return typeof value === 'string' ? value : ''
    }

    function partOf(path: TextPath): string {
        const focus = FIELD_PRESENTATION[path].focus
        return focus !== null && typeof focus === 'object' ? focus.part : ''
    }

    // The personality and the scenario are shown while they hold text of any length or the unrecommended-fields
    // setting is on. A field that was shown stays shown until this form unmounts, so a cleared field (or an undo that
    // empties it) keeps the element the history focus target names.
    let latched = $state<Record<string, boolean>>({})
    $effect(() => {
        for (const spec of PROMPTS) {
            if (spec.gated && readText(spec.path) !== '') untrack(() => { latched[spec.path] = true })
        }
    })
    function shown(spec: LongSpec): boolean {
        return !spec.gated || latched[spec.path] === true || readText(spec.path) !== '' || DBState.db.showUnrecommended === true
    }

    let refusal = $state<StudioRefusal | null>(null)

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    // A null result means there was no write path: the refusal line stays as it was.
    function onFieldResult(result: StudioResult | null): void {
        if (result) noted(result)
    }

    function portOf(path: TextPath): LongTextWritePort {
        return {
            read: () => readText(path),
            write: (value) => (service && editable ? service.editText(owner, path, value, 'typing') : null),
            closeStep: () => service?.closeOpenStep(owner),
        }
    }
    const ports: Partial<Record<TextPath, LongTextWritePort>> = {}
    function port(path: TextPath): LongTextWritePort {
        return (ports[path] ??= portOf(path))
    }

    // The single-line fields write through a composition gate: nothing is written while an IME composes, the composed
    // value is written once, and a refused write puts the live value back into the input.
    const inputs: Partial<Record<TextPath, HTMLInputElement>> = {}
    function track(element: HTMLInputElement, path: TextPath): { destroy(): void } {
        inputs[path] = element
        return { destroy: () => { if (inputs[path] === element) delete inputs[path] } }
    }
    function commitLine(path: TextPath, value: string): void {
        const element = inputs[path]
        const result = service && editable ? service.editText(owner, path, value, 'typing') : null
        if ((result === null || !noted(result)) && element) element.value = readText(path)
    }
    const gates = new Map<TextPath, ReturnType<typeof createCompositionGate>>()
    function gateOf(path: TextPath): ReturnType<typeof createCompositionGate> {
        let gate = gates.get(path)
        if (!gate) {
            gate = createCompositionGate((value) => commitLine(path, value))
            gates.set(path, gate)
        }
        return gate
    }

    function onLineInput(path: TextPath, event: Event & { currentTarget: HTMLInputElement }): void {
        gateOf(path).input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }

    function onLineBlur(path: TextPath): void {
        gateOf(path).flush()
        service?.closeOpenStep(owner)
    }

    onDestroy(() => {
        for (const gate of gates.values()) gate.flush()
        service?.closeOpenStep(owner)
    })

    const longSpecs = $derived(section === 'prompts' ? PROMPTS : DETAIL_LONG)
    const lineSpecs = $derived(section === 'details' ? LINES : [])
    const idBase = $props.id()
</script>

{#if live && !hidden}
    <section data-part="studio-advanced-form" data-section={section} class="flex flex-col gap-3" aria-busy={editable ? undefined : 'true'}>
        {#each lineSpecs as spec (spec.path)}
            <div class="flex flex-col gap-1">
                <label for="{idBase}-{spec.path}" class="font-bold">{spec.label()}</label>
                <input
                    id="{idBase}-{spec.path}"
                    type="text"
                    data-part={partOf(spec.path)}
                    class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                    readonly={!editable}
                    aria-busy={editable ? undefined : 'true'}
                    value={readText(spec.path)}
                    use:track={spec.path}
                    oninput={(event) => onLineInput(spec.path, event)}
                    oncompositionstart={() => gateOf(spec.path).start()}
                    oncompositionend={(event) => { gateOf(spec.path).end(event.currentTarget.value) }}
                    onblur={() => onLineBlur(spec.path)}
                />
            </div>
        {/each}
        {#each longSpecs as spec (spec.path)}
            {#if shown(spec)}
                <LongTextField
                    port={port(spec.path)}
                    part={partOf(spec.path)}
                    label={spec.label()}
                    kind="advanced"
                    mode={spec.mode}
                    ownerLabel={live.name}
                    {previewSource}
                    {editable}
                    busy={!editable}
                    fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                    onresult={onFieldResult}
                />
            {/if}
        {/each}
        {#if section === 'details'}
            <StudioCreatorNotesField {chaId} {owner} {service} {editable} ownerLabel={live.name} {previewSource} onresult={onFieldResult} />
            <StudioRiskySection {chaId} {owner} {service} {editable} />
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}

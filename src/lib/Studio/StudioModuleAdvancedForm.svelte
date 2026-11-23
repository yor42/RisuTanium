<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import type { RisuModule } from '../../ts/process/modules'
    import { isModuleStub } from '../../ts/storage/moduleStub'
    import { lowLevelAskName, runWithLowLevelConfirm } from '../../ts/studio/edit/lowLevelConfirm.svelte'
    import { integrationNoteOf, namespaceUnmatchable, readStored, sharedNamespaceNames } from '../../ts/studio/edit/moduleNamespaceNotes'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { FIELD_PRESENTATION, type SetPath } from '../../ts/studio/history/fieldRegistry'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginModuleAck, beginOwnerVisit, endModuleAck, ensureStudioHistory, getStudioHistoryService } from '../../ts/studio/history/studioHistoryService.svelte'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import { DBState } from '../../ts/stores.svelte'
    import LongTextField from './LongTextField.svelte'

    // The module-level fields of one loaded module: the 고급 form (name, description, namespace, hide icon and the risky
    // Low Level Access switch) and the 배경 HTML form (the module's background embedding). Every edit goes through the
    // history service, which writes the live module, marks it for saving and records the step. The module is read on every
    // render by id, never kept from mount, because a Studio write replaces the slot object.
    type TextPath = Extract<SetPath, 'moduleName' | 'moduleDescription' | 'moduleNamespace' | 'backgroundEmbedding'>
    type FlagPath = Extract<SetPath, 'moduleHideIcon' | 'moduleLowLevelAccess'>
    type LongPath = Extract<TextPath, 'moduleDescription' | 'backgroundEmbedding'>

    interface Props {
        section: 'advanced' | 'html'
        // The module's stored id and the place of its slot in the module list.
        moduleId: string
        slotIndex: number
        // A module whose id another row shares: the values of the given slot only, no control writes.
        readOnlyShared?: boolean
    }

    let { section, moduleId, slotIndex, readOnlyShared = false }: Props = $props()

    const owner = moduleOwnerKey(untrack(() => moduleId))
    const NAME: TextPath = 'moduleName'
    const DESCRIPTION: LongPath = 'moduleDescription'
    const NAMESPACE: TextPath = 'moduleNamespace'
    const BACKGROUND: LongPath = 'backgroundEmbedding'
    const HIDE_ICON: FlagPath = 'moduleHideIcon'
    const LOW_LEVEL: FlagPath = 'moduleLowLevelAccess'

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (service) {
            untrack(() => {
                if (readOnlyShared) return
                beginOwnerVisit(owner)
                beginModuleAck(moduleId)
            })
        } else if (!readOnlyShared) {
            ensureStudioHistory()
        }
    })

    // The shared view reads the given slot only: a search by id would pick the first holder, which can be another row.
    const live = $derived.by((): RisuModule | undefined => {
        const modules = DBState.db.modules ?? []
        const at = modules[slotIndex]
        const found = at && at.id === moduleId ? at : readOnlyShared ? undefined : modules.find((row) => row?.id === moduleId)
        return found && !isModuleStub(found) ? found : undefined
    })
    const view = $derived(service && !readOnlyShared ? service.view(owner) : null)
    const editable = $derived(view?.editable === true && live !== undefined)

    const nameRead = $derived(readStored(live?.name, 'text'))
    const descriptionRead = $derived(readStored(live?.description, 'text'))
    const namespaceRead = $derived(readStored(live?.namespace, 'text'))
    const hideIconRead = $derived(readStored(live?.hideIcon, 'bool'))
    const lowLevelRead = $derived(readStored(live?.lowLevelAccess, 'bool'))
    const backgroundRead = $derived(readStored(live?.backgroundEmbedding, 'text'))

    function partOf(path: SetPath): string {
        const focus = FIELD_PRESENTATION[path].focus
        return focus !== null && typeof focus === 'object' ? focus.part : ''
    }

    let refusal = $state<Extract<StudioResult, { ok: false }> | null>(null)
    let announcement = $state('')

    function noted(result: StudioResult | null): boolean {
        refusal = result !== null && result.ok === false && result.cancelled !== true ? result : null
        return result !== null && result.ok
    }

    // The single-line name writes through a composition gate: nothing is written while an IME composes, the composed
    // value is written once, and a refused write puts the live value back into the input.
    let nameInput = $state<HTMLInputElement | undefined>()
    function commitName(value: string): void {
        const result = service && editable ? service.editText(owner, NAME, value, 'typing') : null
        if ((result === null || !noted(result)) && nameInput) nameInput.value = nameRead.text
    }
    const nameGate = createCompositionGate(commitName)

    function onNameInput(event: Event & { currentTarget: HTMLInputElement }): void {
        nameGate.input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }

    function onNameBlur(): void {
        nameGate.flush()
        service?.closeOpenStep(owner)
    }

    // The namespace commits as one step on blur or Enter, and only when the draft differs from the value shown: a focus
    // and blur with no typing writes and marks nothing.
    let namespaceInput = $state<HTMLInputElement | undefined>()
    let draft = $state<string | null>(null)
    // The namespace before the last landed write (a foreign value counts as none), for the Module Integration note.
    let changedFrom = $state<string | null>(null)

    function commitNamespace(): void {
        const value = draft
        draft = null
        if (value === null || value === namespaceRead.text) return
        const before = namespaceRead.text
        const result = service && editable ? service.editText(owner, NAMESPACE, value, 'single') : null
        if (noted(result)) {
            if (result !== null && result.ok && result.unchanged !== true) changedFrom = before
        } else if (namespaceInput) {
            namespaceInput.value = namespaceRead.text
        }
    }

    function onNamespaceKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
        event.preventDefault()
        commitNamespace()
    }

    function portOf(path: LongPath): LongTextWritePort {
        return {
            read: () => (live === undefined ? null : path === DESCRIPTION ? descriptionRead.text : backgroundRead.text),
            write: (value) => (service && editable ? service.editText(owner, path, value, 'typing') : null),
            closeStep: () => service?.closeOpenStep(owner),
        }
    }
    const descriptionPort = portOf(DESCRIPTION)
    const backgroundPort = portOf(BACKGROUND)

    // A switch shows the live reading. The input is put back to it at once, so a press that is refused or waits for the
    // confirm leaves the control where the engine reads the flag.
    let confirming = false
    async function onFlagChange(path: FlagPath, element: HTMLInputElement): Promise<void> {
        const reading = path === HIDE_ICON ? hideIconRead : lowLevelRead
        element.checked = reading.on
        const active: OwnerHistoryService | null = service
        if (!active || !editable) return
        const next = !reading.on
        if (path !== LOW_LEVEL) {
            noted(active.editField(owner, path, next))
            return
        }
        if (confirming) return
        confirming = true
        try {
            const first = active.editField(owner, path, next)
            const result = next ? await runWithLowLevelConfirm(first, lowLevelAskName(owner), (confirm) => active.editField(owner, path, true, confirm)) : first
            if (noted(result) && next && result.ok && result.unchanged !== true) announcement = language.studioModAdvLowLevelOn(lowLevelAskName(owner))
        } finally {
            confirming = false
        }
    }

    onDestroy(() => {
        nameGate.flush()
        commitNamespace()
        if (!readOnlyShared) {
            service?.closeOpenStep(owner)
            endModuleAck(moduleId)
        }
    })

    const ownIndex = $derived.by(() => {
        const modules = DBState.db.modules ?? []
        return modules[slotIndex]?.id === moduleId ? slotIndex : modules.findIndex((row) => row?.id === moduleId)
    })
    const sharedWith = $derived(live === undefined ? [] : sharedNamespaceNames(namespaceRead.text, DBState.db.modules ?? [], ownIndex))
    const integrationNote = $derived(integrationNoteOf(changedFrom, namespaceRead.text, DBState.db.moduleIntergration ?? ''))
    const idBase = $props.id()
    const inputClass = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const sectionClass = 'flex flex-col gap-3 rounded-md border border-darkborderc p-3'
    const rowClass = 'flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-darkborderc p-2'
</script>

{#snippet foreignNote(stored: string | null)}
    {#if stored !== null}
        <p data-part="studio-field-note" class="text-sm text-textcolor2">{language.studioModAdvValueForeign(stored)}</p>
    {/if}
{/snippet}

{#snippet longField(path: LongPath, label: string, mode: 'plain' | 'html+cbs', foreign: string | null)}
    <div class="flex flex-col gap-1">
        <LongTextField
            port={path === DESCRIPTION ? descriptionPort : backgroundPort}
            part={partOf(path)}
            {label}
            kind="advanced"
            {mode}
            ownerLabel={nameRead.text}
            {editable}
            busy={!editable}
            fieldClass="min-h-20 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
            onresult={(result) => { noted(result) }}
        />
        {@render foreignNote(foreign)}
    </div>
{/snippet}

{#snippet flagRow(path: FlagPath, id: string, label: string, hint: string, reading: { on: boolean, foreign: string | null }, describedBy: string)}
    <div class="flex flex-col gap-1">
        <label class={rowClass}>
            <span class="min-w-0 flex-1">
                <span class="block font-bold">{label}</span>
                <span id={id} class="block text-sm text-textcolor2">{hint}</span>
            </span>
            {#if path === HIDE_ICON}
                <input
                    type="checkbox"
                    role="switch"
                    data-part="studio-module-hide-icon"
                    aria-label={label}
                    aria-describedby={describedBy}
                    disabled={!editable}
                    aria-busy={editable ? undefined : 'true'}
                    checked={reading.on}
                    onchange={(event) => { void onFlagChange(path, event.currentTarget) }}
                />
            {:else}
                <input
                    type="checkbox"
                    role="switch"
                    data-part="studio-module-low-level"
                    aria-label={label}
                    aria-describedby={describedBy}
                    disabled={!editable}
                    aria-busy={editable ? undefined : 'true'}
                    checked={reading.on}
                    onchange={(event) => { void onFlagChange(path, event.currentTarget) }}
                />
            {/if}
        </label>
        {@render foreignNote(reading.foreign)}
    </div>
{/snippet}

{#snippet readFlag(label: string, reading: { on: boolean, foreign: string | null })}
    <div class="flex items-center justify-between gap-3">
        <span class="font-bold">{label}</span>
        <input type="checkbox" role="switch" disabled aria-label={label} checked={reading.on} />
    </div>
    {@render foreignNote(reading.foreign)}
{/snippet}

{#if live}
    {#if section === 'advanced'}
        <section data-part="studio-module-advanced-form" class="mx-auto flex w-full max-w-3xl flex-col gap-3" aria-busy={editable || readOnlyShared ? undefined : 'true'}>
            {#if readOnlyShared}
                <p role="status" data-part="studio-module-shared" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioRefusalModuleSharedId}</p>
                <dl data-part="studio-module-shared-values" class="flex flex-col gap-2">
                    <div><dt class="font-bold">{language.name}</dt><dd data-part="studio-module-shared-name" class="break-words">{nameRead.text}</dd></div>
                    <div><dt class="font-bold">{language.description}</dt><dd data-part="studio-module-shared-description" class="whitespace-pre-wrap break-words">{descriptionRead.text}</dd></div>
                    <div><dt class="font-bold">{language.namespace}</dt><dd data-part="studio-module-shared-namespace" class="break-words">{namespaceRead.text}</dd></div>
                </dl>
                {@render readFlag(language.hideChatIcon, hideIconRead)}
                {@render readFlag(language.lowLevelAccess, lowLevelRead)}
            {:else}
                <section data-part="studio-form-section" data-section="info" class={sectionClass}>
                    <h3 data-part="studio-form-section-header" class="font-bold">{language.studioModAdvSectionInfo}</h3>
                    <div class="flex flex-col gap-1">
                        <label for="{idBase}-name" class="font-bold">{language.name}</label>
                        <input
                            id="{idBase}-name"
                            type="text"
                            data-part="studio-module-name"
                            class={inputClass}
                            readonly={!editable}
                            aria-busy={editable ? undefined : 'true'}
                            value={nameRead.text}
                            bind:this={nameInput}
                            oninput={onNameInput}
                            oncompositionstart={() => nameGate.start()}
                            oncompositionend={(event) => { nameGate.end(event.currentTarget.value) }}
                            onblur={onNameBlur}
                        />
                        {#if nameRead.text === ''}
                            <p data-part="studio-field-note" class="text-sm text-textcolor2">{language.studioModAdvNameEmpty}</p>
                        {/if}
                        {@render foreignNote(nameRead.foreign)}
                    </div>
                    {@render longField(DESCRIPTION, language.description, 'plain', descriptionRead.foreign)}
                    <div class="flex flex-col gap-1">
                        <label for="{idBase}-namespace" class="font-bold">{language.namespace}</label>
                        <input
                            id="{idBase}-namespace"
                            type="text"
                            data-part="studio-module-namespace"
                            class={inputClass}
                            readonly={!editable}
                            aria-busy={editable ? undefined : 'true'}
                            value={namespaceRead.text}
                            bind:this={namespaceInput}
                            oninput={(event) => { draft = event.currentTarget.value }}
                            onkeydown={onNamespaceKeydown}
                            onblur={commitNamespace}
                        />
                        <details data-part="studio-field-help" class="rounded-md border border-darkborderc p-2">
                            <summary class="min-h-11 cursor-pointer">{language.helpBlock}</summary>
                            <p class="whitespace-pre-wrap text-sm text-textcolor2">{language.help.namespace}</p>
                        </details>
                        {#each sharedWith.slice(0, 1) as other}
                            <p data-part="studio-field-note" class="text-sm text-textcolor2">{language.studioModAdvNamespaceShared(other === '' ? language.modules : other)}</p>
                        {/each}
                        {#if namespaceUnmatchable(namespaceRead.text)}
                            <p data-part="studio-field-note" class="text-sm text-textcolor2">{language.studioModAdvNamespaceUnmatchable}</p>
                        {/if}
                        {#if integrationNote}
                            <p data-part="studio-module-integration-note" class="text-sm text-textcolor2">{integrationNote.kind === 'off' ? language.studioModAdvNamespaceIntegrationOff(integrationNote.before, integrationNote.after) : language.studioModAdvNamespaceIntegrationOn(integrationNote.after)}</p>
                        {/if}
                        {@render foreignNote(namespaceRead.foreign)}
                    </div>
                </section>
                <section data-part="studio-form-section" data-section="display" class={sectionClass}>
                    <h3 data-part="studio-form-section-header" class="font-bold">{language.studioModAdvSectionDisplay}</h3>
                    {@render flagRow(HIDE_ICON, `${idBase}-hide-icon-hint`, language.hideChatIcon, language.studioModAdvHideIconHint, hideIconRead, `${idBase}-hide-icon-hint`)}
                </section>
                <section data-part="studio-module-risky" data-section="risky" class={sectionClass}>
                    <h3 data-part="studio-form-section-header" class="font-bold">{language.studioModAdvSectionRisky}</h3>
                    <p id="{idBase}-risky-warning" data-part="studio-module-risky-warning" class="text-sm text-draculared">{language.studioModAdvRiskyWarning}</p>
                    {@render flagRow(LOW_LEVEL, `${idBase}-low-level-hint`, language.lowLevelAccess, language.studioModAdvLowLevelHint, lowLevelRead, `${idBase}-low-level-hint ${idBase}-risky-warning`)}
                    <details data-part="studio-field-help" class="rounded-md border border-darkborderc p-2">
                        <summary class="min-h-11 cursor-pointer">{language.helpBlock}</summary>
                        <p class="whitespace-pre-wrap text-sm text-textcolor2">{language.help.lowLevelAccess}</p>
                    </details>
                </section>
                {#if refusal}
                    <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalTextOf(refusal, owner)}</p>
                {/if}
                <p role="status" aria-live="polite" data-part="studio-module-announce" class="sr-only">{announcement}</p>
            {/if}
        </section>
    {:else}
        <section data-part="studio-module-html-form" class="mx-auto flex w-full max-w-3xl flex-col gap-2" aria-busy={editable || readOnlyShared ? undefined : 'true'}>
            {#if readOnlyShared}
                <p role="status" data-part="studio-module-shared" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioRefusalModuleSharedId}</p>
                <p class="font-bold">{language.backgroundHTML}</p>
                <pre data-part="studio-module-shared-background" class="whitespace-pre-wrap break-words rounded-md border border-darkborderc bg-darkbg p-3 font-sans">{backgroundRead.text}</pre>
                {@render foreignNote(backgroundRead.foreign)}
            {:else}
                {@render longField(BACKGROUND, language.backgroundHTML, 'html+cbs', backgroundRead.foreign)}
                <details data-part="studio-field-help" class="rounded-md border border-darkborderc p-2">
                    <summary class="min-h-11 cursor-pointer">{language.helpBlock}</summary>
                    <p class="whitespace-pre-wrap text-sm text-textcolor2">{language.help.backgroundHTML}</p>
                </details>
                <p data-part="studio-module-background-hint" class="text-sm text-textcolor2">{language.studioModAdvBackgroundHint}</p>
                {#if refusal}
                    <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalTextOf(refusal, owner)}</p>
                {/if}
            {/if}
        </section>
    {/if}
{/if}

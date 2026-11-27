<script lang="ts">
    import { onDestroy, onMount, untrack } from 'svelte'
    import { PlusIcon, UserIcon, XIcon } from '@lucide/svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { buildAddMember, buildRemoveMember, buildSetActive, buildSetTalk, memberRowModel, talkIsLevel, talkOfLevel, type MemberRowModel } from '../../ts/studio/edit/groupMembers'
    import { membersReadable } from '../../ts/studio/edit/groupTarget'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { groupOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText } from '../../ts/studio/history/studioHistoryService.svelte'
    import { selectedStudioCharacterId, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import { DBState } from '../../ts/stores.svelte'

    // The group form: the name, the members and the "talk by order" flag of the selected group. Every edit goes through
    // the history service, one step per user action; a member edit writes the three parallel arrays together or not at
    // all. Adding a member never writes to the chat.
    interface Props {
        chaId: string
    }

    let { chaId }: Props = $props()

    const owner = groupOwnerKey(untrack(() => chaId))
    const idBase = $props.id()
    const LEVELS = [1, 2, 3, 4, 5, 6] as const

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (service) {
            untrack(() => beginOwnerVisit(owner))
        } else {
            ensureStudioHistory()
        }
    })

    function liveGroupNow() {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type === 'group' && !found.coldstorage ? found : undefined
    }

    const live = $derived.by(liveGroupNow)
    const view = $derived(service ? service.view(owner) : null)
    const editable = $derived(view?.editable === true)
    const banner = $derived(view ? historyBannerText(view.banner) : null)
    // Null when the three arrays disagree or are not arrays: the members are then neither listed nor written.
    const rows = $derived(live ? memberRowModel(membersReadable(live), DBState.db.characters ?? []) : null)
    const membersOpen = $derived(editable && rows !== null)

    let refusal = $state<StudioRefusal | null>(null)
    let root = $state<HTMLElement | undefined>()
    let addButton = $state<HTMLButtonElement | undefined>()
    let adding = $state(false)
    let destroyed = false

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    // ---------------------------------------------------------------- name

    // The single-line name writes through a composition gate: nothing is written while an IME composes, the composed
    // value is written once. A value that is empty after trim is never written; leaving the field empty puts the name it
    // had at focus back and says why.
    let nameInput = $state<HTMLInputElement | undefined>()
    let nameEmpty = $state(false)
    let nameAtFocus = ''
    function commitName(value: string): void {
        if (value.trim() === '') return
        nameEmpty = false
        const result = service && editable ? service.editText(owner, 'name', value, 'typing') : null
        if ((result === null || !noted(result)) && nameInput) nameInput.value = live?.name ?? ''
    }
    const nameGate = createCompositionGate(commitName)
    // A page hide writes a composition still held in the name field.
    onMount(() => registerStudioField(() => nameGate.flush()))

    function onNameInput(event: Event & { currentTarget: HTMLInputElement }): void {
        nameGate.input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }

    function onNameBlur(event: FocusEvent & { currentTarget: HTMLInputElement }): void {
        nameGate.flush()
        service?.closeOpenStep(owner)
        const field = event.currentTarget
        if (field.value.trim() === '') {
            // The name goes back to what it was when the field took focus, not to the last non-empty keystroke.
            if (service && editable && live && nameAtFocus.trim() !== '' && live.name !== nameAtFocus) {
                if (noted(service.editText(owner, 'name', nameAtFocus, 'single'))) service.closeOpenStep(owner)
            }
            field.value = live?.name ?? ''
            nameEmpty = true
        }
    }

    function onNameFocus(): void {
        nameAtFocus = live?.name ?? ''
    }

    function onOrderByOrderChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const field = event.currentTarget
        if (!service || !editable || !noted(service.editField(owner, 'orderByOrder', field.checked))) {
            field.checked = live?.orderByOrder === true
            return
        }
        // A toggle is one discrete action: it never joins the next one's step.
        service.closeOpenStep(owner)
    }

    // ---------------------------------------------------------------- members

    function displayName(row: MemberRowModel): string {
        // A missing member has no name to show: its id stands in, and the tag says it is missing.
        return row.name === null || row.name === '' ? row.chaId : row.name
    }

    function tagText(row: MemberRowModel): string | null {
        return row.tag === 'archived' ? language.studioGroupMemberArchived : row.tag === 'missing' ? language.studioGroupMemberMissing : null
    }

    // Where focus goes once the rows have rendered: a member row, or the Add button.
    async function focusAfter(target: string | null): Promise<void> {
        await afterFlush()
        if (destroyed) return
        const row = target === null ? null : Array.from(root?.querySelectorAll<HTMLElement>('[data-part="studio-group-member"]') ?? []).find((candidate) => candidate.dataset.chaId === target) ?? null
        if (row) row.focus()
        else addButton?.focus()
    }

    // A member control writes the member it was drawn for, found by its chaId when the write runs.
    function run(result: StudioResult): boolean {
        const ok = noted(result)
        if (ok) service?.closeOpenStep(owner)
        return ok
    }

    function setTalk(row: MemberRowModel, level: number): void {
        if (!service || !membersOpen) return
        // A tap on the level it already holds writes nothing and is not a refusal.
        run(service.objEdit(owner, buildSetTalk(row.chaId, row.name, talkOfLevel(level))))
    }

    function setActive(row: MemberRowModel, event: Event & { currentTarget: HTMLInputElement }): void {
        const field = event.currentTarget
        if (!service || !membersOpen || !run(service.objEdit(owner, buildSetActive(row.chaId, row.name, field.checked)))) {
            field.checked = row.active
        }
    }

    function removeMember(row: MemberRowModel): void {
        if (!service || !membersOpen) return
        const next = rows?.[row.index + 1]?.chaId ?? null
        if (run(service.objEdit(owner, buildRemoveMember(row.chaId, row.name)))) void focusAfter(next)
    }

    // True while the visit that opened the picker is still this visit, on this group, with the group still in the database.
    function visitIs(visit: string): boolean {
        return !destroyed && studioScreen.open && studioScreen.visitId === visit && studioScreen.chaId === chaId && selectedStudioCharacterId() === chaId && liveGroupNow() !== undefined
    }

    function holderOf(id: string) {
        return DBState.db.characters?.find((candidate) => candidate?.chaId === id)
    }

    function isMemberNow(id: string): boolean {
        const group = liveGroupNow()
        const arrays = group ? membersReadable(group) : null
        return arrays !== null && arrays.characters.includes(id)
    }

    // The picker, the restore of an archived candidate and the write are separated by awaits. Each continuation asks
    // again whether this visit and group are still the ones that began it, and the builder checks the duplicate again
    // against the live list when the write runs.
    async function addMember(): Promise<void> {
        if (!service || !membersOpen || adding) return
        const visit = studioScreen.visitId
        adding = true
        try {
            // Loaded on demand: the alert, the cold store and the character module are heavy and are needed by this action alone.
            const { alertError, alertSelectChar } = await import('../../ts/alert')
            const picked: unknown = await alertSelectChar()
            if (typeof picked !== 'string' || picked === '' || !visitIs(visit)) return
            if (isMemberNow(picked)) {
                alertError(language.errors.alreadyCharInGroup)
                return
            }
            if (holderOf(picked)?.coldstorage) {
                // No further await sits between the restore and the format update that uses its index.
                const [{ characterFormatUpdate }, { restoreArchivedForWrite }] = await Promise.all([import('../../ts/characters'), import('../../ts/process/coldCharacterAccess')])
                const target = await restoreArchivedForWrite(picked)
                if (!visitIs(visit) || target.status === 'gone') return
                if (target.status === 'ready') characterFormatUpdate(target.index)
            }
            if (!visitIs(visit)) return
            const holder = holderOf(picked)
            const result = service.objEdit(owner, buildAddMember(picked, typeof holder?.name === 'string' ? holder.name : null))
            if (result.ok === false && result.reason === 'precondition' && isMemberNow(picked)) {
                alertError(language.errors.alreadyCharInGroup)
                return
            }
            if (run(result)) void focusAfter(picked)
        } finally {
            adding = false
        }
    }

    onDestroy(() => {
        destroyed = true
        nameGate.flush()
        service?.closeOpenStep(owner)
    })
</script>

{#if live}
    <section bind:this={root} tabindex="-1" data-part="studio-group-form" data-cha-id={chaId} data-phase={view?.phase ?? 'unused'} class="flex flex-col gap-3 outline-none" aria-busy={editable ? undefined : 'true'}>
        {#if !editable}
            <p data-part="studio-form-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
        {/if}
        {#if banner}
            <p role="status" data-part="studio-form-banner" data-banner={view?.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        <div class="flex flex-col gap-1">
            <label id="{idBase}-name-label" for="{idBase}-name" class="font-bold">{language.sidebarUi.groupName}</label>
            <input
                id="{idBase}-name"
                aria-labelledby="{idBase}-name-label"
                type="text"
                data-part="studio-form-name"
                class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                readonly={!editable}
                aria-busy={editable ? undefined : 'true'}
                value={live.name}
                bind:this={nameInput}
                oninput={onNameInput}
                oncompositionstart={() => nameGate.start()}
                oncompositionend={(event) => { nameGate.end(event.currentTarget.value) }}
                onfocus={onNameFocus}
                onblur={onNameBlur}
            />
            {#if nameEmpty}
                <p data-part="studio-field-note" class="text-sm text-textcolor2">{language.studioFormNameEmpty}</p>
            {/if}
        </div>
        <div class="flex flex-col gap-2" data-part="studio-group-members">
            <h3 id="{idBase}-members-label" class="font-bold">{language.character}</h3>
            {#if rows === null}
                <p role="note" data-part="studio-group-members-mismatch" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioGroupMembersMismatch}</p>
            {:else if rows.length === 0}
                <p data-part="studio-group-members-empty" class="text-textcolor2">{language.sidebarUi.noCharacter}</p>
            {:else}
                <ul role="list" aria-labelledby="{idBase}-members-label" data-part="studio-group-member-list" class="flex flex-col gap-2">
                    {#each rows as row (row.index)}
                        <li data-part="studio-group-member" data-cha-id={row.chaId} data-tag={row.tag ?? undefined} tabindex="-1" class="flex flex-col gap-2 rounded-md border border-darkborderc bg-darkbg p-2 outline-none sm:flex-row sm:items-center">
                            <div class="flex min-w-0 flex-1 items-center gap-2">
                                <span data-part="studio-group-member-icon" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-darkbutton text-textcolor2"><UserIcon size={20} aria-hidden="true" /></span>
                                <span data-part="studio-group-member-name" class="min-w-0 flex-1 truncate">{displayName(row)}</span>
                                {#if tagText(row) !== null}
                                    <span data-part="studio-group-member-tag" data-tag={row.tag} class="shrink-0 rounded border border-darkborderc px-1 text-xs text-textcolor2">{tagText(row)}</span>
                                {/if}
                            </div>
                            <div role="group" aria-label="{language.talkness}: {displayName(row)}" data-part="studio-group-member-talk" class="flex flex-1 items-stretch gap-1">
                                {#each LEVELS as level (level)}
                                    <button
                                        type="button"
                                        data-part="studio-group-talk"
                                        data-level={level}
                                        aria-label={language.groupTalkLevel(level)}
                                        aria-pressed={talkIsLevel(row.talk, level)}
                                        disabled={!membersOpen}
                                        class="min-h-11 min-w-9 flex-1 rounded-md border border-darkborderc cursor-pointer disabled:cursor-default {row.talk !== null && row.talk >= talkOfLevel(level) - 1e-9 ? 'bg-textcolor2' : 'bg-selected'}"
                                        onclick={() => setTalk(row, level)}
                                    ></button>
                                {/each}
                            </div>
                            <div class="flex items-center justify-between gap-2">
                                <label class="flex min-h-11 items-center gap-2">
                                    <input type="checkbox" data-part="studio-group-member-active" aria-label="{language.active}: {displayName(row)}" checked={row.active} disabled={!membersOpen} onchange={(event) => setActive(row, event)} />
                                    <span>{language.active}</span>
                                </label>
                                <button type="button" data-part="studio-group-member-remove" aria-label="{language.remove}: {displayName(row)}" title={language.remove} disabled={!membersOpen} class="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-darkborderc hover:bg-selected cursor-pointer disabled:cursor-default" onclick={() => removeMember(row)}>
                                    <XIcon size={18} aria-hidden="true" />
                                </button>
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
            <button bind:this={addButton} type="button" data-part="studio-group-add" disabled={!membersOpen || adding} class="flex min-h-11 items-center gap-1 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default" onclick={() => void addMember()}>
                <PlusIcon size={16} aria-hidden="true" /><span>{language.addCharacter}</span>
            </button>
        </div>
        <label class="flex min-h-11 items-center gap-2">
            <input type="checkbox" data-part="studio-group-order-by-order" disabled={!editable} aria-busy={editable ? undefined : 'true'} checked={live.orderByOrder === true} onchange={onOrderByOrderChange} />
            <span>{language.orderByOrder}</span>
        </label>
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}

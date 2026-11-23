<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { languageName, notesLanguages, withLanguageBody } from '../../ts/studio/edit/creatorNotesLanguages'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { DBState } from '../../ts/stores.svelte'
    import LongTextField from './LongTextField.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'

    // The creator notes as classic's language tabs show them. The tabs are the languages of the note's map (EN always
    // among them); a language added here is a draft of this visit and reaches the stored string only once it holds
    // text. Mounting, switching a tab and opening the add menu write nothing: only typing does, through the history
    // service, as one re-encode of the whole note (`withLanguageBody`).
    interface Props {
        chaId: string
        owner: OwnerKey
        service: OwnerHistoryService | null
        editable: boolean
        ownerLabel: string
        previewSource: () => PreviewSourceInput
        onresult: (result: StudioResult | null) => void
    }

    let { chaId, owner, service, editable, ownerLabel, previewSource, onresult }: Props = $props()

    // The stored note as a string; anything else (an absent key) reads as no text, and a write over it is refused by the
    // service.
    function storedNotes(): string | null {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        const value = found && found.type !== 'group' ? (found as { creatorNotes?: unknown }).creatorNotes : undefined
        return typeof value === 'string' ? value : null
    }

    const liveLanguages = $derived.by(() => {
        const text = storedNotes()
        return text === null ? [] : Object.keys(notesLanguages(text))
    })

    let tabs = $state<string[]>(untrack(() => (liveLanguages.length > 0 ? [...liveLanguages] : ['en'])))
    let active = $state('en')
    let adding = $state(false)

    // A language that appears in the stored note later (an undo, say) gets its tab; a tab is never removed in a visit.
    $effect(() => {
        for (const code of liveLanguages) {
            if (!untrack(() => tabs.includes(code))) untrack(() => tabs.push(code))
        }
    })

    // The port of one tab. The tab's language is captured here, so a commit that runs after a tab switch still writes
    // the language its field was created for.
    function portOf(lang: string): LongTextWritePort {
        return {
            read: () => {
                const text = storedNotes()
                return text === null ? '' : (notesLanguages(text)[lang] ?? '')
            },
            write: (value) => {
                if (!service || !editable) return null
                const text = storedNotes()
                return service.editText(owner, 'creatorNotes', text === null ? value : withLanguageBody(text, lang, value), 'typing')
            },
            closeStep: () => service?.closeOpenStep(owner),
        }
    }
    const ports: Record<string, LongTextWritePort> = {}
    function port(lang: string): LongTextWritePort {
        return (ports[lang] ??= portOf(lang))
    }

    function choose(lang: string): void {
        service?.closeOpenStep(owner)
        active = lang
    }

    // The language codes of classic's add menu. They come from util, whose module graph is the whole app, so they load
    // when the menu first opens.
    let codes = $state<readonly string[]>([])
    async function toggleMenu(): Promise<void> {
        adding = !adding
        if (adding && codes.length === 0) codes = (await import('../../ts/util')).languageCodes
    }

    // Classic's menu: the languages that have a name, KO first, without the tabs already shown.
    const addable = $derived(
        codes.filter((code) => languageName(code) !== code && !tabs.includes(code)).sort((a, b) => Number(b === 'ko') - Number(a === 'ko')),
    )

    function add(lang: string): void {
        service?.closeOpenStep(owner)
        if (!tabs.includes(lang)) tabs.push(lang)
        active = lang
        adding = false
    }
</script>

<div class="flex flex-col gap-1">
    <div role="tablist" aria-label={language.creatorNotes} class="flex flex-wrap gap-2">
        {#each tabs as lang (lang)}
            <button
                type="button"
                role="tab"
                aria-selected={active === lang}
                class="min-h-11 rounded-md border border-darkborderc px-3 text-textcolor {active === lang ? 'bg-selected' : 'bg-darkbg'}"
                onclick={() => choose(lang)}
            >{languageName(lang)}</button>
        {/each}
        <button
            type="button"
            aria-expanded={adding}
            aria-label={language.studioCreatorNotesAddLang}
            class="min-h-11 rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor"
            disabled={!editable}
            onclick={toggleMenu}
        >+</button>
    </div>
    {#if adding}
        <div class="flex flex-wrap gap-2" role="menu" aria-label={language.studioCreatorNotesAddLang}>
            {#each addable as lang (lang)}
                <button
                    type="button"
                    role="menuitem"
                    class="min-h-11 rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor"
                    onclick={() => add(lang)}
                >{languageName(lang)}</button>
            {/each}
        </div>
    {/if}
    {#key active}
        <LongTextField
            port={port(active)}
            part="studio-form-creator-notes"
            label={language.creatorNotes}
            kind="advanced"
            mode="plain"
            {ownerLabel}
            {previewSource}
            {editable}
            busy={!editable}
            fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
            {onresult}
        />
    {/key}
</div>

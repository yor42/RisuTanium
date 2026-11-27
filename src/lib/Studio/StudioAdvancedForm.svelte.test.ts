// @vitest-environment jsdom
/**
 * The prompt and detail text fields of the advanced character form over a real history service on the memory doubles
 * (T1-UI, diagnostics). Every write is one `editText` of the registered path; a nested path creates its seeded
 * container; an absent required key is refused with the precondition line; the personality and the scenario are shown
 * while they hold text or the unrecommended-fields setting is on.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
// The add menu loads its language codes from util, whose module graph is the whole app.
vi.mock('src/ts/util', () => ({ languageCodes: ['af', 'en', 'ja', 'ko'] }))

const db = $state({ db: { characters: [] as LiveCharacter[], showUnrecommended: false } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
    }
})
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches']) own[key] = withArguments(key)
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { refusalText } from 'src/ts/studio/edit/studioToasts'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { flushStudioFields } from 'src/ts/studio/fieldFlush'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { languageName } from '../../ts/studio/edit/creatorNotesLanguages'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createGate, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioAdvancedForm from './StudioAdvancedForm.svelte'

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    license?: string
    systemPrompt?: string
    replaceGlobalNote?: string
    additionalText?: string
    personality?: string
    scenario?: string
    nickname?: string
    defaultVariables?: string
    translatorNote?: string
    creatorNotes?: string
    removedQuotes?: boolean
    depth_prompt?: { depth: number; prompt?: string }
    additionalData?: { tag: string[]; creator?: string; character_version?: string }
    chats: { id: string; note: string }[]
    chatPage: number
}

function makeCharacter(overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        name: 'Alice',
        systemPrompt: 'SYS',
        replaceGlobalNote: 'RGN',
        additionalText: 'ADD',
        personality: '',
        scenario: '',
        defaultVariables: 'a=1',
        translatorNote: 'tn',
        creatorNotes: 'my plain upstream note',
        chats: [{ id: 'c1', note: 'n0' }],
        chatPage: 0,
        ...overrides,
    }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

interface Rig {
    clock: FakeClock
    claim: ReturnType<typeof createClaimDouble>
    service: OwnerHistoryService
}

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps)
}

function makeRig(): Rig {
    const clock = createFakeClock()
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { clock, claim, service }
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountForm(section: 'prompts' | 'details'): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(StudioAdvancedForm, { target: host, props: { chaId: 'A', section } })
    mounted.push({ app, host })
    flushSync()
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

async function mountWith(section: 'prompts' | 'details', character: Partial<LiveCharacter> = {}): Promise<Rig> {
    db.db.characters = [makeCharacter(character)]
    const rig = makeRig()
    mountForm(section)
    await settle()
    return rig
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const area = (name: string) => part(name) as HTMLTextAreaElement
const line = (name: string) => part(name) as HTMLInputElement
const refusalLine = (): string | undefined => part('studio-form-refusal')?.textContent ?? undefined
const live = (): LiveCharacter => db.db.characters[0]
const stepsOf = (service: OwnerHistoryService) => service.view(A).done

function typeIn(field: HTMLTextAreaElement | HTMLInputElement, value: string): void {
    field.value = value
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    flushSync()
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    db.db.showUnrecommended = false
    selection.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    setMacroIndexForTests(createMacroIndex([{ name: 'char', aliases: [], summary: 'char', usage: null, docOnly: false, internalOnly: false, blockSyntax: false, deprecated: null }]))
})

afterEach(async () => {
    setMacroIndexForTests(null)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T1-UI the advanced form text fields', () => {
    test('the prompts section renders its fields with the en labels; the details section its own', async () => {
        await mountWith('prompts')
        mountForm('details')
        await settle()
        for (const name of ['studio-form-system-prompt', 'studio-form-replace-global-note', 'studio-form-additional-text', 'studio-form-depth-prompt', 'studio-form-creator', 'studio-form-character-version', 'studio-form-nickname', 'studio-form-default-variables', 'studio-form-translator-note', 'studio-form-creator-notes']) {
            expect(part(name), name).not.toBeNull()
        }
        expect(document.body.textContent).toContain('systemPrompt')
        expect(document.body.textContent).toContain('depthPrompt')
        expect(document.body.textContent).toContain('CharVersion')
        expect(document.querySelectorAll('[data-part="studio-advanced-form"]')).toHaveLength(2)
        expect(part('studio-form-banner')).toBeNull()
    })

    test('typing in the system prompt edits the live character through the service, marks it and records one coalesced step', async () => {
        const rig = await mountWith('prompts')
        typeIn(area('studio-form-system-prompt'), 'SYS2')
        typeIn(area('studio-form-system-prompt'), 'SYS23')
        expect(live().systemPrompt).toBe('SYS23')
        expect(h.marks).toBe(2)
        const steps = stepsOf(rig.service)
        expect(steps).toHaveLength(1)
        expect(steps[0].label).toEqual({ kind: 'field', field: 'systemPrompt' })
    })

    test('typing in the depth prompt of a character without the container creates the seeded container', async () => {
        await mountWith('prompts')
        typeIn(area('studio-form-depth-prompt'), 'dp')
        expect(live().depth_prompt).toEqual({ depth: 0, prompt: 'dp' })
        expect(live()).not.toHaveProperty(['depth_prompt.prompt'])
    })

    test('an absent required key is refused with the precondition line and the live character is unchanged', async () => {
        const rig = await mountWith('prompts', { systemPrompt: undefined })
        typeIn(area('studio-form-system-prompt'), 'x')
        expect(refusalLine()).toBe(refusalText('precondition'))
        expect(live().systemPrompt).toBeUndefined()
        expect(h.marks).toBe(0)
        expect(stepsOf(rig.service)).toHaveLength(0)
    })

    test('while the owner loads the fields are read-only and a typed value writes nothing', async () => {
        const rig = makeRig()
        const gate = createGate()
        rig.claim.hook = () => gate.promise
        db.db.characters = [makeCharacter()]
        mountForm('prompts')
        mountForm('details')
        await settle()
        expect(area('studio-form-system-prompt').readOnly).toBe(true)
        expect(line('studio-form-nickname').readOnly).toBe(true)
        typeIn(area('studio-form-system-prompt'), 'typed')
        typeIn(line('studio-form-nickname'), 'typed')
        await settle()
        expect(live().systemPrompt).toBe('SYS')
        expect(live().nickname).toBeUndefined()
        expect(h.marks).toBe(0)
    })

    test('a private character shows nothing', async () => {
        await mountWith('prompts', { license: 'private' })
        expect(part('studio-advanced-form')).toBeNull()
    })

    test('a creator edit on a character without additionalData creates the seeded container; a nickname edit lands', async () => {
        await mountWith('details')
        typeIn(line('studio-form-creator'), 'me')
        expect(live().additionalData).toEqual({ tag: [], creator: 'me', character_version: '' })
        typeIn(line('studio-form-nickname'), 'nick')
        expect(live().nickname).toBe('nick')
        line('studio-form-nickname').dispatchEvent(new FocusEvent('blur'))
        flushSync()
    })

    test('nickname: inputs during a composition write nothing, the composition end writes once', async () => {
        const rig = await mountWith('details')
        const field = line('studio-form-nickname')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = 'ni'
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
        field.value = 'nic'
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
        flushSync()
        expect(live().nickname).toBeUndefined()
        expect(h.marks).toBe(0)
        field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        expect(live().nickname).toBe('nic')
        expect(h.marks).toBe(1)
        field.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    describe('Q1 personality and scenario visibility', () => {
        test('a value of any length shows the field; an empty one shows nothing and no add part', async () => {
            await mountWith('prompts', { personality: 'ab', scenario: '' })
            expect(part('studio-form-personality')).not.toBeNull()
            expect(part('studio-form-scenario')).toBeNull()
            expect(document.querySelector('[data-part$="-add"]')).toBeNull()
        })

        test('a one-character value shows the field', async () => {
            await mountWith('prompts', { scenario: 'x' })
            expect(part('studio-form-scenario')).not.toBeNull()
        })

        test('an empty field is shown while the unrecommended-fields setting is on', async () => {
            db.db.showUnrecommended = true
            await mountWith('prompts')
            expect(part('studio-form-personality')).not.toBeNull()
            expect(part('studio-form-scenario')).not.toBeNull()
        })

        test('a shown field stays shown when its text is cleared', async () => {
            await mountWith('prompts', { personality: 'ab' })
            typeIn(area('studio-form-personality'), '')
            await settle()
            expect(live().personality).toBe('')
            expect(part('studio-form-personality')).not.toBeNull()
        })
    })
})

describe('T2-CN-UI the creator notes field', () => {
    const PLAIN = 'my plain upstream note'
    const DUPLICATE = '\n# `en`\nfirst\n# `en`\nsecond'
    const tabs = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
    const tabNamed = (name: string): HTMLElement => tabs().find((tab) => tab.textContent === name) as HTMLElement
    const plus = (): HTMLElement => document.querySelector<HTMLElement>('[aria-label="studioCreatorNotesAddLang"][aria-expanded]') as HTMLElement
    const click = (element: HTMLElement): void => {
        element.click()
        flushSync()
    }
    const KO = languageName('ko')
    const EN = languageName('en')
    const addKo = async (): Promise<void> => {
        click(plus())
        await settle()
        click(Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent === KO) as HTMLElement)
    }

    test('a plain upstream note shows as one EN tab, and typing at its end writes the classic string as one step that an undo restores byte for byte', async () => {
        const rig = await mountWith('details')
        expect(tabs().map((tab) => tab.textContent)).toEqual([EN])
        expect(area('studio-form-creator-notes').value).toBe(PLAIN)
        typeIn(area('studio-form-creator-notes'), `${PLAIN}!`)
        typeIn(area('studio-form-creator-notes'), `${PLAIN}!!`)
        expect(live().creatorNotes).toBe('\n# `en`\nmy plain upstream note!!')
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(stepsOf(rig.service)[0].label).toEqual({ kind: 'field', field: 'creatorNotes' })
        expect(rig.service.undo(A).ok).toBe(true)
        expect(live().creatorNotes).toBe(PLAIN)
    })

    test('mounting, a tab switch and the add menu write nothing', async () => {
        // Untagged text before a section is what classic's own tab click would rewrite; Studio leaves the stored string alone.
        const rig = await mountWith('details', { creatorNotes: 'intro\n# `ko`\nk' })
        expect(tabs().map((tab) => tab.textContent)).toEqual([KO, EN])
        click(tabNamed(KO))
        expect(area('studio-form-creator-notes').value).toBe('k')
        click(tabNamed(EN))
        expect(area('studio-form-creator-notes').value).toBe('intro\n')
        click(plus())
        await settle()
        click(plus())
        expect(live().creatorNotes).toBe('intro\n# `ko`\nk')
        expect(h.marks).toBe(0)
        expect(stepsOf(rig.service)).toHaveLength(0)
    })

    test('a new language is a draft until it has text; typing writes the classic string, and emptying it removes the section but keeps the tab', async () => {
        const rig = await mountWith('details')
        await addKo()
        expect(tabs().map((tab) => tab.textContent)).toEqual([EN, KO])
        expect(area('studio-form-creator-notes').value).toBe('')
        expect(live().creatorNotes).toBe(PLAIN)
        expect(h.marks).toBe(0)
        typeIn(area('studio-form-creator-notes'), 'K')
        expect(live().creatorNotes).toBe('\n# `en`\nmy plain upstream note\n# `ko`\nK')
        typeIn(area('studio-form-creator-notes'), '')
        expect(live().creatorNotes).toBe('\n# `en`\nmy plain upstream note')
        expect(tabs().map((tab) => tab.textContent)).toEqual([EN, KO])
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(rig.service.undo(A).ok).toBe(true)
        expect(live().creatorNotes).toBe(PLAIN)
    })

    test('a duplicated header shows its last body; typing writes one section and an undo restores both', async () => {
        const rig = await mountWith('details', { creatorNotes: DUPLICATE })
        expect(area('studio-form-creator-notes').value).toBe('second')
        typeIn(area('studio-form-creator-notes'), 'secondX')
        expect(live().creatorNotes).toBe('\n# `en`\nsecondX')
        expect(rig.service.undo(A).ok).toBe(true)
        expect(live().creatorNotes).toBe(DUPLICATE)
    })

    test('emptying the EN tab writes one space for it and keeps the other languages', async () => {
        await mountWith('details', { creatorNotes: '\n# `en`\nhello\n# `ko`\nannyeong' })
        typeIn(area('studio-form-creator-notes'), '')
        expect(live().creatorNotes).toBe('\n# `en`\n \n# `ko`\nannyeong')
    })

    test('a tab switch closes the open step, so typing on after it starts a new step', async () => {
        const rig = await mountWith('details', { creatorNotes: '\n# `en`\nhello\n# `ko`\nannyeong' })
        typeIn(area('studio-form-creator-notes'), 'hello1')
        click(tabNamed(KO))
        click(tabNamed(EN))
        typeIn(area('studio-form-creator-notes'), 'hello12')
        expect(stepsOf(rig.service)).toHaveLength(2)
        expect(live().creatorNotes).toBe('\n# `en`\nhello12\n# `ko`\nannyeong')
    })

    test('with the quote dismissed, the first edit clears it in the same step and an undo restores both', async () => {
        const rig = await mountWith('details', { removedQuotes: true })
        typeIn(area('studio-form-creator-notes'), 'x')
        expect(live().removedQuotes).toBe(false)
        expect(stepsOf(rig.service)).toHaveLength(1)
        expect(stepsOf(rig.service)[0].ops).toHaveLength(2)
        expect(rig.service.undo(A).ok).toBe(true)
        expect(live().removedQuotes).toBe(true)
        expect(live().creatorNotes).toBe(PLAIN)
    })

    test('a character without the creator notes key refuses a typed edit with the precondition line and no error', async () => {
        const rig = await mountWith('details', { creatorNotes: undefined })
        expect(area('studio-form-creator-notes').value).toBe('')
        expect(() => typeIn(area('studio-form-creator-notes'), 'x')).not.toThrow()
        expect(refusalLine()).toBe(refusalText('precondition'))
        expect('creatorNotes' in live() && live().creatorNotes !== undefined).toBe(false)
        expect(h.marks).toBe(0)
        expect(stepsOf(rig.service)).toHaveLength(0)
    })

    test('the add menu lists KO first and leaves out the tabs already shown', async () => {
        await mountWith('details', { creatorNotes: '\n# `en`\nhello\n# `ja`\nj' })
        click(plus())
        await settle()
        const names = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) => item.textContent)
        expect(names[0]).toBe(KO)
        expect(names).not.toContain(EN)
        expect(names).not.toContain(languageName('ja'))
    })
})

describe('held composition flush on leave, close, and pagehide', () => {
    function holdNicknameComposition(text: string): void {
        const field = line('studio-form-nickname')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.value = text
        field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
        flushSync()
    }

    test('reproducer: pagehide writes a held single-line composition while the form stays mounted', async () => {
        const rig = await mountWith('details')
        holdNicknameComposition('별명')
        expect(live().nickname).toBeUndefined()
        window.dispatchEvent(new Event('pagehide'))
        flushSync()
        expect(live().nickname).toBe('별명')
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    test('reproducer: leave flush writes a held single-line composition', async () => {
        const rig = await mountWith('details')
        holdNicknameComposition('별명')
        expect(live().nickname).toBeUndefined()
        flushStudioFields('leave')
        flushSync()
        expect(live().nickname).toBe('별명')
        expect(stepsOf(rig.service)).toHaveLength(1)
    })

    test('reproducer: closing Studio via studioOpen writes a held single-line composition', async () => {
        const rig = await mountWith('details')
        studioOpen.set(true)
        holdNicknameComposition('별명')
        expect(live().nickname).toBeUndefined()
        studioOpen.set(false)
        flushSync()
        expect(live().nickname).toBe('별명')
        expect(stepsOf(rig.service)).toHaveLength(1)
    })
})
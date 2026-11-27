// @vitest-environment jsdom
/**
 * The lorebook entry form, mounted through the pane over the real history service on the memory doubles and the real English
 * `language`. MOCKED: the page store (DBState is a `$state` object), the save-mark counter and the alert layer. Rows come from
 * the classic producers' golden (`addLorebook`: no id, version 2); an outside change is made the way the classic editor
 * makes it (a direct write on the live list), never through the pane.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/characters', () => ({ updateLorebooks: (book: unknown) => book }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
    }
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { chatOwnerKey } from '../../ts/studio/history/ownerPhase'
import { flushStudioFields } from '../../ts/studio/fieldFlush'
import { loreItemIdOf } from '../../ts/studio/ownerModel'
import { openStudioListRow, studioScreen } from '../../ts/studio/studioScreen.svelte'
import {
    A,
    STUDIO_KEY,
    changeTo,
    click,
    compose,
    doneCount,
    field,
    lore,
    mountPane,
    openEntry,
    part,
    row,
    service,
    settle,
    setupRig,
    startCharacter,
    teardownRig,
    typeInto,
    type Row,
} from './StudioLorePane.rig.test-helpers'

beforeEach(() => setupRig())
afterEach(async () => {
    await teardownRig()
})

const C1 = chatOwnerKey('A', 'c1')
const chatLore = (): Row[] => (DBState.db.characters as unknown as { chats: { localLore: Row[] }[] }[])[0].chats[0].localLore
const stepCount = (): number => service.view(A).done.length

async function openFirst(rows: Row[] = [row(0), row(1)], options: Parameters<typeof startCharacter>[1] = {}): Promise<void> {
    await startCharacter(rows, options)
    await mountPane()
    await openEntry(0)
}

describe('the entry form opens on the entry', () => {
    test('a row opens its form with the stored values, and the list is replaced', async () => {
        await openFirst()
        expect(field('studio-lore-name').value).toBe('Row 0')
        expect(field<HTMLTextAreaElement>('studio-lore-content').value).toBe('body 0')
        expect(part('studio-lore-list')).toBeNull()
        expect(studioScreen.selectedItemId).toBe('A/lore:0')
    })
})

describe('IME gates register their flush (MC-1813)', () => {
    test('TIME1: Name composing, then pagehide: the composed text is written once, as one step', async () => {
        await openFirst()
        compose(field('studio-lore-name'), '가')
        expect(lore()[0].comment).toBe('Row 0')
        window.dispatchEvent(new Event('pagehide'))
        await settle()
        expect(lore()[0].comment).toBe('가')
        expect(stepCount()).toBe(1)
    })

    test('TIME2: Activation keys composing, then the leave flush', async () => {
        await openFirst()
        compose(field('studio-lore-keys'), '키')
        expect(lore()[0].key).not.toBe('키')
        flushStudioFields('leave')
        await settle()
        expect(lore()[0].key).toBe('키')
        expect(stepCount()).toBe(1)
    })

    test('TIME3: Secondary keys composing (Selective on), then a hidden visibility change', async () => {
        await openFirst([{ ...row(0), selective: true }, row(1)])
        compose(field('studio-lore-secondary'), '둘')
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        window.dispatchEvent(new Event('visibilitychange'))
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        await settle()
        expect(lore()[0].secondkey).toBe('둘')
        expect(stepCount()).toBe(1)
    })
})

describe('T35 / TIO / TP / TK: the probability pair and Insert order', () => {
    test('T35: a Probability edit writes only content, and a legacy edit only activationPercent', async () => {
        await openFirst([{ ...row(0), content: '@@probability 40\nbody', activationPercent: 70 }, row(1)])
        expect(field('studio-lore-probability').value).toBe('40')
        expect(field('studio-lore-legacy').value).toBe('70')
        expect(part('studio-lore-legacy-note')?.textContent).toBe(language.studioLoreLegacyDiffers(40))
        typeInto(field('studio-lore-probability'), '55')
        await settle()
        expect(lore()[0].content).toBe('@@probability 55\nbody')
        expect(lore()[0].activationPercent).toBe(70)
        typeInto(field('studio-lore-legacy'), '20')
        await settle()
        expect(lore()[0].content).toBe('@@probability 55\nbody')
        expect(lore()[0].activationPercent).toBe(20)
    })

    test('TP: typing 150 writes 100, and a line the engine cannot read disables the control with its note', async () => {
        await openFirst([{ ...row(0), content: 'body' }, { ...row(1), content: '@@probability x\nbody' }])
        typeInto(field('studio-lore-probability'), '150')
        await settle()
        expect(lore()[0].content).toBe('@@probability 100\nbody')
        await click(part('studio-lore-form-delete'))
        await openEntry(0)
        expect(field('studio-lore-probability').disabled).toBe(true)
        expect(part('studio-lore-probability-note')?.textContent).toBe(language.studioLoreProbabilityUnreadable)
    })

    test('TIO: 1500 stores 1000 in one coalesced step, blur shows 1000, and an empty value writes nothing', async () => {
        await openFirst()
        const input = field('studio-lore-order')
        typeInto(input, '1')
        typeInto(input, '15')
        typeInto(input, '1500')
        await settle()
        expect(lore()[0].insertorder).toBe(1000)
        expect(stepCount()).toBe(1)
        changeTo(input, '1500')
        expect(input.value).toBe('1000')
        typeInto(input, '')
        await settle()
        expect(lore()[0].insertorder).toBe(1000)
        expect(stepCount()).toBe(1)
    })

    test('TK: the kept notice stands after a Clear, and a second Clear writes nothing', async () => {
        await openFirst([{ ...row(0), content: '@@probability 30\n@@@depth 2\nbody' }, row(1)])
        expect(part('studio-lore-probability-kept')).not.toBeNull()
        changeTo(field('studio-lore-probability'), '')
        await settle()
        expect(lore()[0].content).toBe('@@probability 100\n@@@depth 2\nbody')
        expect(field('studio-lore-probability').value).toBe('100')
        expect(part('studio-lore-probability-kept')?.textContent).toBe(language.studioLoreProbabilityKept)
        const steps = stepCount()
        changeTo(field('studio-lore-probability'), '')
        await settle()
        expect(stepCount()).toBe(steps)
        expect(part('studio-lore-probability-kept')).not.toBeNull()
    })
})

describe('T36 / T37: coalescing against the probability line, and D6', () => {
    test('T36 (a): content typing then a probability commit within the window are two steps', async () => {
        await openFirst()
        const area = field<HTMLTextAreaElement>('studio-lore-content')
        area.value = 'typed'
        area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        flushSync()
        typeInto(field('studio-lore-probability'), '30')
        await settle()
        expect(lore()[0].content).toBe('@@probability 30\ntyped')
        expect(stepCount()).toBe(2)
    })

    test('T36 (b): a held content composition is written first, then the probability line over it', async () => {
        await openFirst()
        const area = field<HTMLTextAreaElement>('studio-lore-content')
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        area.value = '가'
        area.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
        flushSync()
        expect(lore()[0].content).toBe('body 0')
        typeInto(field('studio-lore-probability'), '30')
        await settle()
        expect(lore()[0].content).toBe('@@probability 30\n가')
        expect(stepCount()).toBe(2)
    })

    test('T37: D6 is one step that undoes both; the button is absent for 0, null and an existing line', async () => {
        await openFirst([{ ...row(0), activationPercent: 60 }, { ...row(1), activationPercent: 0 }, { ...row(2), activationPercent: 60, content: '@@probability 10\nx' }])
        await click(part('studio-lore-legacy-move'))
        expect(lore()[0].content).toBe('@@probability 60\nbody 0')
        expect(lore()[0].activationPercent).toBeNull()
        expect(stepCount()).toBe(1)
        service.undo(A)
        flushSync()
        await settle()
        expect(lore()[0].content).toBe('body 0')
        expect(lore()[0].activationPercent).toBe(60)
        await click(part('studio-lore-form-delete'))
        await openEntry(1)
        expect(part('studio-lore-legacy-move')).toBeNull()
        await click(part('studio-lore-form-delete'))
        await openEntry(2)
        expect(part('studio-lore-legacy-move')).toBeNull()
    })
})

describe('TD: the decorator copy reaches the content field', () => {
    test('an unknown @@foo lists the localized unknown-decorator problem', async () => {
        await openFirst([{ ...row(0), content: '@@foo\nbody' }, row(1)])
        await new Promise<void>((resolve) => setTimeout(resolve, 350))
        flushSync()
        expect(document.body.textContent).toContain(language.studioLoreDecoUnknown('foo'))
    })

    test('typing @@pro opens the picker with the source`s localized count', async () => {
        await openFirst([{ ...row(0), content: '' }, row(1)])
        const area = field<HTMLTextAreaElement>('studio-lore-content')
        area.focus()
        area.value = '@@pro'
        area.setSelectionRange(5, 5)
        area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        flushSync()
        await settle()
        const options = document.querySelectorAll('[data-part="studio-lt-picker-option"]')
        expect(options.length).toBeGreaterThan(0)
        expect(document.querySelector('[data-part="studio-lt-picker-count"]')?.textContent).toBe(language.studioLoreDecoMatches(options.length))
    })
})

describe('T30b: Give new ID keeps the form on the entry', () => {
    test('a shared id is marked; the new id is one step, the form stays, and a following Name edit lands on the entry', async () => {
        await openFirst([{ ...row(0), id: 'X' }, { ...row(1), id: 'X' }])
        expect(part('studio-lore-duplicate-id')).not.toBeNull()
        await click(part('studio-lore-new-id'))
        expect(lore()[0].id).not.toBe('X')
        expect(lore()[1].id).toBe('X')
        expect(stepCount()).toBe(1)
        expect(studioScreen.selectedItemId).toBe('A/lore:0')
        expect(part('studio-lore-duplicate-id')).toBeNull()
        const name = field('studio-lore-name')
        typeInto(name, 'Renamed')
        await settle()
        expect(lore()[0].comment).toBe('Renamed')
        expect(field('studio-lore-name')).toBe(name)
    })
})

describe('local activation (S1)', () => {
    async function openWithLocal(rows: Row[], options: Parameters<typeof startCharacter>[1] = {}): Promise<void> {
        await startCharacter(rows, options)
        ;(DBState.db as unknown as { localActivationInGlobalLorebook: boolean }).localActivationInGlobalLorebook = true
        await mountPane()
        await openEntry(0)
    }

    test('T24a-x: an id-less entry is activated in the chat: both steps land, and the form stays on the entry', async () => {
        await openWithLocal([row(0), row(1)])
        await settle()
        const name = field('studio-lore-name')
        const toggle = field('studio-lore-local-active')
        expect(toggle.disabled).toBe(false)
        await click(toggle)
        expect(lore()[0].id).toBeTruthy()
        expect(chatLore()).toHaveLength(1)
        expect(chatLore()[0].mode).toBe('child')
        expect(chatLore()[0].id).toBe(lore()[0].id)
        expect(field('studio-lore-name')).toBe(name)
        expect(studioScreen.selectedItemId).toBe('A/lore:0')
        expect(studioScreen.notice).toBeNull()
        typeInto(name, 'After')
        await settle()
        expect(lore()[0].comment).toBe('After')
    })

    test('T24c-x: a chat step the lorebook refuses leaves the id, shows the refusal and keeps the form open', async () => {
        await openWithLocal([row(0), row(1)], { localLore: { notAList: true } })
        await settle()
        const name = field('studio-lore-name')
        await click(field('studio-lore-local-active'))
        expect(lore()[0].id).toBeTruthy()
        expect(part('studio-lore-refusal')).not.toBeNull()
        expect(field('studio-lore-name')).toBe(name)
        expect(studioScreen.notice).toBeNull()
        typeInto(name, 'After')
        await settle()
        expect(lore()[0].comment).toBe('After')
    })

    test('T24d: the switch is disabled until the form has started the chat owner (the write guard is T24e), and a click then writes both steps', async () => {
        await startCharacter([row(0), row(1)], { chatReady: false })
        ;(DBState.db as unknown as { localActivationInGlobalLorebook: boolean }).localActivationInGlobalLorebook = true
        await mountPane()
        openStudioListRow({ ownerKey: STUDIO_KEY, kind: 'lore' }, STUDIO_KEY, loreItemIdOf('A', 0))
        flushSync()
        const toggle = field('studio-lore-local-active')
        expect(toggle.disabled).toBe(true)
        // A disabled control dispatches no click; this asserts the disabled state, not a write guard.
        toggle.click()
        flushSync()
        expect(lore()[0].id).toBeFalsy()
        expect(chatLore()).toHaveLength(0)
        expect(stepCount()).toBe(0)
        await settle()
        expect(toggle.disabled).toBe(false)
        await click(toggle)
        expect(lore()[0].id).toBeTruthy()
        expect(stepCount()).toBe(1)
        expect(service.view(C1).done).toHaveLength(1)
        expect(chatLore()).toHaveLength(1)
        expect(studioScreen.selectedItemId).toBe('A/lore:0')
        expect(studioScreen.notice).toBeNull()
    })

    test('T24 (b): Off removes the link', async () => {
        await openWithLocal([{ ...row(0), id: 'E' }, row(1)])
        await settle()
        await click(field('studio-lore-local-active'))
        expect(chatLore()).toHaveLength(1)
        await click(field('studio-lore-local-active'))
        expect(chatLore()).toHaveLength(0)
        expect(service.view(C1).done[1].label).toMatchObject({ action: 'unlink', name: 'Row 0' })
    })
})

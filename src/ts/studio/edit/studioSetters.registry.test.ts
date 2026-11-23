// @vitest-environment jsdom
// The registry-driven readers and writers of the builtin holders (compatibility guards: they pass on the per-path
// branches the registry replaced). T-W1: what each writer does with `had: true` and `had: false`. T-W2: the edit
// builder's refusals. T-R1: what each reader reads.
import { describe, expect, test, vi } from 'vitest'
import type { Chat, character } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import type { FieldValue, LiveReader, SetPath, WriteOp } from '../history/historyModel'
import { applyCharacterWrites, applyChatWrites, buildFieldEdit, buildWrittenModule, createLiveReader, createModuleLiveReader } from './studioSetters'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { characters: [], modules: [] } },
    selIdState: { selId: 0 },
    clearCharEmotionCache: () => {},
}))

function makeCharacter(over: Record<string, unknown> = {}): character {
    return applyCharacterDefaults({ chaId: 'c1', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', ...over } as unknown as character) as character
}

const set = (path: SetPath, value: FieldValue): WriteOp => ({ op: 'set', path, value })
const had = (value: string | boolean): FieldValue => ({ had: true, value })
const ABSENT: FieldValue = { had: false }

const KEEP_ON_CHARACTER = ['desc', 'firstMessage', 'exampleMessage'] as const
const DELETE_ON_CHARACTER = ['customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete'] as const
const VALUE_OF: Record<SetPath, string | boolean> = {
    desc: 'new desc',
    firstMessage: 'new first',
    exampleMessage: 'new example',
    customModuleToggle: 'new toggle',
    hideChatIcon: true,
    risutanium_render_when_complete: true,
    note: 'new note',
}

describe('T-W1: the writers of the builtin holders', () => {
    test.each([...KEEP_ON_CHARACTER, ...DELETE_ON_CHARACTER])('the character writer assigns %s on had:true', (path) => {
        const live = makeCharacter()
        applyCharacterWrites(live, [set(path, had(VALUE_OF[path]))], null)
        expect((live as unknown as Record<string, unknown>)[path]).toBe(VALUE_OF[path])
    })

    test.each(KEEP_ON_CHARACTER)('the character writer keeps %s on had:false', (path) => {
        const live = makeCharacter()
        applyCharacterWrites(live, [set(path, ABSENT)], null)
        expect((live as unknown as Record<string, unknown>)[path]).toBe(path === 'desc' ? 'd0' : path === 'firstMessage' ? 'f0' : 'e0')
    })

    test.each(DELETE_ON_CHARACTER)('the character writer deletes %s on had:false and never writes undefined', (path) => {
        const live = makeCharacter({ customModuleToggle: 'on', hideChatIcon: true, risutanium_render_when_complete: true })
        applyCharacterWrites(live, [set(path, ABSENT)], null)
        expect(path in live).toBe(false)
    })

    test('the character writer writes nothing for note, and nothing for a value of the wrong type', () => {
        const live = makeCharacter()
        applyCharacterWrites(live, [set('note', had('n')), set('hideChatIcon', had('not a boolean')), set('desc', had(true))], null)
        expect('note' in live).toBe(false)
        expect('hideChatIcon' in live).toBe(false)
        expect(live.desc).toBe('d0')
    })

    test('the chat writer assigns note on had:true, keeps it on had:false and writes no other path', () => {
        const chat = { note: 'n0' } as Chat
        applyChatWrites(chat, [set('note', had('n1'))])
        expect(chat.note).toBe('n1')
        applyChatWrites(chat, [set('note', ABSENT), set('desc', had('x')), set('customModuleToggle', had('x'))])
        expect(chat.note).toBe('n1')
        expect('desc' in chat).toBe(false)
        expect('customModuleToggle' in chat).toBe(false)
    })

    test('the module copy takes the toggle on had:true, drops the key on had:false, and the live module is never written', () => {
        const live = { id: 'M1', name: 'M1', customModuleToggle: 'a=A', assets: [] } as unknown as RisuModule
        const extras = { folder: { kind: 'keep' }, retained: null } as const
        const assigned = buildWrittenModule(live, [set('customModuleToggle', had('a=B'))], extras)
        expect(assigned.customModuleToggle).toBe('a=B')
        const dropped = buildWrittenModule(live, [set('customModuleToggle', ABSENT)], extras)
        expect('customModuleToggle' in dropped).toBe(false)
        expect(live.customModuleToggle).toBe('a=A')
        const ignored = buildWrittenModule(live, [set('desc', had('x')), set('note', had('x'))], extras)
        expect(ignored.customModuleToggle).toBe('a=A')
        expect('desc' in ignored).toBe(false)
        expect('note' in ignored).toBe(false)
    })
})

describe('T-W2: the edit builder refuses by the registered facts', () => {
    const absentReader = { field: () => ABSENT } as unknown as LiveReader
    const holdingReader = { field: () => had('same') } as unknown as LiveReader

    test.each(['firstMessage', 'exampleMessage'] as const)('an absent live %s refuses the edit as precondition', (path) => {
        expect(buildFieldEdit(path, 'x', absentReader)).toEqual({ ok: false, reason: 'precondition' })
    })

    test.each(['desc', 'customModuleToggle', 'note'] as const)('an absent live %s is edited', (path) => {
        expect(buildFieldEdit(path, 'x', absentReader)).toMatchObject({ ok: true })
    })

    test.each(['hideChatIcon', 'risutanium_render_when_complete'] as const)('an absent live %s is edited as a boolean', (path) => {
        expect(buildFieldEdit(path, true, absentReader)).toMatchObject({ ok: true })
    })

    test('a value of the wrong type is a precondition refusal and an equal value is unchanged', () => {
        expect(buildFieldEdit('desc', true, holdingReader)).toEqual({ ok: false, reason: 'precondition' })
        expect(buildFieldEdit('hideChatIcon', 'x', holdingReader)).toEqual({ ok: false, reason: 'precondition' })
        expect(buildFieldEdit('desc', 'same', holdingReader)).toEqual({ ok: false, reason: 'unchanged' })
    })
})

describe('T-R1: the readers of the builtin holders', () => {
    test('the character reader reads every character path from the character and note from the chat', () => {
        const live = makeCharacter({ customModuleToggle: 't', hideChatIcon: false, risutanium_render_when_complete: true, note: 'character note' })
        const chat = { note: 'chat note' } as Chat
        const reader = createLiveReader({ character: live, chat })
        expect(reader.field('desc')).toEqual(had('d0'))
        expect(reader.field('firstMessage')).toEqual(had('f0'))
        expect(reader.field('exampleMessage')).toEqual(had('e0'))
        expect(reader.field('customModuleToggle')).toEqual(had('t'))
        expect(reader.field('hideChatIcon')).toEqual(had(false))
        expect(reader.field('risutanium_render_when_complete')).toEqual(had(true))
        expect(reader.field('note')).toEqual(had('chat note'))
    })

    test('note is absent without a chat even when the character carries a note property', () => {
        const live = makeCharacter({ note: 'character note' })
        expect(createLiveReader({ character: live, chat: null }).field('note')).toEqual(ABSENT)
    })

    test('a missing key and a value of the wrong type read as absent', () => {
        const live = makeCharacter({ customModuleToggle: 5, hideChatIcon: 'yes' })
        const reader = createLiveReader({ character: live, chat: null })
        expect(reader.field('customModuleToggle')).toEqual(ABSENT)
        expect(reader.field('hideChatIcon')).toEqual(ABSENT)
        expect(reader.field('risutanium_render_when_complete')).toEqual(ABSENT)
    })

    test('the module reader reads the toggle only', () => {
        const module = { id: 'M1', name: 'M1', customModuleToggle: 'a=A', desc: 'not a module field', assets: [] } as unknown as RisuModule
        const reader = createModuleLiveReader(module)
        expect(reader.field('customModuleToggle')).toEqual(had('a=A'))
        for (const path of ['desc', 'firstMessage', 'exampleMessage', 'hideChatIcon', 'risutanium_render_when_complete', 'note'] as const) {
            expect(reader.field(path), path).toEqual(ABSENT)
        }
        expect(createModuleLiveReader({ id: 'M2', name: 'M2', assets: [] } as unknown as RisuModule).field('customModuleToggle')).toEqual(ABSENT)
    })
})

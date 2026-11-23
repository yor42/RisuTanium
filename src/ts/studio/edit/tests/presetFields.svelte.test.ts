// The preset adapter's table over a real `$state` database and the real `changeToPreset`: every path of the preset
// kind's set row routes to the copy that is live now, an inactive keyless slot reads what `setPreset` would put in the
// working copy, a container is created from the seed `setPreset` uses, and a batch is checked whole before its first
// assignment.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { WriteOp } from 'src/ts/studio/history/historyModel'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset, presetFromWorkingSettings, savedPresetFor, setPreset, type Database } from 'src/ts/storage/database.svelte'
import { PRESET_FIELDS, presetValueAllowed, type PresetPath } from '../presetFields'
import { presetAdapter, readPresetField } from '../presetTarget'
import { SESSION_OWNER_KINDS } from 'src/ts/studio/history/sessionKinds'
import { FIELD_SPECS } from 'src/ts/studio/history/fieldRegistry'
import { SET_PATHS_BY_KIND, textPathsFor, valuePathsFor } from 'src/ts/studio/history/historyModel'
import { keylessPreset, presetNamed, seedPresetDb } from './presetFixture.test-helpers'

function setOp(path: PresetPath, value: string | boolean | number): WriteOp {
    return { op: 'set', path, value: { had: true, value } }
}
function unsetOp(path: PresetPath): WriteOp {
    return { op: 'set', path, value: { had: false } }
}
const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const slotBag = (index: number): Record<string, unknown> => DBState.db.botPresets[index] as unknown as Record<string, unknown>

let ids: string[]

beforeEach(() => {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B'), presetNamed('C', 'c=C')], 0, 'a=A')
})

describe('S4a-T1: the table, the registry and the kind rows', () => {
    const presetPaths = SESSION_OWNER_KINDS.preset.setPaths.filter((path) => path !== 'customModuleToggle')

    test('the table holds exactly the preset kind row, and the model row is that list', () => {
        expect(Object.keys(PRESET_FIELDS)).toEqual([...SESSION_OWNER_KINDS.preset.setPaths])
        expect(SET_PATHS_BY_KIND.preset).toEqual([...SESSION_OWNER_KINDS.preset.setPaths])
        expect(presetPaths).toHaveLength(58)
    })

    test('each new path is in the preset row and in no builtin kind row, with no holder and no property', () => {
        for (const path of presetPaths) {
            expect(SET_PATHS_BY_KIND.preset, path).toContain(path)
            for (const kind of ['character', 'chat', 'module'] as const) {
                expect(SET_PATHS_BY_KIND[kind], `${kind} ${path}`).not.toContain(path)
            }
            const facts: { holders: readonly string[]; property?: string } = FIELD_SPECS[path]
            expect(facts.holders, path).toEqual([])
            expect(facts.property, path).toBeUndefined()
        }
    })

    test('the builtin kind rows are the stored paths only', () => {
        expect(SET_PATHS_BY_KIND.chat).toEqual(['note'])
        expect(SET_PATHS_BY_KIND.module).toEqual(['customModuleToggle', 'moduleName', 'moduleDescription', 'moduleNamespace', 'moduleHideIcon', 'moduleLowLevelAccess', 'backgroundEmbedding'])
        expect(SET_PATHS_BY_KIND.character.some((path) => path.startsWith('preset'))).toBe(false)
    })

    test('S4a-T14: the text row holds text paths, the value row the booleans, and together every path once', () => {
        const text = textPathsFor('preset')
        const value = valuePathsFor('preset')
        expect(text).toContain('presetJsonSchema')
        expect(text).not.toContain('presetSendName')
        expect(value).toContain('presetSendName')
        expect(value).not.toContain('presetJsonSchema')
        expect([...text, ...value].sort()).toEqual([...SESSION_OWNER_KINDS.preset.setPaths].sort())
    })
})

describe('S4a-T2: write routing by the live copy', () => {
    test('an active edit lands on the working setting and survives a switch away and back', () => {
        expect(presetAdapter.write(ids[0], [setOp('presetJsonSchema', 'schema-a')])).toBe(true)
        expect(dbBag().jsonSchema).toBe('schema-a')
        expect(slotBag(0).jsonSchema).toBeUndefined()
        changeToPreset(1)
        expect(dbBag().jsonSchema).toBe('')
        changeToPreset(0)
        expect(dbBag().jsonSchema).toBe('schema-a')
        expect(slotBag(0).jsonSchema).toBe('schema-a')
    })

    test('an inactive edit lands on its slot only and a switch brings it into the working setting', () => {
        dbBag().jsonSchema = 'working'
        expect(presetAdapter.write(ids[1], [setOp('presetJsonSchema', 'schema-b')])).toBe(true)
        expect(slotBag(1).jsonSchema).toBe('schema-b')
        expect(dbBag().jsonSchema).toBe('working')
        expect(slotBag(0).jsonSchema).toBeUndefined()
        changeToPreset(1)
        expect(dbBag().jsonSchema).toBe('schema-b')
    })

    test('every table path of the working copy is written to its own db property when active and its slot property when inactive', () => {
        for (const path of Object.keys(PRESET_FIELDS) as PresetPath[]) {
            const spec = PRESET_FIELDS[path]
            if (spec.key !== undefined || spec.db === 'slotOnly') {
                continue
            }
            const value = spec.value === 'bool' ? !readBool(ids[0], path) : spec.value === 'number' ? 41 : `w-${path}`
            expect(presetAdapter.write(ids[0], [setOp(path, value)]), path).toBe(true)
            expect(dbBag()[spec.db], `active ${path}`).toBe(value)
            expect(slotBag(0)[spec.slot], `active slot ${path}`).not.toBe(value)
            const other = spec.value === 'bool' ? !readBool(ids[1], path) : spec.value === 'number' ? 42 : `s-${path}`
            expect(presetAdapter.write(ids[1], [setOp(path, other)]), path).toBe(true)
            expect(slotBag(1)[spec.slot], `inactive ${path}`).toBe(other)
            expect(dbBag()[spec.db], `inactive leaves working ${path}`).toBe(value)
        }
    })

    test('S4a-T2b: a batch is checked whole, so a mixed valid and invalid batch writes nothing on either copy', () => {
        const before = JSON.stringify(DBState.db)
        for (const id of [ids[0], ids[1]]) {
            expect(presetAdapter.write(id, [setOp('presetJsonSchema', 'first'), setOp('presetSendName', 'not-a-bool' as never)])).toBe(false)
            expect(presetAdapter.write(id, [setOp('presetJsonSchema', 'first'), unsetOp('presetJsonSchema')])).toBe(false)
            expect(presetAdapter.write(id, [setOp('presetJsonSchema', 'first'), { op: 'set', path: 'desc', value: { had: true, value: 'x' } }])).toBe(false)
        }
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('a value of the wrong kind is refused and a table path outside the row is never written', () => {
        const before = JSON.stringify(DBState.db)
        expect(presetAdapter.write(ids[1], [setOp('presetSendName', 'true' as never)])).toBe(false)
        expect(presetAdapter.write(ids[1], [setOp('presetJsonSchema', true as never)])).toBe(false)
        expect(JSON.stringify(DBState.db)).toBe(before)
    })
})

function readBool(id: string, path: PresetPath): boolean {
    const read = readPresetField(id, path)
    return read.had && read.value === true
}

describe('S4a-T3: the name is always the slot', () => {
    test('the name of the active preset is written to its slot and survives the save and a switch round trip', () => {
        expect(presetAdapter.write(ids[0], [setOp('presetName', 'Renamed')])).toBe(true)
        expect(slotBag(0).name).toBe('Renamed')
        expect(dbBag().name).toBeUndefined()
        changeToPreset(1)
        expect(slotBag(0).name).toBe('Renamed')
        changeToPreset(0)
        expect(slotBag(0).name).toBe('Renamed')
        expect(dbBag().name).toBeUndefined()
    })

    test('an empty name is allowed and reads back empty', () => {
        expect(presetAdapter.write(ids[1], [setOp('presetName', '')])).toBe(true)
        expect(readPresetField(ids[1], 'presetName')).toEqual({ had: true, value: '' })
    })
})

describe('S4a-T4: an inactive keyless slot reads what setPreset puts in the working copy', () => {
    test('absent keys read as the constants setPreset assigns, and keeps fields read not set', () => {
        const [, keyless] = seedPresetDb([presetNamed('A', 'a'), keylessPreset('K')], 0, 'a')
        expect(readPresetField(keyless, 'presetStrictJsonSchema')).toEqual({ had: true, value: true })
        expect(readPresetField(keyless, 'presetGroupOtherBotRole')).toEqual({ had: true, value: 'user' })
        expect(readPresetField(keyless, 'presetSystemRoleReplacement')).toEqual({ had: true, value: 'user' })
        expect(readPresetField(keyless, 'presetJsonSchema')).toEqual({ had: true, value: '' })
        expect(readPresetField(keyless, 'presetSendName')).toEqual({ had: true, value: false })
        expect(readPresetField(keyless, 'presetPostEndInnerFormat')).toEqual({ had: true, value: '' })
        delete slotBag(1).mainPrompt
        expect(readPresetField(keyless, 'presetMainPrompt')).toEqual({ had: false })
        expect(readPresetField(keyless, 'presetAutoSuggestPrefix')).toEqual({ had: false })
        expect(readPresetField(keyless, 'presetTrimStartNewChat')).toEqual({ had: false })
        expect(readPresetField(keyless, 'presetDynamicMemory')).toEqual({ had: false })
    })

    test('the readings equal the working copy after the real setPreset for the same slot', () => {
        const [, keyless] = seedPresetDb([presetNamed('A', 'a'), keylessPreset('K')], 0, 'a')
        const slot = DBState.db.botPresets[1]
        const clone = { ...DBState.db, NAIsettings: {}, botPresets: [] } as unknown as Database
        setPreset(clone, slot)
        const cloneBag = clone as unknown as Record<string, unknown>
        for (const path of Object.keys(PRESET_FIELDS) as PresetPath[]) {
            const spec = PRESET_FIELDS[path]
            if (spec.db === 'slotOnly') {
                continue
            }
            const read = readPresetField(keyless, path)
            const raw = spec.key === undefined ? cloneBag[spec.db] : (cloneBag[spec.db] as Record<string, unknown> | undefined)?.[spec.key]
            if (spec.absent === 'keeps') {
                continue
            }
            expect(read.had ? read.value : undefined, path).toEqual(raw === null ? undefined : raw)
        }
    })
})

describe('S4a-T7: a container is created from the seed setPreset uses', () => {
    function nullContainerSlot(): string {
        const built = presetFromWorkingSettings({ ...DBState.db, promptSettings: undefined } as unknown as Database, 'N', '')
        expect(built.promptSettings).toBeNull()
        const [, id] = seedPresetDb([presetNamed('A', 'a'), built], 0, 'a')
        return id
    }

    test('a write into a null promptSettings creates the container equal to the seed with the key set', () => {
        const id = nullContainerSlot()
        expect(presetAdapter.write(id, [setOp('presetSendName', true)])).toBe(true)
        expect(slotBag(1).promptSettings).toEqual({ assistantPrefill: '', postEndInnerFormat: '', sendChatAsSystem: false, sendName: true, utilOverride: false, maxThoughtTagDepth: -1 })
        const clone = { ...DBState.db, NAIsettings: {}, botPresets: [] } as unknown as Database
        setPreset(clone, DBState.db.botPresets[1])
        expect(clone.promptSettings).toEqual(slotBag(1).promptSettings)
    })

    test('a write whose reading already equals the value creates no container', () => {
        const id = nullContainerSlot()
        expect(presetAdapter.write(id, [setOp('presetSendName', false)])).toBe(true)
        expect(slotBag(1).promptSettings).toBeNull()
    })

    test('each created container is its own copy of the seed: a change on one preset never shows on another', () => {
        const built = (name: string) => presetFromWorkingSettings({ ...DBState.db, promptSettings: undefined } as unknown as Database, name, '')
        const [, first, second] = seedPresetDb([presetNamed('A', 'a'), built('N1'), built('N2')], 0, 'a')
        expect(presetAdapter.write(first, [setOp('presetSendName', true)])).toBe(true)
        expect(presetAdapter.write(second, [setOp('presetUtilOverride', true)])).toBe(true)
        const one = slotBag(1).promptSettings as Record<string, unknown>
        const two = slotBag(2).promptSettings as Record<string, unknown>
        expect(one).not.toBe(two)
        expect(one.sendName).toBe(true)
        expect(two.sendName).toBe(false)
        expect(one.utilOverride).toBe(false)
        expect(two.utilOverride).toBe(true)
    })

    test('a dynamicOutput key is created with every key off and an absent container reads not set', () => {
        const id = ids[1]
        expect(readPresetField(id, 'presetDynamicMemory')).toEqual({ had: false })
        expect(presetAdapter.write(id, [setOp('presetDynamicMemory', true)])).toBe(true)
        expect(slotBag(1).dynamicOutput).toEqual({
            autoAdjustSchema: false,
            dynamicMessages: false,
            dynamicMemory: true,
            dynamicResponseTiming: false,
            dynamicOutputPrompt: false,
            showTypingEffect: false,
            dynamicRequest: false,
        })
    })

    test('a container that is not a plain object reads its keys not set and is never written into', () => {
        slotBag(1).promptSettings = []
        expect(readPresetField(ids[1], 'presetSendName')).toEqual({ had: false })
        expect(presetAdapter.check?.(ids[1], [setOp('presetSendName', true)])).toBe('precondition')
        expect(presetAdapter.write(ids[1], [setOp('presetSendName', true)])).toBe(false)
        expect(slotBag(1).promptSettings).toEqual([])
    })

    test('the container fields are saved with the preset: the working container is the slot container after the save', () => {
        expect(presetAdapter.write(ids[0], [setOp('presetSendName', true)])).toBe(true)
        expect((dbBag().promptSettings as Record<string, unknown> | undefined)?.sendName).toBe(true)
        expect(savedPresetFor(DBState.db, DBState.db.botPresets[0]).promptSettings?.sendName).toBe(true)
    })
})

describe('S4a-T15: enum values', () => {
    test('the port refuses a value that is not an offered option, and the writer keeps an imported unknown value readable', () => {
        expect(presetValueAllowed('presetGroupOtherBotRole', 'bot')).toBe(false)
        expect(presetValueAllowed('presetGroupOtherBotRole', 'system')).toBe(true)
        expect(presetValueAllowed('presetSystemRoleReplacement', 'system')).toBe(false)
        expect(presetValueAllowed('presetSendName', 'true')).toBe(false)
        slotBag(1).groupOtherBotRole = 'bot'
        expect(readPresetField(ids[1], 'presetGroupOtherBotRole')).toEqual({ had: true, value: 'bot' })
        expect(presetAdapter.write(ids[1], [setOp('presetGroupOtherBotRole', 'bot')])).toBe(true)
    })
})

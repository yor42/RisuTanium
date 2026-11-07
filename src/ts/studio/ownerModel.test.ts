import { beforeEach, describe, expect, test, vi } from 'vitest'
import { toAssetList } from '../storage/assetList'
import { buildOwnerModel, ownerKeyOf, type OwnerModel, type OwnerNode } from './ownerModel'
import { buildMergedView } from './mergedView'
import { resolveStudioTarget } from './resolveTarget'
import {
    STUB_BODY_KEYS,
    bodyKeyListIsComplete,
    loreEntries,
    makeCharacter,
    makeChat,
    makeInput,
    makePlugin,
    makePreset,
    makeScaleFixture,
    regexEntries,
    residentModule,
    stubModule,
    v2Scripts,
    watchBodyKeys,
} from './studioFixtures.test-helpers'

// Any call into the module load path from the model is a write path; the doubles record it.
const loadCalls = vi.hoisted(() => ({ acquire: 0, useRow: 0, useById: 0 }))
vi.mock('../process/moduleUse', () => ({
    useModuleRow: vi.fn(async () => { loadCalls.useRow += 1; return null }),
    useModuleById: vi.fn(async () => { loadCalls.useById += 1; return null }),
    realmModuleJson: vi.fn(async () => null),
}))
vi.mock('../storage/store2/moduleAcquire', () => ({
    acquireModule: vi.fn(async () => { loadCalls.acquire += 1; return null }),
}))

beforeEach(() => {
    loadCalls.acquire = 0
    loadCalls.useRow = 0
    loadCalls.useById = 0
})

function kindsOf(owner: OwnerNode): { kind: string, count: number }[] {
    return owner.kinds().map((node) => ({ kind: node.kind, count: node.count }))
}

function touchEverything(model: OwnerModel): void {
    for (const owner of model.owners) {
        void owner.name
        for (const kind of owner.kinds()) kind.items()
    }
    for (const group of buildMergedView(model).groups) group.rows()
}

describe('3a owners, kinds and counts', () => {
    const lore = [...loreEntries(3), { comment: 'Folder', key: 'folder', mode: 'folder' }]
    const model = buildOwnerModel(makeInput({
        character: makeCharacter({
            globalLore: lore,
            customscript: regexEntries(2),
            triggerscript: v2Scripts,
            customModuleToggle: 'combat=Combat',
            backgroundHTML: '<div></div>',
            additionalAssets: [['a', 'p', 'png'], ['b', 'q', 'png']],
            emotionImages: [['happy', 'x']],
            chats: [makeChat({ id: 'c1', name: 'Chat', localLore: loreEntries(2, 'chat') })],
        }),
        modules: [residentModule('m1', {
            lorebook: [{
                key: 'k', secondkey: '', insertorder: 1, comment: 'c', content: 'b', mode: 'normal', alwaysActive: false, selective: false,
            }],
            regex: [{ comment: 'r', in: '', out: '', type: 'editinput' }],
            trigger: [{ comment: 't', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: '' }] }],
            customModuleToggle: 'x=X',
            backgroundEmbedding: '<style></style>',
            assets: toAssetList([['a', 'p', 'png'], ['b', 'q', 'png'], ['c', 'r', 'png']]),
        })],
        enabledModules: ['m1'],
        presets: [makePreset('Main', { regex: regexEntries(1), toggles: 't=T' }), makePreset('Other')],
        activePreset: 0,
        plugins: [makePlugin('legacy', 1), makePlugin('old', '2.1'), makePlugin('v2', 2), makePlugin('new', '3.0'), makePlugin('plain')],
    }))

    test('the character supports eight kinds in fixed order with counts', () => {
        expect(kindsOf(model.character)).toEqual([
            { kind: 'basic', count: 1 },
            { kind: 'display', count: 3 },
            { kind: 'lore', count: 3 },
            { kind: 'regex', count: 2 },
            { kind: 'scripts', count: 1 },
            { kind: 'toggles', count: 1 },
            { kind: 'html', count: 1 },
            { kind: 'advanced', count: 1 },
        ])
    })

    test('lorebook folder rows are counted apart and stay in the item list', () => {
        const loreKind = model.character.kinds().find((node) => node.kind === 'lore')
        expect(loreKind?.folderCount).toBe(1)
        const items = loreKind?.items() ?? []
        expect(items).toHaveLength(4)
        expect(items.map((item) => item.folder)).toEqual([false, false, false, true])
        expect(items[3].id).toBe('cha-1/lore:3')
    })

    test('the scripts item carries its mode and an empty list has no item', () => {
        const scripts = model.character.kinds().find((node) => node.kind === 'scripts')
        expect(scripts?.items().map((item) => item.mode)).toEqual(['v2'])
        const bare = buildOwnerModel(makeInput({ character: makeCharacter({ triggerscript: [] }) }))
        const empty = bare.character.kinds().find((node) => node.kind === 'scripts')
        expect(empty?.count).toBe(0)
        expect(empty?.items()).toEqual([])
    })

    test('the chat owner supports lore alone', () => {
        expect(model.chat?.name).toBe('Chat')
        expect(kindsOf(model.chat as OwnerNode)).toEqual([{ kind: 'lore', count: 2 }])
    })

    test('a resident module lists lore, regex, scripts, toggles, html, advanced and an asset count', () => {
        expect(model.modules.map((owner) => owner.id)).toEqual(['m1'])
        expect(kindsOf(model.modules[0])).toEqual([
            { kind: 'lore', count: 1 },
            { kind: 'regex', count: 1 },
            { kind: 'scripts', count: 1 },
            { kind: 'toggles', count: 1 },
            { kind: 'html', count: 1 },
            { kind: 'advanced', count: 1 },
            { kind: 'display', count: 3 },
        ])
    })

    test('the active preset comes first and the rest are other presets', () => {
        expect(model.presets.map((owner) => owner.name)).toEqual(['Main'])
        expect(model.otherPresets.map((owner) => owner.name)).toEqual(['Other'])
        expect(kindsOf(model.presets[0])).toEqual([
            { kind: 'regex', count: 1 }, { kind: 'toggles', count: 1 }, { kind: 'advanced', count: 1 },
        ])
    })

    test('a plugin is retired for version 1 and 2.1 only, and says which', () => {
        const tags = Object.fromEntries(model.plugins.map((owner) => [owner.id, owner.tags]))
        expect(tags).toEqual({ legacy: ['retired'], old: ['retired'], v2: [], new: [], plain: [] })
        const versions = Object.fromEntries(model.plugins.map((owner) => [owner.id, owner.retiredVersion]))
        expect(versions.legacy).toBe('1')
        expect(versions.old).toBe('2.1')
        expect(versions.v2).toBeUndefined()
        expect(kindsOf(model.plugins[0])).toEqual([{ kind: 'plugin', count: 1 }])
    })

    test('owners are found by type and id, and the key names both', () => {
        expect(model.ownerOf('character', 'cha-1')).toBe(model.character)
        expect(model.ownerOf('module', 'm1')?.key).toBe(ownerKeyOf('module', 'm1'))
        expect(model.ownerOf('module', 'cha-1')).toBeUndefined()
        expect(model.ownerOf('character', 'someone-else')).toBeUndefined()
    })
})

describe('3b private licence', () => {
    const model = buildOwnerModel(makeInput({
        character: makeCharacter({
            license: 'private',
            globalLore: loreEntries(5),
            customscript: regexEntries(2),
            chats: [makeChat({ id: 'c1', name: 'Chat', localLore: loreEntries(2, 'chat') })],
        }),
        presets: [makePreset('Main', { regex: regexEntries(1) })],
        activePreset: 0,
    }))

    test('the character and its chat show no kinds and are tagged private', () => {
        expect(model.character.restricted).toBe(true)
        expect(model.character.kinds()).toEqual([])
        expect(model.character.tags).toContain('private')
        expect(model.chat?.restricted).toBe(true)
        expect(model.chat?.kinds()).toEqual([])
    })

    test('their content stays out of every merged group while a preset still shows', () => {
        const groups = buildMergedView(model).groups
        const lore = groups.find((group) => group.kind === 'lore')
        const regex = groups.find((group) => group.kind === 'regex')
        expect(lore?.rows()).toEqual([])
        expect(regex?.rows().map((row) => row.ownerKey)).toEqual(['preset:0'])
    })

    test('a public character is not restricted', () => {
        const open = buildOwnerModel(makeInput({ character: makeCharacter({ license: 'CC BY-SA 4.0' }) }))
        expect(open.character.restricted).toBe(false)
        expect(open.character.kinds().length).toBeGreaterThan(0)
    })
})

describe('3c context chat', () => {
    test('a character without a chat on its page has no This chat owner', () => {
        const none = buildOwnerModel(makeInput({ character: makeCharacter({ chats: [] }) }))
        expect(none.chat).toBeNull()
        expect(none.owners.some((owner) => owner.type === 'chat')).toBe(false)

        const past = buildOwnerModel(makeInput({ character: makeCharacter({ chatPage: 3 }) }))
        expect(past.chat).toBeNull()
    })

    test('a chat on the page makes the owner', () => {
        const some = buildOwnerModel(makeInput({}))
        expect(some.chat?.id).toBe('chat-1')
        expect(some.owners.filter((owner) => owner.type === 'chat')).toHaveLength(1)
    })
})

describe('3h no module load from the model', () => {
    test('building, expanding every owner, merging and resolving never acquire or use a module', () => {
        const scale = makeScaleFixture()
        const model = buildOwnerModel(scale.input)
        touchEverything(model)
        for (const owner of model.owners) {
            resolveStudioTarget(model, { owner: { type: owner.type, id: owner.id }, kind: 'lore', item: `${owner.id}/lore:0` })
        }
        expect(model.owners.length).toBeGreaterThan(150)
        expect(loadCalls).toEqual({ acquire: 0, useRow: 0, useById: 0 })
    })
})

describe('3j a stub is never asked for a body key', () => {
    test('the body key list covers every key a module has and its entry lacks', () => {
        expect(bodyKeyListIsComplete).toBe(true)
        expect([...STUB_BODY_KEYS].sort()).toEqual(
            ['assets', 'backgroundEmbedding', 'cjs', 'customModuleToggle', 'lorebook', 'regex', 'trigger'],
        )
    })

    test('the watcher records a body read (so a silent run proves something)', () => {
        const reads: string[] = []
        const watched = watchBodyKeys(stubModule('probe'), reads)
        expect(watched.id).toBe('probe')
        expect(reads).toEqual([])
        void watched.lorebook
        expect('assets' in watched).toBe(false)
        expect(reads).toEqual(['lorebook', 'assets'])
    })

    test('building, expanding, merging and resolving over watched stubs reads no body key', () => {
        const scale = makeScaleFixture()
        const model = buildOwnerModel(scale.input)
        touchEverything(model)
        const stubOwners = model.owners.filter((owner) => owner.type === 'module' && owner.stub)
        expect(stubOwners).toHaveLength(scale.stubCount)
        for (const owner of stubOwners) {
            expect(owner.kinds()).toEqual([])
            resolveStudioTarget(model, { owner: { type: 'module', id: owner.id }, kind: 'lore' })
        }
        expect(scale.reads).toEqual([])
    })

    test('an active stub is tagged not loaded and shows no kinds', () => {
        const reads: string[] = []
        const stub = watchBodyKeys(stubModule('s1'), reads)
        const model = buildOwnerModel(makeInput({ modules: [stub], enabledModules: ['s1'] }))
        expect(model.modules[0].tags).toContain('notLoaded')
        expect(model.modules[0].kinds()).toEqual([])
        expect(model.modules[0].name).toBe('Module s1')
        expect(reads).toEqual([])
    })

    test('a resident module with the same shape does expose its body kinds (the check is not vacuous)', () => {
        const model = buildOwnerModel(makeInput({
            modules: [residentModule('r1', { lorebook: [] })], enabledModules: ['r1'],
        }))
        expect(model.modules[0].tags).not.toContain('notLoaded')
        expect(model.modules[0].kinds().length).toBeGreaterThan(0)
    })

    test('three-element asset tuples are only counted, never read', () => {
        const assets = toAssetList([['a', 'b', 'c']])
        const probe = new Proxy(assets, {
            get(target, key, receiver) {
                if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error('asset tuple read')
                return Reflect.get(target, key, receiver)
            },
        })
        const model = buildOwnerModel(makeInput({
            modules: [residentModule('a1', { assets: probe })], enabledModules: ['a1'],
        }))
        const display = model.modules[0].kinds().find((node) => node.kind === 'display')
        expect(display?.count).toBe(1)
    })

    test('lua scripts on a module read as a scripts item', () => {
        const model = buildOwnerModel(makeInput({
            modules: [residentModule('l1', { trigger: [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: '' }] }] })],
            enabledModules: ['l1'],
        }))
        expect(model.modules[0].kinds().find((node) => node.kind === 'scripts')?.items()[0].mode).toBe('lua')
    })
})

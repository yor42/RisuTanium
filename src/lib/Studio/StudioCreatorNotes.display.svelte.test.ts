// @vitest-environment jsdom
/**
 * T2-CN-FP, display leg: the chat's creator-notes display (MultiLangDisplay, real, over the real parse function) shows a
 * note a Studio edit wrote the way it shows the same edit made in the classic editor. A plain note that gains a KO
 * section still shows its plain text to an EN reader and the KO text to a KO reader.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const db = vi.hoisted(() => ({ language: 'en' }))

vi.mock('src/ts/gui/colorscheme', async () => {
    const { ColorSchemeTypeStore } = await import('src/ts/gui/surfaceTone')
    return { ColorSchemeTypeStore }
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db }, selIdState: { selId: 0 }, selectedCharID: writable(0) } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({ markCharacterForSave: vi.fn() }) as unknown as typeof import('src/ts/storage/characterSaveMarks'))
vi.mock(import('src/ts/process/modules'), () => ({ getModuleToggles: () => '' }) as unknown as typeof import('src/ts/process/modules'))

import { classicMount } from 'src/ts/studio/edit/classicMultiLang.test-helpers'
import { withLanguageBody } from 'src/ts/studio/edit/creatorNotesLanguages'
import MultiLangDisplay from '../UI/GUI/MultiLangDisplay.svelte'

let app: ReturnType<typeof MultiLangDisplay> | undefined

async function shownFor(value: string, language: string): Promise<string | undefined> {
    db.language = language
    const target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(MultiLangDisplay, { target, props: { value } })
    flushSync()
    await tick()
    const text = target.querySelector('.chattext')?.textContent?.trim()
    await unmount(app)
    app = undefined
    target.remove()
    return text
}

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
    db.language = 'en'
})

describe('T2-CN-FP: a Studio-written note displays as the plain text to EN readers and as the KO text to KO readers', () => {
    const PLAIN = 'my plain upstream note'

    test('a plain note that gains a KO section', async () => {
        const written = withLanguageBody(PLAIN, 'ko', 'K')
        expect(written).toBe('\n# `en`\nmy plain upstream note\n# `ko`\nK')
        expect(classicMount(written)).toBe(written)
        expect(await shownFor(written, 'en')).toBe(PLAIN)
        expect(await shownFor(written, 'ko')).toBe('K')
        expect(await shownFor(written, 'ja')).toBe(PLAIN)
    })

    test('emptying that KO section leaves the plain text for every reader', async () => {
        const written = withLanguageBody(withLanguageBody(PLAIN, 'ko', 'K'), 'ko', '')
        expect(written).toBe('\n# `en`\nmy plain upstream note')
        expect(await shownFor(written, 'ko')).toBe(PLAIN)
    })
})

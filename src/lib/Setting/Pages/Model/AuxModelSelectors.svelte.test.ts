// @vitest-environment jsdom

/**
 * The auxiliary model selectors always render, with no on/off checkbox, whatever the saved
 * `seperateModelsForAxModels` holds; rendering never writes the database; only a user choice writes its slot,
 * creating the slot object when the profile has none.
 *
 * Mounts the REAL `AuxModelSelectors.svelte` and the real Accordion and checkbox over a real `$state` database.
 * `ModelList` is a stub that renders one button per selector; clicking it assigns the selector's bound value,
 * the way a model choice does. Selector order is memory, translate, emotion, otherAx.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/lib/Others/Help.svelte', () => ({ default: () => {} }))

vi.mock('src/lib/UI/ModelList.svelte', () => ({
    default: (anchor: Comment, props: { value: string }) => {
        const button = document.createElement('button')
        button.setAttribute('data-model-list', '')
        button.setAttribute('data-value', String(props.value))
        button.addEventListener('click', () => {
            props.value = 'chosen'
        })
        anchor.before(button)
    },
}))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import AuxModelSelectors from './AuxModelSelectors.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountSelectors(db: Record<string, unknown>): HTMLElement {
    DBState.db = db as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(AuxModelSelectors, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function openAccordion(target: HTMLElement): void {
    const header = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.axModelsDef)
    header?.click()
    flushSync()
}

function checkbox(target: HTMLElement, name: string): HTMLInputElement | null {
    return target.querySelector<HTMLInputElement>(`input[type=checkbox][aria-label="${name}"]`)
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const SLOTS = { memory: 'a', emotion: 'b', translate: 'c', otherAx: 'd' }

describe('AuxModelSelectors renders whatever the saved flag holds', () => {
    test.each([false, true, undefined])('AM1: the accordion, four selectors and the keep-models checkbox render when the saved flag is %s', (flag) => {
        const target = mountSelectors({ seperateModelsForAxModels: flag, seperateModels: { ...SLOTS } })

        openAccordion(target)

        expect(Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === language.axModelsDef)).toBe(true)
        expect(target.querySelectorAll('[data-model-list]')).toHaveLength(4)
        expect(Array.from(target.querySelectorAll('[data-model-list]')).map((el) => el.getAttribute('data-value'))).toEqual(['a', 'c', 'b', 'd'])
        expect(checkbox(target, language.doNotChangeSeperateModels)).not.toBeNull()
    })

    test.each([false, true, undefined])('AM2: no checkbox for the retired flag when the saved flag is %s', (flag) => {
        const target = mountSelectors({ seperateModelsForAxModels: flag, seperateModels: { ...SLOTS } })

        expect(checkbox(target, language.seperateModelsForAxModels)).toBeNull()
    })
})

describe('AuxModelSelectors writes only on a choice', () => {
    test.each([false, true, undefined])('AM3: mounting and opening change no flag and create no slot object when the saved flag is %s', (flag) => {
        const target = mountSelectors({ seperateModelsForAxModels: flag, auxModelUnderModelSettings: flag, hideApiKey: flag })

        openAccordion(target)

        const db = DBState.db as unknown as Record<string, unknown>
        expect(target.querySelectorAll('[data-model-list]')).toHaveLength(4)
        expect(db.seperateModelsForAxModels).toBe(flag)
        expect(db.auxModelUnderModelSettings).toBe(flag)
        expect(db.hideApiKey).toBe(flag)
        expect('seperateModels' in db).toBe(false)
    })

    test('AM4: a profile without the slot object renders, and choosing a model creates the object with only that slot filled', () => {
        const target = mountSelectors({ seperateModelsForAxModels: false })

        openAccordion(target)
        const lists = target.querySelectorAll<HTMLButtonElement>('[data-model-list]')
        expect(lists).toHaveLength(4)
        lists[0].click()
        flushSync()

        expect(DBState.db.seperateModels).toEqual({ memory: 'chosen', emotion: '', translate: '', otherAx: '' })
    })

    test('guard: choosing a model in one selector leaves the other slots as they were', () => {
        const target = mountSelectors({ seperateModelsForAxModels: false, seperateModels: { ...SLOTS } })

        openAccordion(target)
        target.querySelectorAll<HTMLButtonElement>('[data-model-list]')[3].click()
        flushSync()

        expect(DBState.db.seperateModels).toEqual({ ...SLOTS, otherAx: 'chosen' })
    })
})

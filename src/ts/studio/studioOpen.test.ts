// @vitest-environment jsdom
import { get } from 'svelte/store'
import { afterEach, describe, expect, test } from 'vitest'
import { registerStudioField } from './fieldFlush'
import { studioOpen } from './studioOpen'

const removers: (() => void)[] = []

afterEach(() => {
    studioOpen.set(false)
    for (const remove of removers.splice(0)) remove()
})

describe('FLAG-U1 the studioOpen flag flushes the Studio fields on true to false', () => {
    function watch(): string[] {
        const order: string[] = []
        removers.push(registerStudioField((reason) => order.push(`flush:${reason}`)))
        let first = true
        removers.push(studioOpen.subscribe(() => {
            if (!first) order.push('subscriber')
            first = false
        }))
        return order
    }

    test('set(false) from false and set(true) flush nothing; set(false) from true flushes before subscribers', () => {
        studioOpen.set(false)
        const order = watch()
        studioOpen.set(false)
        expect(order).toEqual([])
        studioOpen.set(true)
        expect(order).toEqual(['subscriber'])
        order.length = 0
        studioOpen.set(false)
        expect(order).toEqual(['flush:leave', 'subscriber'])
        expect(get(studioOpen)).toBe(false)
    })

    test('update flushes on true to false through the same path', () => {
        studioOpen.set(false)
        const order = watch()
        studioOpen.set(true)
        order.length = 0
        studioOpen.update(() => false)
        expect(order).toEqual(['flush:leave', 'subscriber'])
    })

    test('update toggles from the current value', () => {
        studioOpen.set(false)
        studioOpen.update((open) => !open)
        expect(get(studioOpen)).toBe(true)
    })

    test('the flush runs while the flag still reads true', () => {
        studioOpen.set(true)
        let seen: boolean | null = null
        removers.push(registerStudioField(() => { seen = get(studioOpen) }))
        studioOpen.set(false)
        expect(seen).toBe(true)
    })
})

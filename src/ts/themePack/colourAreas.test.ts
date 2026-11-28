import { describe, expect, test } from 'vitest'
import { COLOUR_AREA_SPECS } from './colourAreas'
import { SCREEN_AREAS } from './intake'
import { LIGHT_BASE_JUDGE_PREFIX } from './lightBase'
import { COLOUR_READY_AREAS } from './colourReady'

describe('the per-area colour spec table (T1, guard)', () => {
    test('has one row per screen area, each keyed by its own name', () => {
        expect(Object.keys(COLOUR_AREA_SPECS).sort()).toEqual([...SCREEN_AREAS].sort())
        for (const area of SCREEN_AREAS) {
            expect(COLOUR_AREA_SPECS[area].area).toBe(area)
        }
    })

    test('only chat has a light proof prefix and decides the default scheme', () => {
        for (const area of SCREEN_AREAS) {
            expect(COLOUR_AREA_SPECS[area].lightProofPrefix).toBe(area === 'chat' ? LIGHT_BASE_JUDGE_PREFIX : null)
            expect(COLOUR_AREA_SPECS[area].defaultScheme).toBe(area === 'chat')
        }
    })

    test('chat, studio and settings trigger the own colours; home never does', () => {
        expect(SCREEN_AREAS.filter((area) => COLOUR_AREA_SPECS[area].triggersOwnColours)).toEqual(['chat', 'studio', 'settings'])
    })

    test('production lists chat alone as colour-ready, so every other row is inert', () => {
        expect([...COLOUR_READY_AREAS]).toEqual(['chat'])
    })
})

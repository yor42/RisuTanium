// @vitest-environment node
/**
 * T2a-9: the colour reader of the port (colour.ts parseConcrete) returns exactly what the reference reader
 * (docs/design/chat/checks/th/failclosed.mjs parseConcrete) returns, for a table of forms and a seeded fuzz.
 * The reference tree is read in place, like parity.test.ts.
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseConcrete, type Rgba } from './colour'

const DESIGN = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)), 'docs/design')
interface RefReader { parseConcrete: (s: string) => number[] | null, OKLAB_GAMUT_EPS: number }
const reference = await import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, 'chat/checks/th/failclosed.mjs')).href) as RefReader

const NAMES = ['red', 'blue', 'white', 'black', 'rebeccapurple', 'transparent', 'gray', 'yellow', 'darkslategray', 'notacolour']
const SPACES = ['srgb', 'srgb-linear', 'oklab', 'oklch', 'lab', 'hsl', 'display-p3', 'xyz']

/** A deterministic generator (mulberry32), so a failing case is reproducible. */
function seeded(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function randomColour(rand: () => number, depth: number, spaces: readonly string[]): string {
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]
    const hexDigits = (n: number): string => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('')
    const form = Math.floor(rand() * (depth < 3 ? 8 : 6))
    if (form === 0) return '#' + hexDigits(pick([3, 4, 6, 8, 5]))
    if (form === 1) return `rgb(${Math.floor(rand() * 256)} ${Math.floor(rand() * 256)} ${Math.floor(rand() * 256)}${rand() < 0.4 ? ` / ${(rand()).toFixed(2)}` : ''})`
    if (form === 2) return `hsl(${Math.floor(rand() * 360)} ${Math.floor(rand() * 101)}% ${Math.floor(rand() * 101)}%${rand() < 0.3 ? ` / ${Math.floor(rand() * 101)}%` : ''})`
    if (form === 3 || form === 4) return pick(NAMES)
    if (form === 5) return `rgba(${Math.floor(rand() * 256)}, ${Math.floor(rand() * 256)}, ${Math.floor(rand() * 256)}, ${rand().toFixed(2)})`
    const entry = (): string => {
        const colour = randomColour(rand, depth + 1, spaces)
        const roll = rand()
        if (roll < 0.3) return colour
        const pct = `${pick([0, 10, 25, 30, 40, 50, 60, 75, 90, 100, 120])}%`
        return roll < 0.65 ? `${colour} ${pct}` : `${pct} ${colour}`
    }
    return `color-mix(in ${pick(spaces)}, ${entry()}, ${entry()})`
}

describe('the port reader equals the reference reader (T2a-9, guard)', () => {
    test('the shared tolerance has one value', () => {
        expect(reference.OKLAB_GAMUT_EPS).toBe(1e-4)
    })

    test.each([
        '#fff', '#ffff', '#ffffff', '#ffffff80', '#fffff', '#fffffff', 'transparent', 'RED', 'rebeccapurple',
        'rgb(1 2 3)', 'rgb(1, 2, 3, 0.5)', 'rgb(10% 20% 30% / 50%)', 'rgba(300, 0, 0, 2)', 'rgb(from red r g b)',
        'hsl(120 50% 50%)', 'hsla(120deg, 50%, 50%, 0.3)', 'hsl(0 0% 20%)', 'hsl(0 0 20)',
        'color-mix(in srgb, red, blue)', 'color-mix(in srgb-linear, red 25%, yellow)', 'color-mix(in oklab, red, blue)',
        'color-mix(in oklab, #0000ff, #ffffff)', 'color-mix(in oklab, #0000ff, #ffffff 99.96%)', 'color-mix(in oklch, red, blue)',
        'color-mix(in srgb, #fff 50%, #000) ', 'color-mix(in srgb, 30% red, 30% blue)', 'color-mix(in srgb, red 0%, blue 0%)',
        'color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, #fff, #000), #000), #000)',
        'color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, #fff, #000), #000), #000), #000)',
        '', 'var(--x)', 'currentcolor', 'red !important',
    ])('%j', (text) => {
        expect(parseConcrete(text)).toEqual(reference.parseConcrete(text))
    })

    test('a seeded fuzz of 2000 colours, 600 of them oklab mixes', () => {
        const rand = seeded(20261118)
        const cases: string[] = []
        for (let i = 0; i < 600; i++) cases.push(`color-mix(in oklab, ${randomColour(rand, 1, ['oklab'])}, ${randomColour(rand, 1, ['oklab'])})`)
        for (let i = 0; i < 1400; i++) cases.push(randomColour(rand, 0, SPACES))
        let read = 0, refused = 0
        for (const text of cases) {
            const port: Rgba | null = parseConcrete(text)
            expect(port, text).toEqual(reference.parseConcrete(text))
            if (port) read++
            else refused++
        }
        // the generator reaches both outcomes in volume, so equality is not vacuous
        expect(read).toBeGreaterThan(500)
        expect(refused).toBeGreaterThan(200)
    })
})

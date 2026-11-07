import { describe, expect, test } from 'vitest'
import { studioLayoutOf } from './studioLayout'

describe('2b studio layout classes', () => {
    test('the class edges are 600 and 1024 inclusive on the wider side', () => {
        expect(studioLayoutOf(0)).toBe('stack')
        expect(studioLayoutOf(599)).toBe('stack')
        expect(studioLayoutOf(600)).toBe('drawer')
        expect(studioLayoutOf(1023)).toBe('drawer')
        expect(studioLayoutOf(1024)).toBe('wide')
        expect(studioLayoutOf(2560)).toBe('wide')
    })
})

import { describe, expect, test } from 'vitest'
import { parseBgmControl } from './bgmControl'

describe('parseBgmControl', () => {
    test('reads an automatic volume and a plain source', () => {
        expect(parseBgmControl('bgm___auto___/sw/img/6162')).toEqual({ volume: 0.5, src: '/sw/img/6162' })
    })

    test('reads an explicit volume', () => {
        expect(parseBgmControl('bgm___0.25___/sw/img/6162')).toEqual({ volume: 0.25, src: '/sw/img/6162' })
    })

    test('keeps everything after the second separator as the source when the URL itself holds the separator', () => {
        const url = '/api/asset/6173736574732f782e6d7033?risu-auth=head.pay___load.sig___end'
        expect(parseBgmControl(`bgm___auto___${url}`)).toEqual({ volume: 0.5, src: url })
    })

    test('answers null for a control that is not a bgm control', () => {
        expect(parseBgmControl('other___auto___x')).toBeNull()
    })
})

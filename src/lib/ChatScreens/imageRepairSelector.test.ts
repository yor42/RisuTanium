import { describe, expect, test } from 'vitest'
import { UNRESOLVED_IMAGE_SELECTOR } from './imageRepairSelector'

function pickedSrcs(srcs: string[], extra = ''): string[] {
    const root = document.createElement('div')
    root.innerHTML = srcs.map((src) => `<img src="${src}"${extra}>`).join('')
    return Array.from(root.querySelectorAll(UNRESOLVED_IMAGE_SELECTOR)).map((img) => img.getAttribute('src') ?? '')
}

describe('the image-repair selector', () => {
    test.each([
        ['an asset route URL', '/api/asset/6173736574732f782e706e67?risu-auth=aaa.bbb.ccc'],
        ['an asset-protocol URL', 'asset://localhost/Users/x/assets/pic.png'],
        ['a service-worker URL', '/sw/img/6162'],
        ['a data URL', 'data:image/png;base64,AAAA'],
        ['an absolute http URL', 'http://asset.localhost/pic.png'],
        ['a blob URL', 'blob:https://example.invalid/1234'],
    ])('leaves %s alone', (_label, src) => {
        expect(pickedSrcs([src])).toEqual([])
    })

    test('picks an image whose src is an asset name', () => {
        expect(pickedSrcs(['fox.png', '/api/asset/6162?risu-auth=t', 'bg.webp'])).toEqual(['fox.png', 'bg.webp'])
    })

    test('skips an image already marked noimage', () => {
        expect(pickedSrcs(['fox.png'], ' noimage="true"')).toEqual([])
    })
})

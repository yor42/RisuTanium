// @vitest-environment node
// A url() or string target in the chat sheet is an exact entry name: byte-equal to the name of a font entry inside a
// top-level @font-face block, or of an image entry anywhere else. No decoding, no case folding, no query stripping, and
// no extension or path test decides the kind: the verified file map does.
import { describe, expect, it } from 'vitest'
import { judgePackSheets } from './index'
import { intakePack, type IntakeRefusal, type IntakeResult, type PackJudge } from './intake'
import { fakeFont, manifestText, PNG_1X1, spySource, validPackFiles, zipPack } from './fixtures/packBuilder'

const judge: PackJudge = async (sheets) => judgePackSheets(sheets)
const LEAF = '[data-part="chat-message-avatar"]'
const FACE = (src: string) => `@font-face{font-family:pack-x;src:${src}}`

function packWith(css: string): Uint8Array {
    return zipPack(validPackFiles({
        'manifest.json': manifestText({ fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }] }),
        'chat.css': css,
        'images/a.png': PNG_1X1,
        'fonts/a.woff2': fakeFont(),
        'fonts/OFL.txt': 'licence text',
        'studio.css': 'a{}',
        '__MACOSX/images/a.png': PNG_1X1,
        '.DS_Store': 'finder',
    }))
}

async function refusalsFor(css: string): Promise<readonly IntakeRefusal[]> {
    const result: IntakeResult = await intakePack(spySource(packWith(css)), judge)
    return result.ok === false ? result.refusals : []
}

const image = (target: string) => `${LEAF}{background-image:url(${target})}`

describe('T1-27 exact-name targets', () => {
    it.each([
        'images/a%2Epng',
        'images/%61.png',
        'images/a.png?x',
        'images/a.png#x',
        './images/a.png',
        'images/A.png',
    ])('%s names no entry', async (target) => {
        expect(await refusalsFor(image(target))).toEqual([{ code: 'target', sheet: 'chat.css', target }])
    })

    it('the exact name is accepted quoted and unquoted, and a font inside @font-face is accepted', async () => {
        expect(await refusalsFor(`${LEAF}{background-image:url("images/a.png")}`)).toEqual([])
        expect(await refusalsFor(image('images/a.png'))).toEqual([])
        expect(await refusalsFor(FACE('url(fonts/a.woff2) format("woff2")'))).toEqual([])
    })

    it('a font outside @font-face and an image inside it are the wrong kind', async () => {
        expect(await refusalsFor(image('fonts/a.woff2'))).toEqual([{ code: 'wrongKind', sheet: 'chat.css', target: 'fonts/a.woff2' }])
        expect(await refusalsFor(FACE('url(images/a.png)'))).toEqual([{ code: 'wrongKind', sheet: 'chat.css', target: 'images/a.png' }])
    })

    it('a licence text inside @font-face and a sheet outside it are the wrong kind', async () => {
        expect(await refusalsFor(FACE('url("fonts/OFL.txt")'))).toEqual([{ code: 'wrongKind', sheet: 'chat.css', target: 'fonts/OFL.txt' }])
        expect(await refusalsFor(`${LEAF}{background-image:url("studio.css")}`)).toEqual([{ code: 'wrongKind', sheet: 'chat.css', target: 'studio.css' }])
    })

    it('an ignored entry named by the sheet is the wrong kind, not an image', async () => {
        expect(await refusalsFor(`${LEAF}{background-image:url("__MACOSX/images/a.png")}`)).toEqual([{ code: 'wrongKind', sheet: 'chat.css', target: '__MACOSX/images/a.png' }])
        expect(await refusalsFor(`${LEAF}{background-image:url(".DS_Store")}`)).toEqual([{ code: 'wrongKind', sheet: 'chat.css', target: '.DS_Store' }])
    })
})

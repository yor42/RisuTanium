import { describe, expect, test } from 'vitest'
import {
    anniversaryOrdinal, anniversaryText, easterMonthDay, lunarMonthDay, msUntilLocalMidnight, OCCASION_KEYS,
    resolveOccasion, resolveOccasionDetail, type LunarAnchor, type LunarCalendar,
    type ResolveOptions,
} from './calendar'
import { LUNAR_TABLE, LUNAR_TABLE_RANGE } from './lunarTable'

// The reference below is written independently from the priority table (Intl directly, Tøndering's Easter), and
// is compared with the module for every day 2026-2060 in five lunar modes.

const RealDTF = Intl.DateTimeFormat
const fDangi = new RealDTF('en-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
const fChinese = new RealDTF('en-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })

/** An engine whose Intl ignores the calendar extension and formats Gregorian, as engines without it do. */
class IgnoringDTF extends RealDTF {
    constructor(locales: string, options: Intl.DateTimeFormatOptions) {
        super(locales.replace(/-u-ca-[a-z]+/, ''), options)
    }
}
/** An engine whose Intl throws for any calendar extension. */
class ThrowingDTF extends RealDTF {
    constructor(locales: string, options: Intl.DateTimeFormatOptions) {
        if (/-u-ca-/.test(locales)) throw new RangeError('no calendar')
        super(locales, options)
    }
}
/** An engine whose Intl zero-pads the numeric month and day ('01', '08bis'), as the Android Note 9 WebView does. */
class PaddingDTF extends RealDTF {
    formatToParts(date?: Date | number): Intl.DateTimeFormatPart[] {
        return super.formatToParts(date).map((p) => (p.type === 'month' || p.type === 'day'
            ? { ...p, value: p.value.replace(/^\d+/, (n) => n.padStart(2, '0')) }
            : p))
    }
}

function lunar(f: Intl.DateTimeFormat, y: number, m: number, d: number): { month: string, day: number } {
    const p = f.formatToParts(new Date(Date.UTC(y, m - 1, d)))
    return { month: p.find((x) => x.type === 'month')!.value, day: Number(p.find((x) => x.type === 'day')!.value) }
}

function easterRef(Y: number): { m: number, d: number } {
    const G = Y % 19, C = Math.floor(Y / 100)
    const H = (C - Math.floor(C / 4) - Math.floor((8 * C + 13) / 25) + 19 * G + 15) % 30
    const I = H - Math.floor(H / 28) * (1 - Math.floor(29 / (H + 1)) * Math.floor((21 - G) / 11))
    const J = (Y + Math.floor(Y / 4) + I + 2 - C + Math.floor(C / 4)) % 7
    const L = I - J, month = 3 + Math.floor((L + 40) / 44)
    return { m: month, d: L + 28 - 31 * Math.floor(month / 4) }
}

const KO = (l: string) => l === 'ko'
const ZH = (l: string) => l === 'cn' || l === 'zh' || l === 'zh-Hant'
const JA = (l: string) => l === 'ja'
const VI = (l: string) => l === 'vi'
const WEST = (l: string) => l === 'en' || l === 'de' || l === 'es'

interface DayLunar { dg: { month: string, day: number }, cn: { month: string, day: number }, dgNext: { month: string, day: number } }

function dayLunar(y: number, m: number, d: number): DayLunar {
    const nx = new Date(Date.UTC(y, m - 1, d + 1))
    return {
        dg: lunar(fDangi, y, m, d),
        cn: lunar(fChinese, y, m, d),
        dgNext: lunar(fDangi, nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate()),
    }
}

function expected(y: number, m: number, d: number, lang: string, { dg, cn, dgNext }: DayLunar): string {
    if (m === 9 && d === 21 && y >= 2027) return 'anniversary'
    const L = (r: { month: string, day: number }, mo: string, a: number, b = a) => r.month === mo && r.day >= a && r.day <= b
    if (KO(lang) && (L(dg, '1', 1, 2) || L(dgNext, '1', 1))) return 'seollal'
    if ((ZH(lang) || VI(lang)) && L(cn, '1', 1, 3)) return 'springFestival'
    if (KO(lang) && L(dg, '8', 14, 16)) return 'chuseok'
    if (ZH(lang) && L(cn, '8', 15)) return 'midAutumn'
    if (JA(lang) && L(cn, '8', 15)) return 'tsukimi'
    if ((KO(lang) && L(dg, '5', 5)) || (ZH(lang) && L(cn, '5', 5))) return 'dano'
    if ((JA(lang) && m === 7 && d === 7) || (KO(lang) && L(dg, '7', 7)) || (ZH(lang) && L(cn, '7', 7))) return 'starFestival'
    if (KO(lang) && ((m === 3 && d === 1) || (m === 8 && d === 15))) return 'krNational'
    if (KO(lang) && m === 10 && d === 9) return 'hangulDay'
    if ((KO(lang) || JA(lang)) && m === 5 && d === 5) return 'childrenDay'
    if (JA(lang) && m === 8 && d >= 13 && d <= 16) return 'obon'
    if (JA(lang) && m === 11 && d === 3) return 'bunkaNoHi'
    if (m === 12 && d >= 19 && d <= 25) return 'christmas'
    if (m === 1 && d >= 1 && d <= 3) return 'newYear'
    if (m === 2 && d === 14) return 'valentine'
    if (WEST(lang) && m === 3 && d === 17) return 'stPatricksDay'
    const e = easterRef(y)
    if (WEST(lang) && m === e.m && d === e.d) return 'easter'
    if (m === 4 && d === 1) return 'aprilFool'
    if (m === 10 && d === 31) return 'halloween'
    if (lang === 'en' && m === 7 && d === 4) return 'independenceDay'
    if (lang === 'en' && m === 11 && new Date(Date.UTC(y, 10, d)).getUTCDay() === 4 && d >= 22 && d <= 28) return 'thanksgiving'
    if ((KO(lang) || JA(lang)) && ((m === 3 && d >= 25) || (m === 4 && d <= 7))) return 'sakura'
    if (m === 6 && (d === 20 || d === 21)) return 'summerSolstice'
    return ''
}

const LANGS = ['ko', 'cn', 'zh', 'zh-Hant', 'vi', 'ja', 'en', 'de', 'es', 'ko-KR', 'zh-TW']
const MODES: Record<string, ResolveOptions> = {
    intl: {},
    table: { lunar: 'table' },
    noIntl: { dateTimeFormat: IgnoringDTF },
    throws: { dateTimeFormat: ThrowingDTF },
    padded: { dateTimeFormat: PaddingDTF },
}

describe('seasonal calendar', () => {
    test('this Node has the dangi and chinese calendars the reference needs', () => {
        expect(fDangi.resolvedOptions().calendar).toBe('dangi')
        expect(fChinese.resolvedOptions().calendar).toBe('chinese')
    })

    test('engines without the lunar calendars are detected and fall back to the table', () => {
        expect(lunarMonthDay(2026, 9, 25, 'dangi', 'intl', IgnoringDTF)).toBeNull()
        expect(lunarMonthDay(2026, 9, 25, 'chinese', 'intl', ThrowingDTF)).toBeNull()
        expect(lunarMonthDay(2026, 9, 25, 'dangi', 'auto', IgnoringDTF)?.source).toBe('table')
        expect(lunarMonthDay(2026, 9, 25, 'dangi', 'auto', ThrowingDTF)?.source).toBe('table')
    })

    // Guards: an engine that zero-pads Intl's numeric parts ('01') never matching a lunar anchor ('1').
    test('zero-padded Intl months and days read as the unpadded lunar date', () => {
        expect(lunarMonthDay(2027, 2, 7, 'dangi', 'intl', PaddingDTF)).toEqual({ month: '1', day: 1, source: 'intl' })
        expect(resolveOccasion(new Date(2027, 1, 7, 12), 'ko', { dateTimeFormat: PaddingDTF })).toBe('seollal')
    })

    // The Intl cross-check: the embedded fallback table equals what this Node's Intl says for every anchor.
    test('the lunar table matches Intl dangi and chinese for every anchor 2026-2060', () => {
        const [first, last] = LUNAR_TABLE_RANGE
        const pad = (n: number) => String(n).padStart(2, '0')
        const anchors: LunarAnchor[] = ['1-1', '5-5', '7-7', '8-15']
        for (const cal of ['dangi', 'chinese'] as LunarCalendar[]) {
            const f = cal === 'dangi' ? fDangi : fChinese
            const fromIntl: Record<string, Record<number, string>> = { '1-1': {}, '5-5': {}, '7-7': {}, '8-15': {} }
            for (let t = Date.UTC(first, 0, 1); t <= Date.UTC(last, 11, 31); t += 864e5) {
                const u = new Date(t)
                const p = f.formatToParts(u)
                const key = p.find((x) => x.type === 'month')!.value + '-' + Number(p.find((x) => x.type === 'day')!.value)
                const slot = fromIntl[key]
                if (!slot) continue
                const y = u.getUTCFullYear()
                expect(slot[y], `duplicate ${cal} ${key} in ${y}`).toBeUndefined()
                slot[y] = pad(u.getUTCMonth() + 1) + '-' + pad(u.getUTCDate())
            }
            for (const a of anchors) {
                expect(Object.keys(fromIntl[a])).toHaveLength(last - first + 1)
                expect(LUNAR_TABLE[cal][a], `${cal} ${a}`).toEqual(fromIntl[a])
            }
        }
    })

    test('every day 2026-2060 matches the reference in every language and lunar mode', () => {
        const failures: string[] = []
        const counts: Record<string, Record<string, number>> = {}
        for (const name of Object.keys(MODES)) counts[name] = {}
        let checks = 0
        for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2060, 11, 31); t += 864e5) {
            const u = new Date(t)
            const y = u.getUTCFullYear(), m = u.getUTCMonth() + 1, d = u.getUTCDate()
            const local = new Date(y, m - 1, d, 12)
            const ref = dayLunar(y, m, d)
            for (const lang of LANGS) {
                const want = expected(y, m, d, lang, ref)
                for (const [name, opt] of Object.entries(MODES)) {
                    const got = resolveOccasion(local, lang, opt)
                    checks++
                    if (got !== want && failures.length < 40) failures.push(`${name} ${y}-${m}-${d} ${lang}: got "${got}", want "${want}"`)
                    if (got) counts[name][got] = (counts[name][got] ?? 0) + 1
                }
            }
            // Local midnight edges map to the same calendar date.
            if (m === 9) {
                for (const edge of [new Date(y, m - 1, d, 0, 0, 0), new Date(y, m - 1, d, 23, 59, 59)]) {
                    const got = resolveOccasion(edge, 'ko')
                    const want = expected(y, m, d, 'ko', ref)
                    if (got !== want && failures.length < 40) failures.push(`edge ${edge.toString()}: got "${got}", want "${want}"`)
                }
            }
        }
        expect(failures).toEqual([])
        expect(checks).toBe(12784 * LANGS.length * Object.keys(MODES).length)
        // Every occasion shows somewhere in the range, in every mode.
        for (const name of Object.keys(MODES)) {
            for (const key of OCCASION_KEYS) expect(counts[name][key] ?? 0, `${name} ${key}`).toBeGreaterThan(0)
        }
    }, 120_000)

    test('a leap 8th month is not Chuseok (2052-10-07 is dangi 8bis/15)', () => {
        expect(lunar(fDangi, 2052, 10, 7).month).toBe('8bis')
        expect(resolveOccasion(new Date(2052, 9, 7, 12), 'ko')).toBe('')
    })

    test('collisions follow the priority order', () => {
        expect(resolveOccasion(new Date(2029, 8, 21, 12), 'ko')).toBe('anniversary')
        expect(resolveOccasion(new Date(2029, 8, 22, 12), 'ko')).toBe('chuseok')
        expect(resolveOccasion(new Date(2029, 8, 23, 12), 'ko', { lunar: 'table' })).toBe('chuseok')
        expect(resolveOccasion(new Date(2026, 8, 21, 12), 'en')).toBe('')
        expect(resolveOccasion(new Date(2029, 1, 12, 12), 'ko')).toBe('seollal')
        expect(resolveOccasion(new Date(2029, 1, 14, 12), 'ko')).toBe('seollal')
        expect(resolveOccasion(new Date(2029, 1, 14, 12), 'en')).toBe('valentine')
        expect(resolveOccasion(new Date(2029, 3, 1, 12), 'en')).toBe('easter')
        expect(resolveOccasion(new Date(2029, 3, 1, 12), 'ko')).toBe('aprilFool')
    })

    test('outside the table only Intl answers lunar days', () => {
        expect(resolveOccasion(new Date(2061, 8, 30, 12), 'ko', { dateTimeFormat: IgnoringDTF })).toBe('')
        expect(resolveOccasion(new Date(2061, 8, 30, 12), 'ko')).toBe(expected(2061, 9, 30, 'ko', dayLunar(2061, 9, 30)))
    })

    test("'cn' is Simplified Chinese", () => {
        expect(resolveOccasion(new Date(2026, 8, 25, 12), 'cn')).toBe('midAutumn')
        expect(resolveOccasion(new Date(2026, 8, 25, 12), 'cn', { lunar: 'table' })).toBe('midAutumn')
    })

    test('the table answers every lunar anchor, not only 8/14-16', () => {
        const cases: [LunarCalendar, number, number, number, string][] = [
            ['dangi', 2026, 2, 17, '1/1'], ['dangi', 2026, 6, 19, '5/5'], ['dangi', 2026, 8, 19, '7/7'],
            ['chinese', 2028, 1, 26, '1/1'], ['dangi', 2028, 1, 27, '1/1'],
        ]
        for (const [cal, y, m, d, want] of cases) {
            const r = lunarMonthDay(y, m, d, cal, 'table')
            expect(r && r.month + '/' + r.day).toBe(want)
        }
        // The table window for 1/1 starts on 1/1 itself: the days before it are not lunar holiday days.
        expect(lunarMonthDay(2026, 2, 16, 'dangi', 'table')?.month).toBe('other')
        expect(lunarMonthDay(2026, 2, 14, 'dangi', 'table')?.month).toBe('other')
    })

    test('Easter dates', () => {
        for (const [y, m, d] of [[2026, 4, 5], [2027, 3, 28], [2028, 4, 16], [2029, 4, 1], [2030, 4, 21], [2035, 3, 25], [2038, 4, 25], [2057, 4, 22]]) {
            expect(easterMonthDay(y)).toEqual({ m, d })
            expect(easterRef(y)).toEqual({ m, d })
        }
    })

    test('krNational variants', () => {
        expect(resolveOccasionDetail(new Date(2027, 2, 1, 12), 'ko').variant).toBe('samiljeol')
        expect(resolveOccasionDetail(new Date(2027, 7, 15, 12), 'ko').variant).toBe('gwangbokjeol')
        expect(resolveOccasionDetail(new Date(2027, 11, 25, 12), 'ko').variant).toBe('')
    })

    test('anniversary text', () => {
        const cases: [number, string][] = [
            [2026, ''], [2025, ''], [2027, 'Happy 1st Anniversary!'], [2028, 'Happy 2nd Anniversary!'], [2029, 'Happy 3rd Anniversary!'],
            [2030, 'Happy 4th Anniversary!'], [2037, 'Happy 11th Anniversary!'], [2038, 'Happy 12th Anniversary!'], [2039, 'Happy 13th Anniversary!'],
            [2047, 'Happy 21st Anniversary!'], [2048, 'Happy 22nd Anniversary!'], [2137, 'Happy 111th Anniversary!'],
        ]
        for (const [y, want] of cases) expect(anniversaryText(y)).toBe(want)
        expect(anniversaryOrdinal(2029)).toBe('3rd')
    })

    test('time to the next local midnight', () => {
        expect(msUntilLocalMidnight(new Date(2026, 11, 24, 23, 59, 59, 0))).toBe(1000)
        expect(msUntilLocalMidnight(new Date(2026, 11, 31, 12, 0, 0, 0))).toBe(new Date(2027, 0, 1).getTime() - new Date(2026, 11, 31, 12).getTime())
    })
})

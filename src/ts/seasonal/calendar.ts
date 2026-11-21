// Seasonal logo calendar: which occasion, if any, the top-bar logo celebrates on a device-local date in a UI
// language. Pure: no DOM, no storage, no clock (callers pass the date).
//
// Language codes are the values of DBState.db.language. Matching is exact ('ko-KR' matches nothing). 'cn' and
// 'zh' are Simplified Chinese, 'zh-Hant' Traditional; West is en, de and es.
//
// Lunar dates come from Intl's dangi (Korean days) or chinese (Chinese, Vietnamese and Japanese days) calendar.
// Where Intl lacks the calendar the embedded table answers for 2026-2060; outside it lunar occasions do not show.
import { LUNAR_TABLE } from './lunarTable'

/** Every occasion, in priority order: the first one whose rule matches wins. */
export const OCCASION_KEYS = [
    'anniversary',
    'seollal', 'springFestival', 'chuseok', 'midAutumn', 'tsukimi', 'dano', 'starFestival',
    'krNational', 'hangulDay', 'childrenDay', 'obon', 'bunkaNoHi',
    'christmas', 'newYear', 'valentine', 'stPatricksDay', 'easter', 'aprilFool', 'halloween', 'independenceDay', 'thanksgiving',
    'sakura', 'summerSolstice',
] as const

export type OccasionKey = typeof OCCASION_KEYS[number]

/** Only krNational has more than one look: Mar 1 (3·1절) or Aug 15 (광복절). */
export type OccasionVariant = '' | 'samiljeol' | 'gwangbokjeol'

export type LunarCalendar = 'dangi' | 'chinese'
export type LunarAnchor = '1-1' | '5-5' | '7-7' | '8-15'
/** auto: Intl, else the table. intl: Intl only. table: the table only. */
export type LunarMode = 'auto' | 'intl' | 'table'

/**
 * A lunar month and day. `month` is Intl's month string, so a leap month reads '8bis' and never equals '8'.
 * The table knows only the days around its anchors and reports any other day of a covered year as 'other'.
 */
export interface LunarDate {
    month: string
    day: number
    source: 'intl' | 'table'
}

export type DateTimeFormatConstructor = new (locales: string, options: Intl.DateTimeFormatOptions) => Intl.DateTimeFormat

export interface ResolveOptions {
    lunar?: LunarMode
    /** The Intl.DateTimeFormat to read lunar dates with; tests pass engines without the lunar calendars. */
    dateTimeFormat?: DateTimeFormatConstructor
}

export interface OccasionDetail {
    key: OccasionKey | ''
    variant: OccasionVariant
    /** Why this occasion (or none) was chosen, in English, for diagnostics. */
    reason: string
    y: number
    m: number
    d: number
    lang: string
}

/** The fork started on 2026-09-21; the Nth anniversary is in year 2026 + N. */
export const FORK_YEAR = 2026

const isKo = (l: string): boolean => l === 'ko'
const isZh = (l: string): boolean => l === 'cn' || l === 'zh' || l === 'zh-Hant'
const isJa = (l: string): boolean => l === 'ja'
const isVi = (l: string): boolean => l === 'vi'
const isWestern = (l: string): boolean => l === 'en' || l === 'de' || l === 'es'

// An engine without a calendar usually does not throw: it silently formats Gregorian, so the resolved calendar
// is checked. null means the calendar is unavailable.
const formatterCache = new WeakMap<DateTimeFormatConstructor, Map<LunarCalendar, Intl.DateTimeFormat | null>>()

function intlFormatter(cal: LunarCalendar, ctor: DateTimeFormatConstructor): Intl.DateTimeFormat | null {
    let byCal = formatterCache.get(ctor)
    if (!byCal) {
        byCal = new Map()
        formatterCache.set(ctor, byCal)
    }
    const cached = byCal.get(cal)
    if (cached !== undefined) return cached
    let f: Intl.DateTimeFormat | null = null
    try {
        f = new ctor('en-u-ca-' + cal, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
        if (typeof f.formatToParts !== 'function' || f.resolvedOptions().calendar !== cal) f = null
    } catch {
        f = null
    }
    byCal.set(cal, f)
    return f
}

function lunarFromIntl(y: number, m: number, d: number, cal: LunarCalendar, ctor: DateTimeFormatConstructor): LunarDate | null {
    const f = intlFormatter(cal, ctor)
    if (!f) return null
    try {
        const parts = f.formatToParts(new Date(Date.UTC(y, m - 1, d)))
        let month: string | null = null
        let day = NaN
        for (const p of parts) {
            if (p.type === 'month') month = p.value
            else if (p.type === 'day') day = parseInt(p.value, 10)
        }
        if (month === null || !Number.isFinite(day)) return null
        return { month, day, source: 'intl' }
    } catch {
        return null
    }
}

function dayNumber(y: number, m: number, d: number): number {
    return Math.round(Date.UTC(y, m - 1, d) / 864e5)
}

const ANCHORS: readonly LunarAnchor[] = ['1-1', '5-5', '7-7', '8-15']

// Lunar 1/1-1/4 and anchor day ±3 for 5/5, 7/7 and 8/15. The eve of 1/1 is found by asking about the next day.
function lunarFromTable(y: number, m: number, d: number, cal: LunarCalendar): LunarDate | null {
    const t = LUNAR_TABLE[cal]
    const dn = dayNumber(y, m, d)
    let covered = false
    for (const a of ANCHORS) {
        const s = t[a][y]
        if (!s) continue
        covered = true
        const [lm, ldText] = a.split('-')
        const ld = parseInt(ldText, 10)
        const diff = dn - dayNumber(y, parseInt(s.slice(0, 2), 10), parseInt(s.slice(3, 5), 10))
        if (diff >= (ld === 1 ? 0 : -3) && diff <= 3) return { month: lm, day: ld + diff, source: 'table' }
    }
    return covered ? { month: 'other', day: NaN, source: 'table' } : null
}

export function lunarMonthDay(
    y: number, m: number, d: number, cal: LunarCalendar,
    mode: LunarMode = 'auto', ctor: DateTimeFormatConstructor = Intl.DateTimeFormat,
): LunarDate | null {
    if (mode !== 'table') {
        const r = lunarFromIntl(y, m, d, cal, ctor)
        if (r || mode === 'intl') return r
    }
    return lunarFromTable(y, m, d, cal)
}

/** Western Easter Sunday (anonymous Gregorian computus). */
export function easterMonthDay(y: number): { m: number, d: number } {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451)
    const n = h + l - 7 * mm + 114
    return { m: Math.floor(n / 31), d: (n % 31) + 1 }
}

/** US Thanksgiving: the fourth Thursday of November. */
function isFourthThursdayOfNov(y: number, m: number, d: number): boolean {
    return m === 11 && d >= 22 && d <= 28 && new Date(Date.UTC(y, 10, d)).getUTCDay() === 4
}

export function occasionVariant(key: OccasionKey | '', date: Date): OccasionVariant {
    if (key !== 'krNational') return ''
    return date.getMonth() + 1 === 8 ? 'gwangbokjeol' : 'samiljeol'
}

function pad2(n: number): string {
    return (n < 10 ? '0' : '') + n
}

/** Reads the device-local calendar date of `date`. */
export function resolveOccasionDetail(date: Date, language: string | null | undefined, options: ResolveOptions = {}): OccasionDetail {
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
    const lang = language == null ? '' : String(language)
    const mode = options.lunar ?? 'auto'
    const ctor = options.dateTimeFormat ?? Intl.DateTimeFormat
    const dangi = lunarMonthDay(y, m, d, 'dangi', mode, ctor)
    const chinese = lunarMonthDay(y, m, d, 'chinese', mode, ctor)
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    const dangiNext = lunarMonthDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 'dangi', mode, ctor)
    const fmt = (r: LunarDate | null, cal: LunarCalendar): string => {
        if (!r) return 'lunar ' + cal + ' unavailable'
        return r.month === 'other' ? 'not a lunar holiday day (' + cal + ', ' + r.source + ')'
            : 'lunar ' + r.month + '/' + r.day + ' ' + cal + ' (' + r.source + ')'
    }
    const is = (r: LunarDate | null, mo: string, d1: number, d2: number = d1): boolean =>
        !!r && r.month === mo && r.day >= d1 && r.day <= d2
    const out = (key: OccasionKey | '', reason: string): OccasionDetail =>
        ({ key, variant: occasionVariant(key, date), reason, y, m, d, lang })
    const L = ', lang "' + lang + '"'
    const easter = easterMonthDay(y)

    if (m === 9 && d === 21 && y >= FORK_YEAR + 1) return out('anniversary', 'Sep 21, ' + y + ' (N = ' + (y - FORK_YEAR) + ')')
    // Lunar days by locale.
    if (isKo(lang) && (is(dangi, '1', 1, 2) || is(dangiNext, '1', 1))) {
        return out('seollal', (is(dangi, '1', 1, 2) ? fmt(dangi, 'dangi') : 'eve of lunar 1/1 dangi') + L)
    }
    if ((isZh(lang) || isVi(lang)) && is(chinese, '1', 1, 3)) return out('springFestival', fmt(chinese, 'chinese') + L)
    if (isKo(lang) && is(dangi, '8', 14, 16)) return out('chuseok', fmt(dangi, 'dangi') + L)
    if (isZh(lang) && is(chinese, '8', 15)) return out('midAutumn', fmt(chinese, 'chinese') + L)
    if (isJa(lang) && is(chinese, '8', 15)) return out('tsukimi', fmt(chinese, 'chinese') + L)
    if (isKo(lang) && is(dangi, '5', 5)) return out('dano', fmt(dangi, 'dangi') + L)
    if (isZh(lang) && is(chinese, '5', 5)) return out('dano', fmt(chinese, 'chinese') + L)
    if (isJa(lang) && m === 7 && d === 7) return out('starFestival', 'Jul 7 (solar Tanabata)' + L)
    if (isKo(lang) && is(dangi, '7', 7)) return out('starFestival', fmt(dangi, 'dangi') + L)
    if (isZh(lang) && is(chinese, '7', 7)) return out('starFestival', fmt(chinese, 'chinese') + L)
    // Fixed days by locale.
    if (isKo(lang) && ((m === 3 && d === 1) || (m === 8 && d === 15))) return out('krNational', (m === 3 ? 'Mar 1 (3·1절)' : 'Aug 15 (광복절)') + L)
    if (isKo(lang) && m === 10 && d === 9) return out('hangulDay', 'Oct 9' + L)
    if ((isKo(lang) || isJa(lang)) && m === 5 && d === 5) return out('childrenDay', 'May 5' + L)
    if (isJa(lang) && m === 8 && d >= 13 && d <= 16) return out('obon', 'Aug 13-16' + L)
    if (isJa(lang) && m === 11 && d === 3) return out('bunkaNoHi', 'Nov 3' + L)
    // Global and Western days.
    if (m === 12 && d >= 19 && d <= 25) return out('christmas', 'Dec 19-25')
    if (m === 1 && d <= 3) return out('newYear', 'Jan 1-3')
    if (m === 2 && d === 14) return out('valentine', 'Feb 14')
    if (isWestern(lang) && m === 3 && d === 17) return out('stPatricksDay', 'Mar 17' + L)
    if (isWestern(lang) && m === easter.m && d === easter.d) return out('easter', 'Easter Sunday ' + y + L)
    if (m === 4 && d === 1) return out('aprilFool', 'Apr 1')
    if (m === 10 && d === 31) return out('halloween', 'Oct 31')
    if (lang === 'en' && m === 7 && d === 4) return out('independenceDay', 'Jul 4' + L)
    if (lang === 'en' && isFourthThursdayOfNov(y, m, d)) return out('thanksgiving', 'fourth Thursday of November' + L)
    // The two windows last, so a single day inside them wins.
    if ((isKo(lang) || isJa(lang)) && ((m === 3 && d >= 25) || (m === 4 && d <= 7))) return out('sakura', 'Mar 25-Apr 7' + L)
    if (m === 6 && (d === 20 || d === 21)) return out('summerSolstice', 'Jun 20-21')

    return out('', 'no occasion on ' + pad2(m) + '-' + pad2(d) + L)
}

export function resolveOccasion(date: Date, language: string | null | undefined, options?: ResolveOptions): OccasionKey | '' {
    return resolveOccasionDetail(date, language, options).key
}

function ordinalSuffix(n: number): string {
    const a = n % 100
    if (a >= 11 && a <= 13) return 'th'
    switch (n % 10) {
        case 1: return 'st'
        case 2: return 'nd'
        case 3: return 'rd'
        default: return 'th'
    }
}

/** '1st' for 2027; '' before the first anniversary. */
export function anniversaryOrdinal(year: number): string {
    const n = Math.floor(year) - FORK_YEAR
    return Number.isFinite(n) && n >= 1 ? n + ordinalSuffix(n) : ''
}

/** 'Happy 1st Anniversary!' for 2027; '' before the first anniversary. */
export function anniversaryText(year: number): string {
    const o = anniversaryOrdinal(year)
    return o ? 'Happy ' + o + ' Anniversary!' : ''
}

/** Milliseconds from `now` to the next device-local midnight, when the occasion is recomputed. */
export function msUntilLocalMidnight(now: Date): number {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return next.getTime() - now.getTime()
}

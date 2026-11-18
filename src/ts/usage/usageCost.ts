import type { CostResult, DecimalString, PriceOverride, PriceSource, TokenUsage } from './usageTypes'

/**
 * Exact decimal cost in BigInt. A decimal is `digits / 10^scale`; nothing goes
 * through floating point, and rounding is left to the display layer.
 */
interface Decimal {
    digits: bigint
    scale: number
}

/** Beyond this many places or exponent magnitude a price string is treated as unreadable. */
const MAX_SCALE = 60

/** Overrides are USD per 1M tokens: one price token is worth 10^-6 of it. */
const PER_MILLION_SHIFT = 6

const DECIMAL_RULE = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/

const KINDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

function parseDecimal(text: string | undefined): Decimal | null {
    if (typeof text !== 'string') {
        return null
    }
    const match = DECIMAL_RULE.exec(text.trim())
    if (match === null) {
        return null
    }
    const fraction = match[2] ?? ''
    const exponent = match[3] === undefined ? 0 : Number(match[3])
    if (!Number.isInteger(exponent) || Math.abs(exponent) > MAX_SCALE) {
        return null
    }
    let digits = BigInt(match[1] + fraction)
    let scale = fraction.length - exponent
    if (scale < 0) {
        digits *= 10n ** BigInt(-scale)
        scale = 0
    }
    return scale > MAX_SCALE * 2 ? null : { digits, scale }
}

function format(digits: bigint, scale: number): DecimalString {
    const text = digits.toString().padStart(scale + 1, '0')
    const whole = text.slice(0, text.length - scale)
    const fraction = text.slice(text.length - scale).replace(/0+$/, '')
    return fraction === '' ? whole : `${whole}.${fraction}`
}

/**
 * Cost of `tokens` at `price`. A catalog price is USD per token; an override is
 * USD per 1M tokens and is used as a whole object, never completed field by field.
 * A kind with tokens and no readable price (cache kinds included) makes the result
 * `partial`, or `unpriced` when no kind with tokens is priced. A result with
 * nothing to price is `priced` only when the price has at least one readable
 * field, so an unpriced model never shows $0.
 */
export function costOf(tokens: TokenUsage, price: PriceOverride | undefined, source: PriceSource): CostResult {
    const shift = source === 'override' ? PER_MILLION_SHIFT : 0
    const terms: Decimal[] = []
    let missing = 0
    let anyPrice = false
    for (const kind of KINDS) {
        const unit = parseDecimal(price?.[kind])
        if (unit !== null) {
            anyPrice = true
        }
        const amount = tokens[kind]
        if (amount <= 0) {
            continue
        }
        if (unit === null) {
            missing++
            continue
        }
        terms.push({ digits: unit.digits * BigInt(amount), scale: unit.scale + shift })
    }
    if (terms.length === 0) {
        if (missing > 0 || !anyPrice) {
            return { status: 'unpriced' }
        }
        return { status: 'priced', usd: '0' }
    }
    const scale = terms.reduce((max, term) => Math.max(max, term.scale), 0)
    let sum = 0n
    for (const term of terms) {
        sum += term.digits * 10n ** BigInt(scale - term.scale)
    }
    return { status: missing > 0 ? 'partial' : 'priced', usd: format(sum, scale) }
}

// The shape checker that gates every output file. It walks a SHAPE tree and returns violations.
// A violation message names the SHAPE path of the parent and a key index, never an offending key or value,
// because either could be data.
import { SHAPE, type Shape } from './schema'

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

function walk(value: unknown, shape: Shape, where: string, out: string[]): void {
    if (shape === 'n') {
        if (!isNumber(value)) out.push(where + ': expected a finite number >= 0')
        return
    }
    if (shape === 'i') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < -1) out.push(where + ': expected an integer >= -1')
        return
    }
    if (shape === 'n[]') {
        if (!Array.isArray(value)) {
            out.push(where + ': expected an array of numbers')
            return
        }
        for (const element of value) {
            if (!isNumber(element)) {
                out.push(where + ': an array element is not a finite number >= 0')
                return
            }
        }
        return
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        out.push(where + ': expected an object')
        return
    }
    const record = value as Record<string, unknown>
    let unexpected = 0
    for (const key of Object.keys(record)) {
        if (!Object.prototype.hasOwnProperty.call(shape, key)) {
            unexpected += 1
            out.push(where + ': unexpected key #' + unexpected)
        }
    }
    for (const key of Object.keys(shape)) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            out.push(where + '.' + key + ': missing')
            continue
        }
        walk(record[key], shape[key], where + '.' + key, out)
    }
}

/** Violations of `shape` by `value`; an empty list means the value conforms. */
export function checkShape(value: unknown, shape: Shape): string[] {
    const out: string[] = []
    walk(value, shape, '$', out)
    return out
}

/** Violations of the aggregate SHAPE by `value`. */
export function checkAggregates(value: unknown): string[] {
    return checkShape(value, SHAPE)
}

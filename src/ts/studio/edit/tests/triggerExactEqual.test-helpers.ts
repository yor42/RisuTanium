// Strict structural comparison for the classic-parity tests: a Studio result must equal what the classic
// editor wrote, down to key order, `NaN`, and a missing key versus a key holding `undefined`.
// Identity is not compared: an array that holds the same object twice equals two equal objects.

const describeValue = (value: unknown): string => {
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return String(value)
    if (Array.isArray(value)) return `array(${value.length})`
    if (typeof value === 'object') return `object{${Object.keys(value).join(',')}}`
    return typeof value
}

/** The first difference between `actual` and `expected` as `path: ...`, or `null` when they are exactly equal. */
export function firstDifference(actual: unknown, expected: unknown, path = '$'): string | null {
    const actualIsObject = typeof actual === 'object' && actual !== null
    const expectedIsObject = typeof expected === 'object' && expected !== null
    if (!actualIsObject || !expectedIsObject) {
        if (Object.is(actual, expected)) return null
        return `${path}: expected ${describeValue(expected)}, actual ${describeValue(actual)}`
    }
    const actualIsArray = Array.isArray(actual)
    if (actualIsArray !== Array.isArray(expected)) {
        return `${path}: expected ${describeValue(expected)}, actual ${describeValue(actual)}`
    }
    if (actualIsArray) {
        const a = actual as unknown[]
        const e = expected as unknown[]
        if (a.length !== e.length) return `${path}: expected array(${e.length}), actual array(${a.length})`
        for (let i = 0; i < e.length; i++) {
            const difference = firstDifference(a[i], e[i], `${path}[${i}]`)
            if (difference !== null) return difference
        }
        return null
    }
    const actualKeys = Object.keys(actual)
    const expectedKeys = Object.keys(expected)
    if (actualKeys.join('\u0000') !== expectedKeys.join('\u0000')) {
        return `${path}: expected keys [${expectedKeys.join(',')}], actual keys [${actualKeys.join(',')}]`
    }
    for (const key of expectedKeys) {
        const difference = firstDifference(
            (actual as Record<string, unknown>)[key],
            (expected as Record<string, unknown>)[key],
            `${path}.${key}`,
        )
        if (difference !== null) return difference
    }
    return null
}

export function exactEqual(actual: unknown, expected: unknown): boolean {
    return firstDifference(actual, expected) === null
}

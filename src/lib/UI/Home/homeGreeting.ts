export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night'

export type GreetingKey = 'homeGreetingMorning' | 'homeGreetingAfternoon' | 'homeGreetingEvening' | 'homeGreetingNight'

/** Local hour at which each period starts. Night wraps midnight: it runs from its start to the morning start. */
export const GREETING_STARTS: Readonly<Record<GreetingPeriod, number>> = {
    morning: 5,
    afternoon: 12,
    evening: 18,
    night: 22,
}

const STARTS_ASCENDING: readonly number[] = Object.values(GREETING_STARTS).sort((a, b) => a - b)

const MIN_DELAY_MS = 1000

/** The period of the device's local time; the locale plays no part. */
export function greetingPeriod(now: Date): GreetingPeriod {
    const hour = now.getHours()
    if (hour >= GREETING_STARTS.night || hour < GREETING_STARTS.morning) {
        return 'night'
    }
    if (hour >= GREETING_STARTS.evening) {
        return 'evening'
    }
    if (hour >= GREETING_STARTS.afternoon) {
        return 'afternoon'
    }
    return 'morning'
}

/**
 * Time to the earliest period start strictly after `now`: later today, else the next morning start.
 * Built from local calendar fields, so a DST change moves the result with the clock. Never below one
 * second, so a timer that fires just early cannot spin.
 */
export function msUntilNextPeriod(now: Date): number {
    for (const hour of STARTS_ASCENDING) {
        const start = new Date(now.getTime())
        start.setHours(hour, 0, 0, 0)
        if (start.getTime() > now.getTime()) {
            return Math.max(MIN_DELAY_MS, start.getTime() - now.getTime())
        }
    }
    const next = new Date(now.getTime())
    next.setDate(next.getDate() + 1)
    next.setHours(GREETING_STARTS.morning, 0, 0, 0)
    return Math.max(MIN_DELAY_MS, next.getTime() - now.getTime())
}

export function greetingKey(period: GreetingPeriod): GreetingKey {
    switch (period) {
        case 'morning':
            return 'homeGreetingMorning'
        case 'afternoon':
            return 'homeGreetingAfternoon'
        case 'evening':
            return 'homeGreetingEvening'
        case 'night':
            return 'homeGreetingNight'
    }
}

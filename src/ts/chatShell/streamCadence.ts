export type StreamInterval = 100 | 250 | 500

export interface StreamCadenceState {
    interval: StreamInterval
    fastRenders: number
}

export function nextStreamCadence(state: StreamCadenceState, durationMs: number, lowPower = false): StreamCadenceState {
    const interval = lowPower && state.interval < 250 ? 250 : state.interval
    if (durationMs > 8) {
        return { interval: interval === 100 ? 250 : 500, fastRenders: 0 }
    }
    const fastRenders = state.fastRenders + 1
    if (fastRenders >= 5) return { interval: lowPower ? 250 : 100, fastRenders: 0 }
    return { interval, fastRenders }
}

export function createStreamCadence(lowPower = false) {
    let state: StreamCadenceState = { interval: lowPower ? 250 : 100, fastRenders: 0 }
    return {
        get interval(): StreamInterval { return state.interval },
        record(durationMs: number): StreamInterval {
            state = nextStreamCadence(state, durationMs, lowPower)
            return state.interval
        },
        reset(): void { state = { interval: lowPower ? 250 : 100, fastRenders: 0 } },
    }
}

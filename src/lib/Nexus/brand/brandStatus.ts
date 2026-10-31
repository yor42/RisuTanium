// What the status mark can show. A future run object (and the app's data-work registry) supplies these;
// a single chat loading flag cannot tell them apart.

/** What a run is doing right now. */
export type RunActivity =
    | 'waiting'
    | 'preparing'
    | 'memory'
    | 'thinking'
    | 'generating'
    | 'tool_call'
    | 'translating'
    | 'imaging'
    | 'speaking'
    | 'finishing'

/** How a run ended. Shown briefly; afterwards the mark returns to `idle`. */
export type RunOutcome = 'done' | 'stopped' | 'error'

/** App-level data work that belongs to no run. The transfer marks point in the direction the data moves. */
export type DataActivity = 'transfer_in' | 'transfer_out' | 'scanning'

/** `idle` is the plain logo at rest. */
export type BrandStatus = 'idle' | RunActivity | RunOutcome | DataActivity

// English fallbacks for the text alternative. Callers pass a translated, more specific label
// (for example "Restoring backup 3 / 10") once the status is wired to a screen.
export const brandStatusLabels: Record<BrandStatus, string> = {
    idle: 'Ready',
    waiting: 'Waiting',
    preparing: 'Preparing',
    memory: 'Working with memory',
    thinking: 'Thinking',
    generating: 'Writing',
    tool_call: 'Using a tool',
    translating: 'Translating',
    imaging: 'Creating an image',
    speaking: 'Speaking',
    finishing: 'Finishing up',
    done: 'Done',
    stopped: 'Stopped',
    error: 'Failed',
    transfer_in: 'Receiving data',
    transfer_out: 'Sending data',
    scanning: 'Checking data',
}

/** Display order for galleries and documentation. */
export const brandStatusGroups: {
    readonly run: readonly RunActivity[]
    readonly outcome: readonly RunOutcome[]
    readonly data: readonly DataActivity[]
} = {
    run: ['waiting', 'preparing', 'memory', 'thinking', 'generating', 'tool_call', 'translating', 'imaging', 'speaking', 'finishing'],
    outcome: ['done', 'stopped', 'error'],
    data: ['transfer_in', 'transfer_out', 'scanning'],
}

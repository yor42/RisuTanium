/**
 * The Studio screen's one history step, offered to the layers it hosts through a Svelte context. A button in a layer
 * replays through the same path as the keyboard (the screen's `historyStep`), so a refusal, a rejected replay and a
 * replay that settles after the screen or visit changed behave identically. A layer never calls the service itself.
 */
export const STUDIO_HISTORY_STEP: unique symbol = Symbol('studioHistoryStep')

export interface StudioHistoryStep {
    /** Starts the replay when there is one to run; false when nothing was started. `entry` is refreshed once the replay lands. */
    step(direction: 'undo' | 'redo', entry: HTMLTextAreaElement | null): boolean
    /** Whether `step` would start a replay now. Reads reactive state and has no side effect. */
    can(direction: 'undo' | 'redo'): boolean
}

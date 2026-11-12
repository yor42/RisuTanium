import { getDatabase } from "../storage/database.svelte";
import { animationDimReason, motionPrefs, onMotionChange, type MotionState } from "../chatShell/motionPrefs.svelte";

const DEFAULT_ANIMATION_SPEED = 0.4;

// The unitless factor the chat tokens multiply their nominal durations by: the default speed gives 1, 0 gives no animation.
function motionFactor(speed: number | undefined): number {
    const factor = Number(speed) / DEFAULT_ANIMATION_SPEED;
    if (speed === undefined || speed === null || !Number.isFinite(factor)) return 1;
    return Math.min(10, Math.max(0, factor));
}

// Low power and reduced motion replace the chosen speed with the nominal one; their own rules then shorten or remove the motion.
export function effectiveAnimationSpeed(stored: number | undefined, motion: MotionState): number | undefined {
    return animationDimReason(motion) === null ? stored : DEFAULT_ANIMATION_SPEED;
}

export function updateAnimationSpeed(){
    const db = getDatabase();
    const speed = effectiveAnimationSpeed(db.animationSpeed, motionPrefs);
    document.documentElement.style.setProperty('--risu-animation-speed', speed  + 's');
    document.documentElement.style.setProperty('--chat-motion', String(motionFactor(speed)));
}

// A device change before the profile holds a speed waits for the load, which applies it.
onMotionChange(() => {
    if (getDatabase()?.animationSpeed !== undefined) updateAnimationSpeed();
});

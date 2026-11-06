import { getDatabase } from "../storage/database.svelte";

const DEFAULT_ANIMATION_SPEED = 0.4;

// The unitless factor the chat tokens multiply their nominal durations by: the default speed gives 1, 0 gives no animation.
function motionFactor(speed: number | undefined): number {
    const factor = Number(speed) / DEFAULT_ANIMATION_SPEED;
    if (speed === undefined || speed === null || !Number.isFinite(factor)) return 1;
    return Math.min(10, Math.max(0, factor));
}

export function updateAnimationSpeed(){
    const db = getDatabase();
    document.documentElement.style.setProperty('--risu-animation-speed', db.animationSpeed  + 's');
    document.documentElement.style.setProperty('--chat-motion', String(motionFactor(db.animationSpeed)));
}
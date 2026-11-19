/**
 * Work done so far and its total, the shape `CharxStreamProgress` reports after its phase argument. A total that is not a
 * positive finite number means the total is unknown; `done` above `total` is read as `total`.
 */
export type ProgressSink = (done: number, total: number) => void

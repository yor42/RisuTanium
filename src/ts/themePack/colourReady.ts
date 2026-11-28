// The areas whose judged colour text applies, with their base (MC-3121). Every other applied area applies only its judged
// shape variant, with no base, in both modes, until a later PR adds it here under the colour-consumption contract (H-7 in
// docs/design/THEMING.md). How a listed area is judged and painted is its row in colourAreas.ts.
import type { AppliedArea } from './intake'

export const COLOUR_READY_AREAS: ReadonlySet<AppliedArea> = new Set<AppliedArea>(['chat'])
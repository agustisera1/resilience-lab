// The processor's unit system, kept next to the adapter that speaks it.
// Nothing inside the hexagon deals in minor units

// Domain amounts are decimal strings, the processor wants integer minor units.
// The rounding is not cosmetic: Number("19.99") * 100 is 1998.9999999999998
export function toMinorUnits(amount: string): number {
  return Math.round(Number(amount) * 100);
}

// The way back: the processor answers in minor units, the domain wants the
// decimal string. Fixed to 2 so "5" comes back as "5.00" and not as "5"
export function toMajorUnits(minor: number): string {
  return (minor / 100).toFixed(2);
}

// Threshold comparisons in integer millimetres. Offsets are floats (and rounded to 1 mm at match time), so a raw
// `diff < 15` can be decided by float noise (e.g. 59.99999999999999 for an exact 60 m extent). Every distance/threshold
// comparison in the classifier goes through these helpers so it cannot recur.
export const toMm = (m: number): number => Math.round(m * 1000);
/** a < b in whole millimetres */
export const ltMm = (a: number, b: number): boolean => toMm(a) < toMm(b);
/** a <= b in whole millimetres */
export const lteMm = (a: number, b: number): boolean => toMm(a) <= toMm(b);
/** a >= b in whole millimetres */
export const gteMm = (a: number, b: number): boolean => toMm(a) >= toMm(b);
/** a > b in whole millimetres */
export const gtMm = (a: number, b: number): boolean => toMm(a) > toMm(b);

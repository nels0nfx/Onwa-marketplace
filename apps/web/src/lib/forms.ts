export const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Whole-number field: '' -> undefined, digits -> number, anything else -> NaN (fails validation). */
export function intField(v: FormDataEntryValue | null): number | undefined {
  const s = str(v).trim();
  if (s === '') return undefined;
  return /^-?\d+$/.test(s) ? Number(s) : Number.NaN;
}

import 'server-only';
import { sniffFileType, type DetectedFile } from '@onwa/shared';

export type UploadCheck =
  | { ok: true; bytes: Uint8Array; type: DetectedFile; name: string; size: number }
  | { ok: false; code: 'no_file' | 'file_too_large' | 'file_type' };

/** Validates an uploaded file by size and by its real leading bytes. The browser-supplied type is ignored. */
export async function checkUpload(entry: FormDataEntryValue | null, allowed: readonly DetectedFile[], maxBytes: number): Promise<UploadCheck> {
  if (!(entry instanceof File) || entry.size === 0) return { ok: false, code: 'no_file' };
  if (entry.size > maxBytes) return { ok: false, code: 'file_too_large' };
  const bytes = new Uint8Array(await entry.arrayBuffer());
  const type = sniffFileType(bytes);
  if (!type || !allowed.includes(type)) return { ok: false, code: 'file_type' };
  return { ok: true, bytes, type, name: entry.name, size: entry.size };
}

export type DetectedFile = 'pdf' | 'jpeg' | 'png' | 'webp';

export const MIME_BY_TYPE: Record<DetectedFile, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const EXTENSION_BY_TYPE: Record<DetectedFile, string> = { pdf: 'pdf', jpeg: 'jpg', png: 'png', webp: 'webp' };

export const DOCUMENT_TYPES: readonly DetectedFile[] = ['pdf', 'jpeg', 'png'];
export const IMAGE_TYPES: readonly DetectedFile[] = ['jpeg', 'png', 'webp'];

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_COVER_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_APPLICATION = 8;

/** Identifies a file by its leading bytes. The browser-supplied MIME type is never trusted. */
export function sniffFileType(bytes: Uint8Array): DetectedFile | null {
  const b = bytes;
  const starts = (sig: number[], offset = 0) => b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp'; // RIFF....WEBP
  return null;
}

/** Display-safe file name: no paths, no control characters, bounded length. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 120);
  return cleaned || 'file';
}

import 'server-only';
import type { CategoryNode } from '@onwa/shared';
import { apiPublic } from '@/lib/api';

export interface CategoryOption { value: string; label: string; slug: string }

/** Flat list of categories (parents and children) for select boxes. Empty list if the API is unreachable. */
export async function loadCategories(): Promise<{ tree: CategoryNode[]; options: CategoryOption[] }> {
  try {
    const data = await apiPublic<{ categories: CategoryNode[] }>('/categories');
    const tree = data?.categories ?? [];
    const options = tree.flatMap((c) => [
      { value: c.id, slug: c.slug, label: c.name },
      ...c.children.map((k) => ({ value: k.id, slug: k.slug, label: `${c.name} › ${k.name}` })),
    ]);
    return { tree, options };
  } catch {
    return { tree: [], options: [] };
  }
}

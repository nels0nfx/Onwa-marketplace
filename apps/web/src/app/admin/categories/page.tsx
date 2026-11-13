import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Category } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Field, SelectField } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { createCategoryAction, updateCategoryAction } from './actions';

export const metadata: Metadata = { title: 'Categories' };
export const maxDuration = 45;

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const sp = await searchParams;
  const { token } = await requireSession('/admin/categories');
  const { me, apiDown } = await loadMe(token);
  if (apiDown) return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  if (!me || !me.permissions.includes('categories.manage')) notFound();
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let categories: Category[] = [];
  let failed = false;
  try {
    categories = (await apiRequest<{ categories: Category[] }>('/admin/categories', { token })).categories;
  } catch {
    failed = true;
  }
  const tops = categories.filter((c) => !c.parentId);
  const parentOptions = [{ value: '', label: 'No parent (top level)' }, ...tops.map((c) => ({ value: c.id, label: c.name }))];
  const ordered = tops.flatMap((c) => [c, ...categories.filter((k) => k.parentId === c.id)]);

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head"><h1>Categories</h1><p className="muted">Two levels at most. Hide a category instead of deleting it; products keep their category.</p><p className="small"><Link href="/admin">Back to administration</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {failed ? <Alert tone="error">Categories could not be loaded. Try again.</Alert> : null}

      <section className="card stack" aria-labelledby="new-title">
        <h2 id="new-title">Add a category</h2>
        <form action={createCategoryAction} className="stack">
          <div className="form-grid cols-2">
            <Field id="name" label="Name" required minLength={2} maxLength={60} />
            <SelectField id="parentId" label="Parent" options={parentOptions} defaultValue="" />
            <Field id="sortOrder" label="Sort order" inputMode="numeric" defaultValue="100" hint="Lower numbers appear first." />
          </div>
          <div><SubmitButton pendingText="Adding">Add category</SubmitButton></div>
        </form>
      </section>

      <ul className="list-plain">
        {ordered.map((c) => (
          <li key={c.id} className="item" style={c.parentId ? { marginLeft: 'var(--space-5)' } : undefined}>
            <form action={updateCategoryAction} className="stack">
              <input type="hidden" name="id" value={c.id} />
              <div className="form-grid cols-2">
                <Field id={`name-${c.id}`} name="name" label={c.parentId ? 'Subcategory name' : 'Name'} defaultValue={c.name} required minLength={2} maxLength={60} />
                <Field id={`sort-${c.id}`} name="sortOrder" label="Sort order" inputMode="numeric" defaultValue={String(c.sortOrder)} />
              </div>
              <label className="check"><input type="checkbox" name="isActive" defaultChecked={c.isActive} /><span>Visible to sellers and shoppers</span></label>
              <div className="row"><SubmitButton size="sm" variant="secondary" pendingText="Saving">Save</SubmitButton><span className="muted small">/{c.slug}</span></div>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

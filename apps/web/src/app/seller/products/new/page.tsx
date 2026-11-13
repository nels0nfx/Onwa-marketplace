import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT_CONDITIONS } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Field, SelectField, TextArea } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { loadCategories } from '@/lib/catalogData';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { createProductAction } from '../actions';

export const metadata: Metadata = { title: 'New product' };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string }> }) {
  await requireSession('/seller/products/new');
  const sp = await searchParams;
  const message = resolveMessage(sp.e, sp.f);
  const { options } = await loadCategories();
  const categoryOptions = [{ value: '', label: 'Choose a category' }, ...options.map((o) => ({ value: o.value, label: o.label }))];
  const conditionOptions = PRODUCT_CONDITIONS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head"><h1>New product</h1><p className="muted">Save it as a draft first. You will add pictures next, then submit it for review.</p><p className="small"><Link href="/seller/products">Back to products</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <form action={createProductAction} className="stack-lg">
        <fieldset className="stack"><legend>Basics</legend>
          <Field id="name" label="Product name" required minLength={3} maxLength={120} />
          <div className="form-grid cols-2">
            <SelectField id="categoryId" label="Category" options={categoryOptions} defaultValue="" />
            <SelectField id="condition" label="Condition" options={conditionOptions} defaultValue="new" />
            <Field id="brand" label="Brand (optional)" maxLength={80} />
          </div>
          <TextArea id="description" label="Description" maxLength={5000} hint="At least 20 characters before you can submit." />
        </fieldset>

        <fieldset className="stack"><legend>Price and stock</legend>
          <div className="form-grid cols-2">
            <Field id="price" label="Price (₦)" inputMode="decimal" required hint="For example 15000 or 15000.50." />
            <Field id="salePrice" label="Sale price (₦, optional)" inputMode="decimal" hint="Must be lower than the price." />
            <Field id="initialStock" label="Stock on hand" inputMode="numeric" defaultValue="0" hint="Per variant if you add options below." />
            <Field id="sku" label="SKU (optional)" maxLength={60} hint="Your own stock code. Used when there are no options." />
          </div>
          <TextArea id="optionsText" label="Options (optional)" rows={3} hint={'One per line, like "Size: S, M, L" and "Color: Red, Blue". We create one variant for each combination, all at the price above. You can adjust each one afterwards.'} />
        </fieldset>

        <fieldset className="stack"><legend>Delivery</legend>
          <div className="form-grid cols-2">
            <Field id="weightGrams" label="Weight (grams)" inputMode="numeric" hint="Needed to submit. 1 kg = 1000 g." />
            <Field id="lengthCm" label="Length (cm, optional)" inputMode="numeric" />
            <Field id="widthCm" label="Width (cm, optional)" inputMode="numeric" />
            <Field id="heightCm" label="Height (cm, optional)" inputMode="numeric" />
          </div>
          <TextArea id="shippingRequirements" label="Shipping requirements (optional)" maxLength={500} rows={2} hint="For example: fragile, keep upright." />
        </fieldset>

        <fieldset className="stack"><legend>More details (optional)</legend>
          <TextArea id="attributesText" label="Attributes" rows={3} hint={'One per line, like "Material: Cotton" and "Origin: Nigeria". Shown on the product page.'} />
        </fieldset>

        <div><SubmitButton pendingText="Creating">Create draft</SubmitButton></div>
      </form>
    </div>
  );
}

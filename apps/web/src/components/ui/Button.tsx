import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

const cls = (variant: Variant, size: Size, block?: boolean) =>
  ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', block ? 'btn-block' : ''].filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', block, ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size; block?: boolean }) {
  return <button {...props} className={cls(variant, size, block)} />;
}

export function ButtonLink({ href, variant = 'primary', size = 'md', block, children }: { href: string; variant?: Variant; size?: Size; block?: boolean; children: ReactNode }) {
  return <Link href={href} className={cls(variant, size, block)}>{children}</Link>;
}

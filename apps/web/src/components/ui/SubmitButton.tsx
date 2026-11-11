'use client';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

export function SubmitButton({ children, pendingText = 'Working', variant = 'primary', size = 'md', block }: {
  children: ReactNode; pendingText?: string; variant?: 'primary' | 'secondary' | 'danger'; size?: 'md' | 'sm'; block?: boolean;
}) {
  const { pending } = useFormStatus();
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', block ? 'btn-block' : ''].filter(Boolean).join(' ');
  return (
    <button type="submit" className={cls} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

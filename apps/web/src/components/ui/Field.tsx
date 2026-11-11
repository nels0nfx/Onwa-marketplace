import type { ComponentProps } from 'react';

export function Field({ label, hint, id, ...input }: { label: string; hint?: string; id: string } & Omit<ComponentProps<'input'>, 'id'>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} className="input" aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

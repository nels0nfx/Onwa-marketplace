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

export function TextArea({ label, hint, id, ...area }: { label: string; hint?: string; id: string } & Omit<ComponentProps<'textarea'>, 'id'>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} name={id} className="input textarea" aria-describedby={hint ? `${id}-hint` : undefined} {...area} />
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

export function SelectField({ label, hint, id, options, ...select }: {
  label: string; hint?: string; id: string; options: readonly { value: string; label: string }[];
} & Omit<ComponentProps<'select'>, 'id'>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={id} className="select" aria-describedby={hint ? `${id}-hint` : undefined} {...select}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

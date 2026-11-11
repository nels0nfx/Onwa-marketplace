import type { Tone } from '@/lib/messages';

export function Alert({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

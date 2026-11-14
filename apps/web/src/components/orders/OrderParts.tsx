import { PHYSICAL_STATUS_LABELS, formatNaira, type OrderHistoryEntry, type OrderItemView, type PhysicalStatus } from '@onwa/shared';

export function StatusPill({ status }: { status: string }) {
  const label = (PHYSICAL_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const tone = ['paid', 'completed', 'delivered'].includes(status) ? 'approved' : ['cancelled', 'refunded', 'returned'].includes(status) ? 'rejected' : 'submitted';
  return <span className="status-pill" data-status={tone}>{label}</span>;
}

export function Items({ items }: { items: OrderItemView[] }) {
  return (
    <ul className="list-plain">
      {items.map((i) => (
        <li key={i.id} className="item">
          <div className="row">
            {i.imageUrl ? <img className="logo-sm" src={i.imageUrl} alt="" /> : <span className="logo-sm" aria-hidden="true">{i.productName.slice(0, 1)}</span>}
            <div className="stack" style={{ gap: 'var(--space-1)' }}>
              <strong>{i.productName}</strong>
              <span className="muted small">{i.variantLabel}{i.sku ? ` · ${i.sku}` : ''}</span>
              <span className="muted small">{i.quantity} × {formatNaira(i.unitPriceKobo)}</span>
            </div>
            <strong style={{ marginLeft: 'auto' }}>{formatNaira(i.lineTotalKobo)}</strong>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Timeline({ history }: { history: OrderHistoryEntry[] }) {
  const label = (s: string) => (PHYSICAL_STATUS_LABELS as Record<string, string>)[s as PhysicalStatus] ?? s;
  return (
    <ol className="timeline">
      {history.map((h) => (
        <li key={h.id}>
          <strong>{label(h.toStatus)}</strong>
          <span className="muted small">{new Date(h.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</span>
          {h.note ? <span>{h.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

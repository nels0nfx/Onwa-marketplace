import { ORDER_ACTION_LABELS, type OrderAction } from '@onwa/shared';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { orderAction } from '@/app/orders/actions';

/** Buttons for the actions the viewer may take now. The server re-checks every action. */
export function ActionButtons({ suborderId, actions, returnTo }: { suborderId: string; actions: OrderAction[]; returnTo: string }) {
  if (actions.length === 0) return null;
  return (
    <div className="row">
      {actions.map((a) => (
        <form key={a} action={orderAction}>
          <input type="hidden" name="id" value={suborderId} /><input type="hidden" name="action" value={a} /><input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton size="sm" variant={a === 'cancel' ? 'danger' : a === 'confirm_received' || a === 'start_processing' ? 'primary' : 'secondary'} pendingText="Saving">{ORDER_ACTION_LABELS[a]}</SubmitButton>
        </form>
      ))}
    </div>
  );
}

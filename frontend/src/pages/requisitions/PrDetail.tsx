import { requisitionApi } from '../../api/services';
import { PrChat } from '../../components/PrChat';
import { TrackView } from '../../components/Workflow';
import { ErrorBanner, StatusBadge } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import type { Requisition } from '../../types';
import { ITEM_TYPE_LABELS } from '../../types';
import { formatMoney } from '../../utils/format';

/** One PR: its whole journey from the start, its lines, and its conversation. */
export function PrDetail({ pr }: { pr: Requisition }) {
  const journey = useApi(() => requisitionApi.journey(pr._id), [pr._id]);

  return (
    <div className="pr-detail">
      <ErrorBanner message={journey.error} />
      {journey.data && <TrackView track={journey.data} />}
      <div className="pr-summary">
        <span>
          <StatusBadge status={pr.status} /> {pr.department?.name} · {pr.requester?.name} · {pr.priority}
        </span>
        {pr.justification && <span className="muted">{pr.justification}</span>}
      </div>
      <table className="table inner">
        <thead>
          <tr>
            <th>Item code</th>
            <th>Description</th>
            <th>Type</th>
            <th className="num">Qty</th>
            <th className="num">Est. unit price</th>
            <th className="num">Estimate</th>
          </tr>
        </thead>
        <tbody>
          {pr.items.map((i, index) => (
            <tr key={i._id ?? index}>
              <td className="mono">{i.itemCode ?? '-'}</td>
              <td>{i.description}</td>
              <td>{ITEM_TYPE_LABELS[i.itemType ?? 'GOODS']}</td>
              <td className="num">
                {i.quantity} {i.uom}
              </td>
              <td className="num">{formatMoney(i.estimatedUnitPrice)}</td>
              <td className="num">{formatMoney(i.quantity * i.estimatedUnitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PrChat prId={pr._id} prNumber={pr.prNumber} />
    </div>
  );
}

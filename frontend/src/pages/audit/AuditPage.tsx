import { useState } from 'react';
import { auditApi } from '../../api/services';
import { Card, Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatMoney } from '../../utils/format';

const TABS = [
  { key: 'activity', label: 'Audit trail' },
  { key: 'matching', label: '3-way match log' },
  { key: 'compliance', label: 'Tax & payment compliance' },
  { key: 'awards', label: 'Vendor award decisions' },
];

function ActivityLog() {
  const [refusedOnly, setRefusedOnly] = useState(false);
  const { data, error } = useApi(() => auditApi.activity(refusedOnly ? { success: 'false' } : undefined), [refusedOnly]);
  return (
    <>
      <ErrorBanner message={error} />
      <label className="check">
        <input type="checkbox" checked={refusedOnly} onChange={(e) => setRefusedOnly(e.target.checked)} /> Refused attempts only
      </label>
      {!data?.length ? (
        <Empty>No activity recorded.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Role</th>
              <th>Module</th>
              <th>Action</th>
              <th>Document</th>
              <th>Remarks</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {data.map((log) => (
              <tr key={log._id}>
                <td>{formatDateTime(log.at)}</td>
                <td>{log.actorEmail ?? '-'}</td>
                <td>{log.actorRole ?? '-'}</td>
                <td>{log.module}</td>
                <td>{log.action}</td>
                <td className="mono">{log.docRef ?? '-'}</td>
                <td>{log.remarks ?? '-'}</td>
                <td>
                  <span className={`badge badge-${log.success ? 'green' : 'red'}`}>{log.success ? 'OK' : `REFUSED ${log.statusCode}`}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function MatchingLog() {
  const { data, error } = useApi(() => auditApi.matching());
  return (
    <>
      <ErrorBanner message={error} />
      {!data?.length ? (
        <Empty>No matches have run yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Vendor</th>
              <th>PO</th>
              <th className="num">Total</th>
              <th>Run by</th>
              <th>Run at</th>
              <th>Result</th>
              <th>Exceptions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((inv) => (
              <tr key={inv._id}>
                <td>
                  <span className="mono">{inv.internalRef}</span>
                  <div className="muted small">{inv.invoiceNumber}</div>
                </td>
                <td>{inv.vendor?.companyName}</td>
                <td className="mono">{inv.purchaseOrder?.poNumber}</td>
                <td className="num">{formatMoney(inv.total)}</td>
                <td>{inv.match.performedBy?.name ?? '-'}</td>
                <td>{formatDateTime(inv.match.performedAt)}</td>
                <td>
                  <StatusBadge status={inv.match.status} />
                </td>
                <td>
                  {inv.match.exceptions.length ? (
                    <ul className="exceptions small">
                      {inv.match.exceptions.map((ex, i) => (
                        <li key={i}>{ex.message}</li>
                      ))}
                    </ul>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ComplianceRecords() {
  const { data, error } = useApi(() => auditApi.compliance());
  return (
    <>
      <ErrorBanner message={error} />
      <Card title="Tax verifications">
        {!data?.invoices.length ? (
          <Empty>No tax verifications yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Vendor</th>
                <th>GSTIN / PAN</th>
                <th>TDS</th>
                <th className="num">TDS amount</th>
                <th>Verified by</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr key={inv._id}>
                  <td className="mono">{inv.internalRef}</td>
                  <td>{inv.vendor?.companyName}</td>
                  <td className="mono small">
                    {inv.vendor?.gstin ?? '-'}
                    <br />
                    {inv.vendor?.pan ?? '-'}
                  </td>
                  <td>
                    {inv.tax?.tdsSection} @ {inv.tax?.tdsRate}%
                  </td>
                  <td className="num">{formatMoney(inv.tax?.tdsAmount)}</td>
                  <td>{inv.tax?.verifiedBy?.name ?? '-'}</td>
                  <td>
                    <span className={`badge badge-${inv.tax?.verified ? 'green' : 'red'}`}>{inv.tax?.verified ? 'PASSED' : 'FAILED'}</span>
                    {inv.tax?.issues.map((i) => (
                      <div key={i.code} className="muted small">
                        {i.message}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Payments: who verified and released">
        {!data?.payments.length ? (
          <Empty>No payments yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Vendor</th>
                <th className="num">Net</th>
                <th>Tax verified by</th>
                <th>Released by</th>
                <th>UTR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p._id}>
                  <td className="mono">{p.paymentRef}</td>
                  <td>{p.vendor?.companyName}</td>
                  <td className="num">{formatMoney(p.netAmount)}</td>
                  <td>{p.verifiedBy?.name ?? '-'}</td>
                  <td>{p.releasedBy?.name ?? p.releasedByName ?? '-'}</td>
                  <td className="mono small">{p.utr ?? '-'}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Vendor KYC">
        {!data?.vendors.length ? (
          <Empty>No vendors.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Company</th>
                <th>GSTIN</th>
                <th>PAN</th>
                <th>TDS section</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v._id}>
                  <td className="mono">{v.vendorCode}</td>
                  <td>{v.companyName}</td>
                  <td className="mono small">{v.gstin ?? '-'}</td>
                  <td className="mono small">{v.pan ?? '-'}</td>
                  <td>{v.tdsSection}</td>
                  <td>
                    <StatusBadge status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function AwardDecisions() {
  const { data, error } = useApi(() => auditApi.awards());
  return (
    <>
      <ErrorBanner message={error} />
      {!data?.length ? (
        <Empty>No awards yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>RFQ</th>
              <th>Title</th>
              <th>Vendor</th>
              <th>Rank at award</th>
              <th className="num">Value</th>
              <th>Selected by</th>
              <th>When</th>
              <th>Justification</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r._id} className={r.awardedBid?.rank && r.awardedBid.rank > 1 ? 'highlight' : ''}>
                <td className="mono">{r.rfqNumber}</td>
                <td>{r.title}</td>
                <td>{r.awardedBid?.vendor?.companyName}</td>
                <td>{r.awardedBid?.rank ? `L${r.awardedBid.rank}` : '-'}</td>
                <td className="num">{formatMoney(r.awardedBid?.totalAmount)}</td>
                <td>{r.awardedBy?.name ?? '-'}</td>
                <td>{formatDateTime(r.awardedAt)}</td>
                <td>{r.awardJustification ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function AuditPage() {
  const [tab, setTab] = useState('activity');
  return (
    <Page title="Audit & Compliance">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' tab-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'activity' && <ActivityLog />}
      {tab === 'matching' && <MatchingLog />}
      {tab === 'compliance' && <ComplianceRecords />}
      {tab === 'awards' && <AwardDecisions />}
    </Page>
  );
}

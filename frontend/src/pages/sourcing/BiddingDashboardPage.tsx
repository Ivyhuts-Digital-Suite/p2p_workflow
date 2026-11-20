import { useEffect } from 'react';
import { sourcingApi } from '../../api/services';
import { Card, Empty, ErrorBanner, Page, Stat, StatusBadge } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatDuration, formatMoney } from '../../utils/format';

const REFRESH_MS = 15_000;

/** Live bidding first, then RFQs waiting for an award, then awarded ones. */
const SECTION_ORDER: Record<string, number> = { LIVE: 0, AWAITING_CLOSE: 1, CLOSED: 1, AWARDED: 2 };
const sectionOf = (status: string) => SECTION_ORDER[status] ?? 1;

export function BiddingDashboardPage() {
  const { data, error, reload, loading } = useApi(() => sourcingApi.dashboard());

  useEffect(() => {
    const timer = window.setInterval(() => void reload(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  // Stable sort: within a section, the server's order (soonest closing first) is kept.
  const rows = data ? [...data.rfqs].sort((a, b) => sectionOf(a.status) - sectionOf(b.status)) : [];

  return (
    <Page title="Live Bidding Dashboard" actions={<span className="muted small">{loading ? 'Refreshing…' : `Auto-refresh every ${REFRESH_MS / 1000}s`}</span>}>
      <ErrorBanner message={error} />
      {data && (
        <>
          <div className="stats">
            <Stat label="Live RFQs" value={data.summary.liveRfqs} />
            <Stat label="Awaiting award" value={data.summary.awaitingAward} />
            <Stat label="Awarded" value={data.summary.awarded} />
            <Stat label="Total bids" value={data.summary.totalBids} />
          </div>
          {!rows.length ? (
            <Empty>No published RFQs.</Empty>
          ) : (
            <div className="cards">
              {rows.map((row) => (
                <Card key={row.rfqId}>
                  <div className="card-head">
                    <div>
                      <div className="mono small">{row.rfqNumber}</div>
                      <strong>{row.title}</strong>
                      {!!row.items?.length && <div className="muted small">{row.items.join(', ')}</div>}
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <dl className="kv">
                    <dt>Bids received</dt>
                    <dd>{row.totalBids}</dd>
                    <dt>Lowest quote</dt>
                    <dd>{formatMoney(row.lowestBid)}</dd>
                    <dt>{row.isLive ? 'Time remaining' : 'Closed at'}</dt>
                    <dd>{row.isLive ? formatDuration(row.timeRemainingMs) : formatDateTime(row.closeAt)}</dd>
                  </dl>
                  <div className="top-vendor">
                    {row.topVendor?.awarded && (
                      <p className="small">
                        Awarded to <strong>{row.topVendor.companyName}</strong> (L{row.topVendor.rank})
                      </p>
                    )}
                    <div className="muted small">Live ranking (lowest price first)</div>
                    {row.rankings.length ? (
                      <ol className="rankings">
                        {row.rankings.map((r) => (
                          <li key={r.rank}>
                            <strong>L{r.rank}</strong>
                            <span>{r.companyName}</span>
                            <span className="num">{formatMoney(r.totalAmount)}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}

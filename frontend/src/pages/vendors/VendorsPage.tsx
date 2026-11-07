import { Fragment, useState } from 'react';
import { vendorApi } from '../../api/services';
import { askReason, confirmAction } from '../../components/overlays';
import { Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import { LICENCE_LABELS } from '../../types';
import { expiryState } from './VendorProfilePage';

export function VendorsPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('PROCUREMENT');
  const { data, error, reload } = useApi(() => vendorApi.list());
  const [expanded, setExpanded] = useState<string | null>(null);
  const action = useAction(reload);

  return (
    <Page title="Vendor Master">
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {!data?.length ? (
        <Empty>No vendors registered.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Company</th>
              <th>Contact</th>
              <th>GSTIN</th>
              <th>PAN</th>
              <th>Categories</th>
              <th>TDS</th>
              <th>Rating</th>
              <th>Licences</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((v) => {
              const documents = v.documents ?? [];
              const toVerify = documents.filter((d) => d.status === 'PENDING').length;
              const expired = documents.filter((d) => d.status !== 'REJECTED' && expiryState(d).className === 'expiry-past').length;
              return (
                <Fragment key={v._id}>
                  <tr>
                    <td className="mono">{v.vendorCode}</td>
                    <td>{v.companyName}</td>
                    <td>
                      {v.contactPerson}
                      <div className="muted small">{v.email}</div>
                    </td>
                    <td className="mono small">{v.gstin ?? '-'}</td>
                    <td className="mono small">{v.pan ?? '-'}</td>
                    <td>{v.categories.join(', ')}</td>
                    <td>{v.tdsSection}</td>
                    <td>★ {v.rating}</td>
                    <td>
                      <button className="link" onClick={() => setExpanded(expanded === v._id ? null : v._id)}>
                        {documents.length} on file
                      </button>
                      {toVerify > 0 && <div className="expiry-soon small">{toVerify} to verify</div>}
                      {expired > 0 && <div className="expiry-past small">{expired} expired</div>}
                    </td>
                    <td>
                      <StatusBadge status={v.status} />
                      {!v.bankDetails?.accountNumber && <div className="muted small">Bank details missing</div>}
                    </td>
                    <td className="row-actions">
                      {canManage && v.status !== 'APPROVED' && v.status !== 'BLACKLISTED' && (
                        <button className="btn btn-sm btn-primary" onClick={() => void action.run(() => vendorApi.approve(v._id), `${v.companyName} approved`)}>
                          Approve
                        </button>
                      )}
                      {canManage && v.status === 'APPROVED' && (
                        <button className="btn btn-sm" onClick={() => void action.run(() => vendorApi.suspend(v._id), `${v.companyName} suspended`)}>
                          Suspend
                        </button>
                      )}
                      {canManage && v.status !== 'BLACKLISTED' && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={async () => {
                            if (await confirmAction(`Blacklist ${v.companyName}?`, 'They will no longer be able to bid or be awarded.', 'Blacklist')) {
                              void action.run(() => vendorApi.blacklist(v._id), `${v.companyName} blacklisted`);
                            }
                          }}
                        >
                          Blacklist
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === v._id && (
                    <tr>
                      <td colSpan={11}>
                        {!documents.length ? (
                          <Empty>No documents on file.</Empty>
                        ) : (
                          <table className="table inner">
                            <thead>
                              <tr>
                                <th>Type</th>
                                <th>Number</th>
                                <th>Issued by</th>
                                <th>Expiry</th>
                                <th>Status</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {documents.map((d) => (
                                <tr key={d._id}>
                                  <td>{LICENCE_LABELS[d.type]}</td>
                                  <td className="mono">{d.referenceUrl ? <a href={d.referenceUrl} target="_blank" rel="noreferrer">{d.number}</a> : d.number}</td>
                                  <td>{d.issuedBy ?? '-'}</td>
                                  <td className={expiryState(d).className}>{expiryState(d).text}</td>
                                  <td>
                                    <StatusBadge status={d.status} />
                                    {d.remarks && <div className="muted small">{d.remarks}</div>}
                                  </td>
                                  <td className="row-actions">
                                    {canManage && d.status === 'PENDING' && (
                                      <>
                                        <button className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => void action.run(() => vendorApi.verifyDocument(v._id, d._id, 'VERIFIED'), `${LICENCE_LABELS[d.type]} verified`)}>
                                          Verify
                                        </button>
                                        <button
                                          className="btn btn-sm btn-danger"
                                          disabled={action.busy}
                                          onClick={async () => {
                                            const reason = await askReason(`Reject ${LICENCE_LABELS[d.type]} ${d.number}`, 3, 'Reject');
                                            if (reason) void action.run(() => vendorApi.verifyDocument(v._id, d._id, 'REJECTED', reason), 'Document rejected');
                                          }}
                                        >
                                          Reject
                                        </button>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </Page>
  );
}

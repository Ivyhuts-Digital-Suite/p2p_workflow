import { FormEvent, useEffect, useState } from 'react';
import { vendorApi } from '../../api/services';
import { Card, Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import type { BankDetails, VendorDocument } from '../../types';
import { LICENCE_LABELS } from '../../types';
import { formatDate } from '../../utils/format';

const EMPTY_BANK: BankDetails = { accountName: '', accountNumber: '', ifsc: '', bankName: '' };
const EMPTY_DOCUMENT = { type: 'DRUG_LICENCE', number: '', issuedBy: '', expiryDate: '', referenceUrl: '' };
const EXPIRY_ALERT_DAYS = 60;
const DAY_MS = 86_400_000;

/** How a document stands against today, for its alert. */
export function expiryState(document: Pick<VendorDocument, 'expiryDate'>) {
  const days = Math.ceil((new Date(document.expiryDate).getTime() - Date.now()) / DAY_MS);
  if (days <= 0) return { className: 'expiry-past', text: 'Expired' };
  if (days <= EXPIRY_ALERT_DAYS) return { className: 'expiry-soon', text: `Expires in ${days} day${days === 1 ? '' : 's'}` };
  return { className: '', text: formatDate(document.expiryDate) };
}

/** Vendor self-service: Procurement cannot approve KYC until bank details are on file here. */
export function VendorProfilePage() {
  const { data: vendor, error, reload } = useApi(() => vendorApi.me());
  const [tab, setTab] = useState<'company' | 'documents'>('company');
  const [bank, setBank] = useState<BankDetails>(EMPTY_BANK);
  const [documentForm, setDocumentForm] = useState(EMPTY_DOCUMENT);
  const action = useAction(reload);
  const documentAction = useAction(async () => {
    setDocumentForm(EMPTY_DOCUMENT);
    await reload();
  });

  useEffect(() => {
    if (vendor?.bankDetails) setBank({ ...EMPTY_BANK, ...vendor.bankDetails });
  }, [vendor]);

  const set = (field: keyof BankDetails) => (e: { target: { value: string } }) => setBank((b) => ({ ...b, [field]: e.target.value }));
  const setDocument = (field: keyof typeof EMPTY_DOCUMENT) => (e: { target: { value: string } }) => setDocumentForm((d) => ({ ...d, [field]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(() => vendorApi.updateMe({ bankDetails: bank }), 'Bank details saved');
  };

  const addDocument = (e: FormEvent) => {
    e.preventDefault();
    void documentAction.run(
      () =>
        vendorApi.addDocument({
          type: documentForm.type,
          number: documentForm.number,
          issuedBy: documentForm.issuedBy || undefined,
          expiryDate: documentForm.expiryDate,
          referenceUrl: documentForm.referenceUrl || undefined,
        }),
      'Document added. Procurement will verify it.',
    );
  };

  const documents = vendor?.documents ?? [];
  const alerts = documents.filter((d) => d.status !== 'REJECTED' && expiryState(d).className);

  return (
    <Page title="Company Profile">
      <ErrorBanner message={error ?? action.error ?? documentAction.error} onClose={action.error ? action.clearError : documentAction.clearError} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'company'} className={`tab${tab === 'company' ? ' tab-active' : ''}`} onClick={() => setTab('company')}>
          Company
        </button>
        <button role="tab" aria-selected={tab === 'documents'} className={`tab${tab === 'documents' ? ' tab-active' : ''}`} onClick={() => setTab('documents')}>
          Documents{alerts.length ? ` (${alerts.length} to renew)` : ''}
        </button>
      </div>

      {tab === 'company' && (
        <>
          {vendor && (
            <Card title={vendor.companyName}>
              <dl className="kv kv-left">
                <dt>Vendor code</dt>
                <dd className="mono">{vendor.vendorCode}</dd>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={vendor.status} />
                </dd>
                <dt>Contact</dt>
                <dd>
                  {vendor.contactPerson} · {vendor.email} · {vendor.phone ?? '-'}
                </dd>
                <dt>GSTIN</dt>
                <dd className="mono">{vendor.gstin ?? '-'}</dd>
                <dt>PAN</dt>
                <dd className="mono">{vendor.pan ?? '-'}</dd>
              </dl>
            </Card>
          )}
          <form className="card form" onSubmit={onSubmit}>
            <h2>Bank details for payment</h2>
            <div className="grid-2">
              <label>
                Account name
                <input value={bank.accountName} onChange={set('accountName')} required minLength={2} />
              </label>
              <label>
                Account number
                <input value={bank.accountNumber} onChange={set('accountNumber')} required pattern="\d{9,18}" title="9 to 18 digits" />
              </label>
              <label>
                IFSC
                <input value={bank.ifsc} onChange={set('ifsc')} required placeholder="HDFC0000123" maxLength={11} />
              </label>
              <label>
                Bank name
                <input value={bank.bankName} onChange={set('bankName')} required minLength={2} />
              </label>
            </div>
            <button className="btn btn-primary" disabled={action.busy}>
              Save bank details
            </button>
          </form>
        </>
      )}

      {tab === 'documents' && (
        <>
          {alerts.map((d) => (
            <div key={d._id} className={`alert ${expiryState(d).className === 'expiry-past' ? 'alert-error' : 'alert-warning'}`}>
              <span>
                {LICENCE_LABELS[d.type]} {d.number}: {expiryState(d).text.toLowerCase()}.
                {expiryState(d).className === 'expiry-past' ? ' You cannot bid or be awarded until you add the renewal.' : ' Add the renewal before it lapses.'}
              </span>
            </div>
          ))}
          <Card title="Licences and certificates">
            {!documents.length ? (
              <Empty>No documents yet. Some RFQs need a verified licence before you can bid.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Number</th>
                    <th>Issued by</th>
                    <th>Expiry</th>
                    <th>Status</th>
                    <th>Remarks</th>
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
                      </td>
                      <td>{d.remarks ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <form className="card form" onSubmit={addDocument}>
            <h2>Add a licence or renewal</h2>
            <div className="grid-2">
              <label>
                Type
                <select value={documentForm.type} onChange={setDocument('type')}>
                  {Object.entries(LICENCE_LABELS).map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Licence number *
                <input value={documentForm.number} onChange={setDocument('number')} required minLength={2} />
              </label>
              <label>
                Issued by
                <input value={documentForm.issuedBy} onChange={setDocument('issuedBy')} />
              </label>
              <label>
                Expiry date *
                <input type="date" value={documentForm.expiryDate} onChange={setDocument('expiryDate')} required />
              </label>
            </div>
            <label>
              Link to your copy
              <input type="url" value={documentForm.referenceUrl} onChange={setDocument('referenceUrl')} placeholder="https://" />
            </label>
            <p className="muted small">Files can't be uploaded here yet, so share a link Procurement can open to check the document.</p>
            <button className="btn btn-primary" disabled={documentAction.busy}>
              Add document
            </button>
          </form>
        </>
      )}
    </Page>
  );
}

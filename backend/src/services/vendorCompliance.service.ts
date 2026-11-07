import { DOCUMENT_STATUS } from '../constants/status';
import { IVendorDocument } from '../models/Vendor';

const label = (type: string) => type.replace(/_/g, ' ').toLowerCase();

/**
 * Why a vendor may not bid or be awarded, or an empty list when they may.
 *  - A licence type they hold must have a current document: a renewal replaces an expired one.
 *  - Each type the RFQ requires must have a document that Procurement has verified and that is current.
 */
export function licenceIssues(vendor: { documents?: IVendorDocument[] }, required: string[] = [], now = new Date()): string[] {
  const documents = (vendor.documents ?? []).filter((d) => d.status !== DOCUMENT_STATUS.REJECTED);
  const issues: string[] = [];

  for (const type of new Set(documents.map((d) => d.type))) {
    const ofType = documents.filter((d) => d.type === type);
    if (ofType.every((d) => d.expiryDate <= now)) {
      const latest = Math.max(...ofType.map((d) => d.expiryDate.getTime()));
      issues.push(`The ${label(type)} expired on ${new Date(latest).toISOString().slice(0, 10)}`);
    }
  }
  for (const type of required) {
    const verified = documents.some((d) => d.type === type && d.status === DOCUMENT_STATUS.VERIFIED && d.expiryDate > now);
    if (!verified) issues.push(`This RFQ needs a verified, current ${label(type)}`);
  }
  return issues;
}

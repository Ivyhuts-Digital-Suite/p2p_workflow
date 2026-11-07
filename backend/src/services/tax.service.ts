import { env } from '../config/env';
import { GST_SLABS } from '../constants/status';
import { IInvoice, IInvoiceTax } from '../models/Invoice';
import { IVendor } from '../models/Vendor';
import { round2 } from '../utils/money';

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * TDS sections and rates (%). Rates change with each Finance Act - keep this table
 * (or a DB-backed equivalent) in sync with current law. Thresholds are not modelled here.
 */
export const TDS_SECTIONS: Record<string, { label: string; individualRate: number; otherRate: number; noPanRate?: number }> = {
  '194C': { label: 'Payments to contractors', individualRate: 1, otherRate: 2 },
  '194J': { label: 'Professional services', individualRate: 10, otherRate: 10 },
  '194Q': { label: 'Purchase of goods', individualRate: 0.1, otherRate: 0.1, noPanRate: 5 },
  '194I': { label: 'Rent - plant & machinery', individualRate: 2, otherRate: 2 },
  NONE: { label: 'Not applicable', individualRate: 0, otherRate: 0 },
};

/** Higher rate when the payee has no valid PAN (Sec 206AA), unless the section sets its own noPanRate. */
export const NO_PAN_TDS_RATE = 20;

type TaxInvoice = Pick<IInvoice, 'subtotal' | 'gstAmount' | 'total' | 'items'>;
type TaxVendor = Pick<IVendor, 'gstin' | 'pan'>;

export type TaxComplianceResult = Omit<IInvoiceTax, 'verifiedBy' | 'verifiedAt'>;

export function verifyTaxCompliance(invoice: TaxInvoice, vendor: TaxVendor, tdsSection: string): TaxComplianceResult {
  const issues: TaxComplianceResult['issues'] = [];
  const gstin = vendor.gstin?.toUpperCase();
  const pan = vendor.pan?.toUpperCase();

  // --- GST checks -------------------------------------------------------------
  const gstinValid = !!gstin && GSTIN_REGEX.test(gstin);
  if (invoice.gstAmount > 0 && !gstin) {
    issues.push({ code: 'GST_UNREGISTERED', message: 'GST charged by a vendor without a GSTIN', blocking: true });
  } else if (gstin && !gstinValid) {
    issues.push({ code: 'GSTIN_INVALID', message: `GSTIN ${gstin} has an invalid format`, blocking: true });
  }

  const panValid = !!pan && PAN_REGEX.test(pan);
  if (gstinValid && panValid && gstin!.slice(2, 12) !== pan) {
    issues.push({ code: 'GSTIN_PAN_MISMATCH', message: 'PAN embedded in GSTIN does not match vendor PAN', blocking: true });
  }

  const badRates = invoice.items.filter((i) => !GST_SLABS.includes(i.taxRate));
  if (badRates.length) {
    issues.push({
      code: 'GST_RATE_INVALID',
      message: `Invalid GST rate(s): ${[...new Set(badRates.map((i) => i.taxRate))].join(', ')}%`,
      blocking: true,
    });
  }

  // Place of supply: same state code => CGST + SGST, otherwise IGST.
  const supplyType = gstin && gstin.slice(0, 2) !== env.companyGstin.slice(0, 2) ? 'INTER_STATE' : 'INTRA_STATE';
  const half = round2(invoice.gstAmount / 2);
  const cgst = supplyType === 'INTRA_STATE' ? half : 0;
  const sgst = supplyType === 'INTRA_STATE' ? round2(invoice.gstAmount - half) : 0;
  const igst = supplyType === 'INTER_STATE' ? invoice.gstAmount : 0;

  // --- TDS --------------------------------------------------------------------
  const section = TDS_SECTIONS[tdsSection] ? tdsSection : 'NONE';
  if (!TDS_SECTIONS[tdsSection]) {
    issues.push({ code: 'TDS_SECTION_UNKNOWN', message: `Unknown TDS section "${tdsSection}"`, blocking: true });
  }
  const config = TDS_SECTIONS[section];
  // 4th PAN character: P = individual, H = HUF -> individual rate applies.
  const isIndividual = panValid && ['P', 'H'].includes(pan![3]);
  let tdsRate = isIndividual ? config.individualRate : config.otherRate;
  if (section !== 'NONE' && !panValid) {
    tdsRate = Math.max(tdsRate, config.noPanRate ?? NO_PAN_TDS_RATE);
    issues.push({
      code: 'PAN_MISSING',
      message: `Vendor PAN missing/invalid - TDS deducted at ${tdsRate}% (Sec 206AA)`,
      blocking: false,
    });
  }

  // TDS is computed on the taxable value, excluding GST.
  const tdsAmount = round2((invoice.subtotal * tdsRate) / 100);

  return {
    verified: !issues.some((i) => i.blocking),
    gstinValid,
    panValid,
    supplyType,
    cgst,
    sgst,
    igst,
    tdsSection: section,
    tdsRate,
    tdsAmount,
    netPayable: round2(invoice.total - tdsAmount),
    issues,
  };
}

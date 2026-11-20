import { env } from '../config/env';
import { MASTER_ROLES, ROLES } from '../constants/roles';
import { PO_STATUS, RFQ_STATUS } from '../constants/status';
import { Bid } from '../models/Bid';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { RFQ } from '../models/RFQ';
import { User } from '../models/User';
import { evaluateRfqBids } from '../services/bidEvaluation.service';
import { consolidateRoles } from './consolidateRoles';

const DEMO_PASSWORD = 'Password@123';

/**
 * Brings an existing database up to the current access model. Safe to run on every start.
 * Accounts in the merged QC, AP and Treasury roles are removed. Extra accounts in a single-account role are reported, not removed.
 */
export async function migrateDatabase(): Promise<void> {
  // QC merged into the Store, and AP and Treasury into Finance.
  await consolidateRoles();

  // Item codes are no longer used: take them off existing lines so no API response carries them.
  for (const collection of [PurchaseRequisition.collection, RFQ.collection, PurchaseOrder.collection]) {
    await collection.updateMany({ 'items.itemCode': { $exists: true } }, { $unset: { 'items.$[].itemCode': '' } });
  }

  // The two-envelope tender and technical review were removed: clear their fields from older RFQs and bids.
  await RFQ.collection.updateMany(
    { $or: [{ technicalEvaluation: { $exists: true } }, { financialsOpenedAt: { $exists: true } }, { financialsOpenedBy: { $exists: true } }] },
    { $unset: { technicalEvaluation: '', financialsOpenedAt: '', financialsOpenedBy: '' } },
  );
  await Bid.collection.updateMany(
    { $or: [{ technicalStatus: { $exists: true } }, { technicalRemarks: { $exists: true } }, { technicalReviewedBy: { $exists: true } }, { technicalReviewedAt: { $exists: true } }] },
    { $unset: { technicalStatus: '', technicalRemarks: '', technicalReviewedBy: '', technicalReviewedAt: '' } },
  );

  // A seeded development database also gets the new demo account.
  if (!env.isProduction && (await User.exists({ email: 'admin@p2p.local' })) && !(await User.exists({ role: ROLES.AUDITOR }))) {
    await User.create({ name: 'Asha Auditor', email: 'auditor@p2p.local', password: DEMO_PASSWORD, role: ROLES.AUDITOR });
  }

  // Bids from before vendors quoted GST: work out their tax and gross values.
  const untaxed = await Bid.find({ grandTotal: { $exists: false } });
  for (const bid of untaxed) await bid.save();

  // Ranking is now by lowest price, so refresh the ranks of RFQs that can still be awarded.
  const rfqs = await RFQ.find({ status: { $in: [RFQ_STATUS.PUBLISHED, RFQ_STATUS.CLOSED] } }).select('_id');
  for (const rfq of rfqs) await evaluateRfqBids(rfq._id);

  // RFQs awarded before awards generated the PO: link any PO they already have.
  const unlinked = await RFQ.find({ status: RFQ_STATUS.AWARDED, purchaseOrder: { $exists: false } }).select('_id');
  for (const rfq of unlinked) {
    const po = await PurchaseOrder.findOne({ rfq: rfq._id, status: { $ne: PO_STATUS.CANCELLED } }).select('_id');
    if (po) await RFQ.updateOne({ _id: rfq._id }, { purchaseOrder: po._id });
  }

  try {
    await User.createIndexes();
  } catch (err) {
    const duplicates = await User.aggregate([
      { $match: { role: { $in: MASTER_ROLES } } },
      { $group: { _id: '$role', emails: { $push: '$email' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    console.warn(
      '[migrate] Single Master Account index not applied; sign-up checks still apply. Resolve these duplicates:',
      duplicates.map((d) => `${d._id}: ${d.emails.join(', ')}`).join(' | ') || (err as Error).message,
    );
  }
}

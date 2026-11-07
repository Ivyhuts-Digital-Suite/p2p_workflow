import { Types } from 'mongoose';
import { BID_STATUS, TECHNICAL_STATUS } from '../constants/status';
import { Bid } from '../models/Bid';
import { round2 } from '../utils/money';

/**
 * Re-ranks every live, technically qualified bid on an RFQ by lowest pre-tax total: rank 1 is L1, rank 2 is L2, and so on.
 * Equal quotes rank by earlier submission. priceScore (lowest / this x 100) shows how far a bid is from L1.
 * The technical score does not affect rank; it is evidence for a non-L1 award, which needs a written justification.
 */
export async function evaluateRfqBids(rfqId: Types.ObjectId | string): Promise<void> {
  const bids = await Bid.find({ rfq: rfqId, status: BID_STATUS.SUBMITTED, technicalStatus: { $ne: TECHNICAL_STATUS.DISQUALIFIED } });

  // Withdrawn and disqualified bids drop out of the ranking entirely.
  await Bid.updateMany(
    { rfq: rfqId, $or: [{ status: BID_STATUS.WITHDRAWN }, { technicalStatus: TECHNICAL_STATUS.DISQUALIFIED }] },
    { $unset: { rank: 1, priceScore: 1 } },
  );
  if (bids.length === 0) return;

  const lowest = Math.min(...bids.map((b) => b.totalAmount));
  bids.sort((a, b) => a.totalAmount - b.totalAmount || a.submittedAt.getTime() - b.submittedAt.getTime());

  await Bid.bulkWrite(
    bids.map((bid, index) => ({
      updateOne: {
        filter: { _id: bid._id },
        update: {
          $set: { rank: index + 1, priceScore: bid.totalAmount > 0 ? round2((lowest / bid.totalAmount) * 100) : 0 },
        },
      },
    })),
  );
}

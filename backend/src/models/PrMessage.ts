import { HydratedDocument, Schema, Types, model } from 'mongoose';

/**
 * One message, and who has read it. It belongs to one of two kinds of conversation:
 *  - a PR's internal conversation (`pr`), for hospital staff only;
 *  - a vendor's private conversation with Procurement on an RFQ (`rfq` + `vendor`), which carries on once it is their PO.
 */
export interface IPrMessage {
  pr?: Types.ObjectId;
  rfq?: Types.ObjectId;
  vendor?: Types.ObjectId;
  sender: Types.ObjectId;
  senderName: string;
  senderRole: string;
  text: string;
  /** One entry per reader. `role` was added later: an AUDITOR entry only clears the auditor's unread count and is never a read receipt. */
  readBy: { user: Types.ObjectId; name: string; at: Date; role?: string }[];
  createdAt: Date;
}

export type PrMessageDocument = HydratedDocument<IPrMessage>;

const prMessageSchema = new Schema<IPrMessage>(
  {
    // Required for internal messages; a vendor conversation has `rfq` and `vendor` instead.
    pr: { type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', index: true },
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQ' },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, required: true },
    text: { type: String, required: true },
    readBy: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, name: String, at: Date, role: String }],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

prMessageSchema.index({ rfq: 1, vendor: 1, createdAt: 1 });
prMessageSchema.pre('validate', function () {
  if (!this.pr && !(this.rfq && this.vendor)) this.invalidate('pr', 'A message belongs to a PR, or to a vendor on an RFQ');
});

export const PrMessage = model<IPrMessage>('PrMessage', prMessageSchema);

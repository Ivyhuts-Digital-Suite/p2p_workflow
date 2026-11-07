import { HydratedDocument, Schema, Types, model } from 'mongoose';

/** One message in a PR's conversation, and who has read it. */
export interface IPrMessage {
  pr: Types.ObjectId;
  sender: Types.ObjectId;
  senderName: string;
  senderRole: string;
  text: string;
  readBy: { user: Types.ObjectId; name: string; at: Date }[];
  createdAt: Date;
}

export type PrMessageDocument = HydratedDocument<IPrMessage>;

const prMessageSchema = new Schema<IPrMessage>(
  {
    pr: { type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, required: true },
    text: { type: String, required: true },
    readBy: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, name: String, at: Date }],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const PrMessage = model<IPrMessage>('PrMessage', prMessageSchema);

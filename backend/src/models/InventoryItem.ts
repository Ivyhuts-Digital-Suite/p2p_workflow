import { Schema, Types, model } from 'mongoose';

export interface IInventoryBatch {
  batchNumber?: string;
  expiryDate?: Date;
  serialNumbers: string[];
  quantity: number;
  grn: Types.ObjectId;
}

export interface IInventoryItem {
  /** The normalised item name */
  itemKey: string;
  description: string;
  warehouse: string;
  uom: string;
  /** Stock accepted by the Store and available for use */
  quantity: number;
  batches: IInventoryBatch[];
  lastGrn?: Types.ObjectId;
  lastReceivedAt?: Date;
}

const inventoryItemSchema = new Schema<IInventoryItem>(
  {
    itemKey: { type: String, required: true },
    description: { type: String, required: true },
    warehouse: { type: String, required: true },
    uom: { type: String, default: 'EA' },
    quantity: { type: Number, default: 0, min: 0 },
    batches: [
      {
        _id: false,
        batchNumber: String,
        expiryDate: Date,
        serialNumbers: { type: [String], default: [] },
        quantity: { type: Number, required: true, min: 0 },
        grn: { type: Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true },
      },
    ],
    lastGrn: { type: Schema.Types.ObjectId, ref: 'GoodsReceipt' },
    lastReceivedAt: Date,
  },
  { timestamps: true },
);

inventoryItemSchema.index({ itemKey: 1, warehouse: 1 }, { unique: true });

export const InventoryItem = model<IInventoryItem>('InventoryItem', inventoryItemSchema);

import { Schema, model } from 'mongoose';
import { ALL_ROLES, Role } from '../constants/roles';

export interface IDoaLevel {
  level: number;
  role: Role;
}

/**
 * Delegation of Authority rule: documents whose value falls in [minAmount, maxAmount]
 * must be approved by each level in order. maxAmount = null means "no upper bound".
 */
export const DOA_DOCUMENT_TYPES = ['PO', 'PR', 'PAYMENT'] as const;
export type DoaDocumentType = (typeof DOA_DOCUMENT_TYPES)[number];

export interface IDoaRule {
  name: string;
  documentType: DoaDocumentType;
  minAmount: number;
  maxAmount: number | null;
  levels: IDoaLevel[];
  isActive: boolean;
}

const doaRuleSchema = new Schema<IDoaRule>(
  {
    name: { type: String, required: true },
    documentType: { type: String, enum: DOA_DOCUMENT_TYPES, default: 'PO' },
    minAmount: { type: Number, required: true, min: 0 },
    maxAmount: { type: Number, default: null },
    levels: {
      type: [
        {
          _id: false,
          level: { type: Number, required: true },
          role: { type: String, enum: ALL_ROLES, required: true },
        },
      ],
      validate: [(v: unknown[]) => v.length > 0, 'At least one approval level is required'],
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const DoaRule = model<IDoaRule>('DoaRule', doaRuleSchema);

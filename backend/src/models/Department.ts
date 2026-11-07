import { Schema, Types, model } from 'mongoose';

export interface IDepartmentBudget {
  fiscalYear: string;
  /** Total budget sanctioned for the fiscal year */
  allocated: number;
  /** Reserved by approved PRs (not yet spent) */
  committed: number;
  /** Actually paid out (taxable value of released payments) */
  consumed: number;
}

export interface IDepartment {
  name: string;
  code: string;
  costCenter?: string;
  hod?: Types.ObjectId;
  budget: IDepartmentBudget;
  isActive: boolean;
}

const departmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    costCenter: String,
    hod: { type: Schema.Types.ObjectId, ref: 'User' },
    budget: {
      fiscalYear: { type: String, required: true },
      allocated: { type: Number, required: true, min: 0 },
      committed: { type: Number, default: 0, min: 0 },
      consumed: { type: Number, default: 0, min: 0 },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

departmentSchema.virtual('budget.available').get(function () {
  return this.budget.allocated - this.budget.committed;
});

export const Department = model<IDepartment>('Department', departmentSchema);

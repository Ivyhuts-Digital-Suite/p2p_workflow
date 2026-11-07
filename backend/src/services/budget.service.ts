import { Types } from 'mongoose';
import { Department } from '../models/Department';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { round2 } from '../utils/money';

/** What the approved requisitions committed to the department budget. */
export async function requisitionEstimate(ids: Types.ObjectId[]): Promise<number> {
  const prs = await PurchaseRequisition.find({ _id: { $in: ids } }).select('totalEstimate');
  return round2(prs.reduce((sum, pr) => sum + pr.totalEstimate, 0));
}

/**
 * Changes a department's commitment. An increase must fit in what is left of the budget, in one
 * atomic update, so returns false instead of overspending. A decrease always succeeds.
 */
export async function adjustCommitment(department: Types.ObjectId, amount: number): Promise<boolean> {
  if (amount === 0) return true;
  if (amount > 0) {
    const updated = await Department.findOneAndUpdate(
      { _id: department, $expr: { $gte: [{ $subtract: ['$budget.allocated', '$budget.committed'] }, amount] } },
      { $inc: { 'budget.committed': amount } },
    );
    return !!updated;
  }
  await Department.updateOne({ _id: department }, [
    { $set: { 'budget.committed': { $max: [0, { $add: ['$budget.committed', amount] }] } } },
  ]);
  return true;
}

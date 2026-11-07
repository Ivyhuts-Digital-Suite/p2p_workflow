import mongoose from 'mongoose';
import { ROLES } from '../constants/roles';
import { QC_STATUS } from '../constants/status';
import { AuditLog } from '../models/AuditLog';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { InventoryItem } from '../models/InventoryItem';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { QcInspection } from '../models/QcInspection';
import { refreshReceiptStatus, updatePurchaseOrder } from '../services/purchaseOrder.service';

const REMOVED_ROLES = ['QC', 'AP', 'TREASURY'];

/** Goods left in quarantine pass, as the Store already accepted them. Expired stock can't, so it is rejected. */
async function settlePendingInspections() {
  const pending = await QcInspection.find({ status: QC_STATUS.PENDING });
  for (const inspection of pending) {
    const expired = !!inspection.expiryDate && inspection.expiryDate <= new Date();
    const releasedQty = expired ? 0 : inspection.quantity;
    const rejectedQty = expired ? inspection.quantity : 0;

    const claimed = await QcInspection.findOneAndUpdate(
      { _id: inspection._id, status: QC_STATUS.PENDING },
      {
        $set: {
          status: expired ? QC_STATUS.REJECTED : QC_STATUS.RELEASED,
          releasedQty,
          rejectedQty,
          remarks: expired ? 'Expired while QC was being merged into the Store' : 'Accepted by the Store; QC merged into the Store',
          decidedAt: new Date(),
        },
      },
    );
    if (!claimed) continue;

    await GoodsReceipt.updateOne(
      { _id: inspection.grn, 'items._id': inspection.grnLine },
      { $set: { 'items.$.qcReleasedQty': releasedQty, 'items.$.qcRejectedQty': rejectedQty } },
    );
    if (expired) {
      await updatePurchaseOrder(inspection.purchaseOrder, (po) => {
        const line = po.items.find((i) => i._id.equals(inspection.poItem));
        if (line) line.receivedQty = Math.max(line.receivedQty - rejectedQty, 0);
        refreshReceiptStatus(po);
      });
      continue;
    }
    const po = await PurchaseOrder.findById(inspection.purchaseOrder);
    const poItem = po?.items.find((i) => i._id.equals(inspection.poItem));
    await InventoryItem.findOneAndUpdate(
      { itemKey: (poItem?.itemCode ?? inspection.description).trim().toUpperCase(), warehouse: inspection.warehouse },
      {
        $inc: { quantity: releasedQty },
        $set: { description: inspection.description, uom: poItem?.uom ?? 'EA', lastGrn: inspection.grn, lastReceivedAt: new Date() },
        $push: {
          batches: {
            batchNumber: inspection.batchNumber,
            expiryDate: inspection.expiryDate,
            serialNumbers: inspection.serialNumbers,
            quantity: releasedQty,
            grn: inspection.grn,
          },
        },
      },
      { upsert: true },
    );
  }
}

/** Approval steps and rules naming a removed role now belong to Finance. A rule never lists Finance twice. */
async function reassignApprovals() {
  const db = mongoose.connection;
  for (const collection of ['purchaseorders', 'purchaserequisitions', 'payments']) {
    await db.collection(collection).updateMany(
      { approvals: { $elemMatch: { role: { $in: REMOVED_ROLES }, status: 'PENDING' } } },
      { $set: { 'approvals.$[step].role': ROLES.FINANCE } },
      { arrayFilters: [{ 'step.role': { $in: REMOVED_ROLES }, 'step.status': 'PENDING' }] },
    );
  }

  const rules = db.collection('doarules');
  for (const rule of await rules.find({ 'levels.role': { $in: REMOVED_ROLES } }).toArray()) {
    const roles = (rule.levels as { level: number; role: string }[])
      .sort((a, b) => a.level - b.level)
      .map((l) => (REMOVED_ROLES.includes(l.role) ? ROLES.FINANCE : l.role));
    const unique = [...new Set(roles)];
    await rules.updateOne({ _id: rule._id }, { $set: { levels: unique.map((role, index) => ({ level: index + 1, role })) } });
  }
}

/**
 * Removes the merged accounts. Their past work stays attributable: the audit trail already records actors
 * by email, each removal is logged with the account's details, and a payment keeps its releaser's name.
 */
async function removeAccounts() {
  const users = mongoose.connection.collection('users');
  const accounts = await users.find({ role: { $in: REMOVED_ROLES } }).toArray();
  if (!accounts.length) return;
  if (!(await users.countDocuments({ role: ROLES.FINANCE }))) {
    console.warn('[migrate] No Finance account exists to take over invoices and payments. Create one under Administration.');
  }

  for (const account of accounts) {
    await mongoose.connection
      .collection('payments')
      .updateMany({ releasedBy: account._id }, { $set: { releasedByName: `${account.name} (${account.role})` } });
    await AuditLog.create({
      actorEmail: account.email,
      actorRole: account.role,
      module: 'admin',
      action: 'role-consolidation.account-removed',
      method: 'MIGRATION',
      path: '/migrate/role-consolidation',
      entityId: account._id.toString(),
      statusCode: 200,
      success: true,
      remarks: `${account.name}: ${account.role} merged into ${account.role === 'QC' ? ROLES.STORE : ROLES.FINANCE}`,
    });
  }
  await users.deleteMany({ role: { $in: REMOVED_ROLES } });
  console.log(`[migrate] Removed merged accounts: ${accounts.map((a) => a.email).join(', ')}`);
}

/** The single-account index listed the removed roles. An index can't be changed in place, so replace it. */
async function refreshAccountIndex() {
  const users = mongoose.connection.collection('users');
  const indexes = await users.indexes().catch(() => []);
  const existing = indexes.find((i) => i.name === 'single_master_account');
  const roles = (existing?.partialFilterExpression as { role?: { $in?: string[] } } | undefined)?.role?.$in ?? [];
  if (roles.some((role) => REMOVED_ROLES.includes(role))) await users.dropIndex('single_master_account');
}

/** QC merged into the Store, and AP and Treasury into Finance. Safe to run on every start. */
export async function consolidateRoles(): Promise<void> {
  await reassignApprovals();
  await settlePendingInspections();
  await removeAccounts();
  await refreshAccountIndex();
}

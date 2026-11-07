import { Router } from 'express';
import { PipelineStage } from 'mongoose';
import { INTERNAL_ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { InventoryItem } from '../../models/InventoryItem';
import { PurchaseOrder } from '../../models/PurchaseOrder';
import { PurchaseRequisition } from '../../models/PurchaseRequisition';
import { asyncHandler } from '../../utils/asyncHandler';

const MAX_RESULTS = 10;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface CatalogItem {
  description: string;
  itemCode?: string;
  uom: string;
  estimatedUnitPrice?: number;
}

const router = Router();
router.use(authenticate);

/**
 * Items matching what the user typed, from what the hospital already stocks and buys. The price is the
 * latest PO price, or the latest PR estimate for an item never ordered. Read only; there is no catalog to edit.
 */
router.get(
  '/items',
  authorize(...INTERNAL_ROLES),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const pattern = new RegExp(escape(q), 'i');

    const latest = (path: string, price: string): PipelineStage[] => [
      { $unwind: `$${path}` },
      { $match: { [`${path}.description`]: pattern } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $toLower: `$${path}.description` },
          description: { $first: `$${path}.description` },
          itemCode: { $first: `$${path}.itemCode` },
          uom: { $first: `$${path}.uom` },
          price: { $first: `$${path}.${price}` },
        },
      },
      { $limit: 25 },
    ];
    const [ordered, requested, stocked] = await Promise.all([
      PurchaseOrder.aggregate(latest('items', 'unitPrice')),
      PurchaseRequisition.aggregate(latest('items', 'estimatedUnitPrice')),
      InventoryItem.find({ description: pattern }).select('itemKey description uom').limit(25),
    ]);

    const byName = new Map<string, CatalogItem>();
    const add = (item: CatalogItem) => {
      const key = item.description.trim().toLowerCase();
      const known = byName.get(key);
      byName.set(key, {
        description: known?.description ?? item.description,
        itemCode: known?.itemCode || item.itemCode || undefined,
        uom: known?.uom ?? item.uom,
        estimatedUnitPrice: known?.estimatedUnitPrice ?? item.estimatedUnitPrice,
      });
    };
    // Order matters: a real purchase price beats an estimate.
    ordered.forEach((i) => add({ description: i.description, itemCode: i.itemCode, uom: i.uom ?? 'EA', estimatedUnitPrice: i.price }));
    requested.forEach((i) => add({ description: i.description, itemCode: i.itemCode, uom: i.uom ?? 'EA', estimatedUnitPrice: i.price }));
    // Stock keyed by description has no real item code.
    stocked.forEach((i) => add({ description: i.description, itemCode: i.itemKey === i.description.trim().toUpperCase() ? undefined : i.itemKey, uom: i.uom }));

    const results = [...byName.values()].sort((a, b) => {
      const starts = (x: CatalogItem) => (x.description.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1);
      return starts(a) - starts(b) || a.description.localeCompare(b.description);
    });
    res.json(results.slice(0, MAX_RESULTS));
  }),
);

export default router;

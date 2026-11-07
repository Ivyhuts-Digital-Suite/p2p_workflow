import { Router } from 'express';
import { isDatabaseConnected } from '../config/db';
import adminRoutes from '../modules/admin/admin.routes';
import auditRoutes from '../modules/audit/audit.routes';
import authRoutes from '../modules/auth/auth.routes';
import catalogRoutes from '../modules/catalog/catalog.routes';
import grnRoutes from '../modules/grn/grn.routes';
import invoiceRoutes from '../modules/invoice/invoice.routes';
import journeyRoutes from '../modules/journey/journey.routes';
import purchaseOrderRoutes from '../modules/purchase-order/purchaseOrder.routes';
import requisitionRoutes from '../modules/requisition/requisition.routes';
import serviceEntryRoutes from '../modules/service-entry/serviceEntry.routes';
import sourcingRoutes from '../modules/sourcing/sourcing.routes';
import treasuryRoutes from '../modules/treasury/treasury.routes';
import vendorRoutes from '../modules/vendor/vendor.routes';

const router = Router();

router.get('/health', (_req, res) => {
  const up = isDatabaseConnected();
  res.status(up ? 200 : 503).json({ status: up ? 'ok' : 'degraded', db: up ? 'up' : 'down', time: new Date() });
});

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/vendors', vendorRoutes);
router.use('/requisitions', requisitionRoutes); // Module 1
router.use('/sourcing', sourcingRoutes); //        Module 2
router.use('/purchase-orders', purchaseOrderRoutes); // Module 3
router.use('/grn', grnRoutes); //                  Module 4
router.use('/service-entries', serviceEntryRoutes);
router.use('/invoices', invoiceRoutes); //         Module 5
router.use('/treasury', treasuryRoutes); //        Module 6
router.use('/audit', auditRoutes);
router.use('/journey', journeyRoutes);
router.use('/catalog', catalogRoutes);

export default router;

/**
 * Seeds a development database with departments, DoA rules, one user per role and two vendors.
 * WARNING: drops all existing P2P data. Refuses to run with NODE_ENV=production.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { ROLES } from '../constants/roles';
import { VENDOR_STATUS } from '../constants/status';
import {
  AuditLog,
  Bid,
  Counter,
  Department,
  DoaRule,
  GoodsReceipt,
  InventoryItem,
  Invoice,
  Payment,
  PrMessage,
  PurchaseOrder,
  PurchaseRequisition,
  QcInspection,
  ReturnNote,
  RFQ,
  ServiceEntry,
  User,
  Vendor,
} from '../models';

const PASSWORD = 'Password@123';

export async function seedData() {
  if (env.isProduction) throw new Error('Refusing to seed a production database');

  await Promise.all(
    [AuditLog, Bid, Counter, Department, DoaRule, GoodsReceipt, InventoryItem, Invoice, Payment, PrMessage, PurchaseOrder, PurchaseRequisition, QcInspection, ReturnNote, RFQ, ServiceEntry, User, Vendor].map(
      (m) => (m as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()));

  const fy = '2026-27';
  const [it, ops] = await Department.create([
    { name: 'Information Technology', code: 'IT', costCenter: 'CC-100', budget: { fiscalYear: fy, allocated: 5_000_000 } },
    { name: 'Operations', code: 'OPS', costCenter: 'CC-200', budget: { fiscalYear: fy, allocated: 20_000_000 } },
  ]);

  await DoaRule.create([
    { name: 'Up to 1 Lakh', minAmount: 0, maxAmount: 100_000, levels: [{ level: 1, role: ROLES.PROCUREMENT }] },
    {
      name: '1 Lakh - 10 Lakh',
      minAmount: 100_000.01,
      maxAmount: 1_000_000,
      levels: [
        { level: 1, role: ROLES.PROCUREMENT },
        { level: 2, role: ROLES.HOD },
      ],
    },
    {
      name: 'Above 10 Lakh',
      minAmount: 1_000_000.01,
      maxAmount: null,
      levels: [
        { level: 1, role: ROLES.PROCUREMENT },
        { level: 2, role: ROLES.HOD },
        { level: 3, role: ROLES.FINANCE },
      ],
    },
    {
      name: 'High-value PR: above 10 Lakh',
      documentType: 'PR',
      minAmount: 1_000_000.01,
      maxAmount: null,
      levels: [{ level: 1, role: ROLES.FINANCE }],
    },
    {
      name: 'High-value payment: above 10 Lakh',
      documentType: 'PAYMENT',
      minAmount: 1_000_000.01,
      maxAmount: null,
      levels: [
        { level: 1, role: ROLES.HOD },
        { level: 2, role: ROLES.ADMIN },
      ],
    },
  ]);

  const internalUsers = [
    { name: 'System Admin', email: 'admin@p2p.local', role: ROLES.ADMIN, doaLimit: Number.MAX_SAFE_INTEGER },
    { name: 'Riya Requester', email: 'requester@p2p.local', role: ROLES.REQUESTER, department: it._id },
    { name: 'Harish HOD (IT)', email: 'hod.it@p2p.local', role: ROLES.HOD, department: it._id, doaLimit: 1_000_000 },
    { name: 'Omkar HOD (Ops)', email: 'hod.ops@p2p.local', role: ROLES.HOD, department: ops._id, doaLimit: 1_000_000 },
    { name: 'Priya Procurement', email: 'procurement@p2p.local', role: ROLES.PROCUREMENT, department: ops._id, doaLimit: 100_000 },
    { name: 'Pawan Procurement', email: 'procurement2@p2p.local', role: ROLES.PROCUREMENT, department: ops._id, doaLimit: 100_000 },
    { name: 'Sunil Store', email: 'store@p2p.local', role: ROLES.STORE, department: ops._id },
    { name: 'Farhan Finance', email: 'finance@p2p.local', role: ROLES.FINANCE, doaLimit: 100_000_000 },
    { name: 'Asha Auditor', email: 'auditor@p2p.local', role: ROLES.AUDITOR },
  ];
  // Create one by one so the password hashing pre-save hook runs for each user.
  const created = [];
  for (const u of internalUsers) created.push(await User.create({ ...u, password: PASSWORD }));
  it.hod = created.find((u) => u.email === 'hod.it@p2p.local')!._id;
  ops.hod = created.find((u) => u.email === 'hod.ops@p2p.local')!._id;
  await Promise.all([it.save(), ops.save()]);

  const vendors = [
    {
      companyName: 'TechNova Systems Pvt Ltd',
      contactPerson: 'Vikram Shah',
      email: 'vendor1@p2p.local',
      gstin: '27AAACT2727Q1ZW',
      pan: 'AAACT2727Q',
      categories: ['IT Hardware', 'Networking'],
      tdsSection: '194Q',
      rating: 4.2,
      bankDetails: { accountName: 'TechNova Systems Pvt Ltd', accountNumber: '001234567890', ifsc: 'HDFC0000123', bankName: 'HDFC Bank' },
    },
    {
      companyName: 'Infra Supplies Co',
      contactPerson: 'Meera Iyer',
      email: 'vendor2@p2p.local',
      gstin: '29AABCI1234F1Z5',
      pan: 'AABCI1234F',
      categories: ['IT Hardware', 'Office Supplies'],
      tdsSection: '194Q',
      rating: 3.6,
      bankDetails: { accountName: 'Infra Supplies Co', accountNumber: '987654321000', ifsc: 'ICIC0000456', bankName: 'ICICI Bank' },
    },
  ];
  for (const [index, v] of vendors.entries()) {
    const vendor = await Vendor.create({ ...v, vendorCode: `VEN-SEED-${index + 1}`, status: VENDOR_STATUS.APPROVED });
    const user = await User.create({ name: v.contactPerson, email: v.email, password: PASSWORD, role: ROLES.VENDOR, vendor: vendor._id });
    vendor.user = user._id;
    await vendor.save();
  }

  console.log('\nSeed complete. All accounts use password:', PASSWORD);
  console.table(
    [...internalUsers.map((u) => ({ email: u.email, role: u.role })), ...vendors.map((v) => ({ email: v.email, role: ROLES.VENDOR }))],
  );
}

if (require.main === module) {
  connectDatabase()
    .then(seedData)
    .then(disconnectDatabase)
    .catch(async (err) => {
      console.error(err);
      await disconnectDatabase();
      process.exit(1);
    });
}

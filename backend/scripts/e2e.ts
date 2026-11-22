/**
 * End-to-end test of sign-up, access control and the full P2P lifecycle over real HTTP.
 * Uses a throwaway in-memory MongoDB, so it never touches backend/.mongo-data.
 * Run with: npm run test:e2e
 */
import { createHmac } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { MongoMemoryServer } from 'mongodb-memory-server';

const PASSWORD = 'Password@123';
let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(name);
    console.error(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri('p2p_e2e');
  process.env.NODE_ENV = 'test';
  process.env.MATCH_PRICE_TOLERANCE_PCT = '2';
  process.env.INTERNAL_SIGNUP_CODE = '';

  const { default: mongoose } = await import('mongoose');
  const { connectDatabase, disconnectDatabase } = await import('../src/config/db');
  const { seedData } = await import('../src/seed/seed');
  const { createApp } = await import('../src/app');
  const { User } = await import('../src/models/User');
  const { PurchaseOrder } = await import('../src/models/PurchaseOrder');
  const { env } = await import('../src/config/env');

  await connectDatabase();
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  type Res = { status: number; body: any };
  const call = async (method: string, path: string, token?: string, body?: unknown): Promise<Res> => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (account: string) => {
    const res = await call('POST', '/auth/login', undefined, { email: `${account}@p2p.local`, password: PASSWORD });
    if (res.status !== 200) throw new Error(`Demo login failed for ${account}: ${JSON.stringify(res.body)}`);
    return res.body.token as string;
  };

  // ---- A real install: empty database, no seed data ---------------------------------------
  const emptyOptions = await call('GET', '/auth/signup-options');
  check('signup options on an empty database is 200 with no departments', emptyOptions.status === 200 && emptyOptions.body.departments.length === 0, emptyOptions);
  const firstAdmin = await call('POST', '/auth/register-internal', undefined, { role: 'ADMIN', name: 'Real Admin', email: 'owner@company.test', password: PASSWORD });
  check('first real admin signs up and is signed in', firstAdmin.status === 201 && !!firstAdmin.body.token, firstAdmin.body);
  const newDept = await call('POST', '/admin/departments', firstAdmin.body.token, { name: 'Facilities', code: 'FAC', budget: { fiscalYear: '2026-27', allocated: 100000 } });
  check('real admin creates a department', newDept.status === 201, newDept.body);
  const liveOptions = await call('GET', '/auth/signup-options');
  check('new department is offered at once', liveOptions.body.departments.some((d: { code: string }) => d.code === 'FAC'), liveOptions.body);
  const realRequester = await call('POST', '/auth/register-internal', undefined, { role: 'REQUESTER', name: 'Real Requester', email: 'req@company.test', password: PASSWORD, department: newDept.body._id });
  check('real requester signs up against that department', realRequester.status === 201, realRequester.body);
  await call('PATCH', `/admin/departments/${newDept.body._id}`, firstAdmin.body.token, { isActive: false });
  check('deactivated department is no longer offered', !(await call('GET', '/auth/signup-options')).body.departments.some((d: { code: string }) => d.code === 'FAC'));
  await seedData();

  // ---- Phase 4: every demo account signs in --------------------------------------------
  const accounts = ['requester', 'hod.it', 'hod.ops', 'procurement', 'store', 'finance', 'auditor', 'vendor1', 'vendor2', 'admin'];
  const t: Record<string, string> = {};
  for (const a of accounts) t[a] = await login(a);
  check('all 10 demo accounts sign in', Object.keys(t).length === 10);

  // ---- Phase 1: sign-up rules ----------------------------------------------------------
  const options = (await call('GET', '/auth/signup-options')).body;
  const it = options.departments.find((d: { code: string }) => d.code === 'IT');
  check('signup options list claimed master roles', ['ADMIN', 'AUDITOR', 'FINANCE', 'STORE'].every((r) => options.claimedRoles.includes(r)));

  const vendorForm = (n: number, gstin: string, pan: string) => ({
    companyName: `New Vendor ${n}`, contactPerson: 'Contact Person', email: `newvendor${n}@test.local`, phone: '9876543210', password: PASSWORD, gstin, pan, categories: [],
  });
  const newVendor = await call('POST', '/auth/register-vendor', undefined, vendorForm(1, '27AAAAA1111A1Z5', 'AAAAA1111A'));
  check('vendor can sign up', newVendor.status === 201 && !!newVendor.body.token, newVendor.body);
  check('second vendor can sign up', (await call('POST', '/auth/register-vendor', undefined, vendorForm(2, '27BBBBB2222B1Z5', 'BBBBB2222B'))).status === 201);
  check('vendor sign-up needs matching PAN and GSTIN', (await call('POST', '/auth/register-vendor', undefined, vendorForm(3, '27CCCCC3333C1Z5', 'AAAAA1111A'))).status === 422);
  const noTax = await call('POST', '/auth/register-vendor', undefined, { companyName: 'No Tax', contactPerson: 'No Tax', email: 'notax@test.local', password: PASSWORD, categories: [] });
  check('vendor sign-up needs phone, PAN and GSTIN', noTax.status === 422, noTax.body);

  for (const role of ['ADMIN', 'AUDITOR', 'FINANCE', 'STORE']) {
    const dup = await call('POST', '/auth/register-internal', undefined, { role, name: 'Second Account', email: `second.${role}@test.local`, password: PASSWORD });
    check(`duplicate ${role} sign-up is rejected`, dup.status === 409 && /Single Master/.test(dup.body.message), dup.body);
  }
  const dupHod = await call('POST', '/auth/register-internal', undefined, { role: 'HOD', name: 'Second Hod', email: 'second.hod@test.local', password: PASSWORD, department: it._id });
  check('duplicate HOD in a department is rejected', dupHod.status === 409, dupHod.body);

  const adminDup = await call('POST', '/admin/users', t.admin, { name: 'Second Store', email: 'second.store@test.local', password: PASSWORD, role: 'STORE', doaLimit: 0 });
  check('admin cannot create a second master account', adminDup.status === 409 && /Single Master/.test(adminDup.body.message), adminDup.body);
  const requesterId = (await call('GET', '/auth/me', t.requester)).body._id;
  const promote = await call('PATCH', `/admin/users/${requesterId}`, t.admin, { role: 'STORE' });
  check('admin cannot promote a user into a taken master role', promote.status === 409, promote.body);
  let dbRejected = false;
  try {
    await User.create({ name: 'Direct', email: 'direct@test.local', password: PASSWORD, role: 'STORE' });
  } catch (err) {
    dbRejected = (err as { code?: number }).code === 11000;
  }
  check('database index rejects a second master account', dbRejected);

  const race = await Promise.all(
    [1, 2].map((n) => call('POST', '/admin/departments', t.admin, { name: `Race Dept ${n}`, code: `RACE${n}`, budget: { fiscalYear: '2026-27', allocated: 1000 } })),
  );
  const raceHods = await Promise.all(
    [1, 2, 3].map((n) => call('POST', '/auth/register-internal', undefined, { role: 'HOD', name: `Racer ${n}`, email: `racer${n}@test.local`, password: PASSWORD, department: race[0].body._id })),
  );
  check('concurrent HOD sign-ups: exactly one wins', raceHods.filter((r) => r.status === 201).length === 1, raceHods.map((r) => r.status));

  const pending = await call('POST', '/auth/register-internal', undefined, { role: 'PROCUREMENT', name: 'New Buyer', email: 'buyer@test.local', password: PASSWORD });
  check('internal sign-up without a master limit is created without a session', pending.status === 201 && !pending.body.token, pending.body);
  check('pending account cannot sign in', (await call('POST', '/auth/login', undefined, { email: 'buyer@test.local', password: PASSWORD })).status === 401);
  const buyer = (await call('GET', '/admin/users?role=PROCUREMENT', t.admin)).body.find((u: { email: string }) => u.email === 'buyer@test.local');
  await call('PATCH', `/admin/users/${buyer._id}`, t.admin, { isActive: true });
  check('account signs in once an admin activates it', (await call('POST', '/auth/login', undefined, { email: 'buyer@test.local', password: PASSWORD })).status === 200);

  const secondSession = await login('finance');
  check('a master account can hold several live sessions', (await call('GET', '/auth/me', t.finance)).status === 200 && (await call('GET', '/auth/me', secondSession)).status === 200);
  const wrongCard = await call('POST', '/auth/login', undefined, { email: 'finance@p2p.local', password: PASSWORD, roles: ['ADMIN'] });
  check('login is refused on the wrong role card', wrongCard.status === 403, wrongCard.body);
  const wrongPwdCard = await call('POST', '/auth/login', undefined, { email: 'finance@p2p.local', password: 'wrong-password', roles: ['ADMIN'] });
  check('role card does not reveal a role without the password', wrongPwdCard.status === 401);
  for (const role of ['QC', 'AP', 'TREASURY']) {
    const merged = await call('POST', '/auth/register-internal', undefined, { role, name: 'Merged Role', email: `merged.${role}@test.local`, password: PASSWORD });
    check(`nobody can sign up as the merged role ${role}`, merged.status === 422, merged.body);
    check(`an admin cannot create the merged role ${role}`, (await call('POST', '/admin/users', t.admin, { name: 'Merged Role', email: `merged2.${role}@test.local`, password: PASSWORD, role, doaLimit: 0 })).status === 422);
  }
  for (const account of ['qc', 'ap', 'treasury']) {
    check(`the ${account} demo account is gone`, (await call('POST', '/auth/login', undefined, { email: `${account}@p2p.local`, password: PASSWORD })).status === 401);
  }
  check('the QC screens are gone', (await call('GET', '/qc/inspections', t.store)).status === 404);

  // ---- Phase 2: RBAC -------------------------------------------------------------------
  const readable = ['/requisitions', '/vendors', '/sourcing/rfqs', '/sourcing/dashboard', '/purchase-orders', '/grn', '/grn/inventory', '/invoices', '/treasury/queue', '/treasury/payments', '/admin/users', '/admin/departments', '/admin/doa-rules', '/audit/activity', '/audit/matching', '/audit/compliance', '/audit/awards', '/grn/returns', '/grn/inventory/near-expiry', '/service-entries', '/journey'];
  for (const path of readable) {
    const res = await call('GET', path, t.auditor);
    check(`auditor can read ${path}`, res.status === 200, res.body);
  }
  const denied: [string, string, string][] = [
    ['requester', 'GET', '/grn'], ['requester', 'GET', '/treasury/queue'], ['requester', 'GET', '/admin/users'], ['requester', 'GET', '/audit/activity'],
    ['store', 'GET', '/requisitions'], ['store', 'GET', '/treasury/queue'], ['store', 'GET', '/sourcing/rfqs'],
    ['finance', 'POST', '/grn'], ['finance', 'GET', '/audit/activity'],
    ['vendor1', 'GET', '/admin/users'], ['vendor1', 'GET', '/requisitions'], ['vendor1', 'GET', '/sourcing/dashboard'], ['vendor1', 'GET', '/vendors'],
    ['hod.it', 'GET', '/admin/users'], ['procurement', 'GET', '/audit/activity'],
  ];
  for (const [who, method, path] of denied) {
    const res = await call(method, path, t[who], method === 'POST' ? {} : undefined);
    check(`${who} is refused ${method} ${path}`, res.status === 403, res.status);
  }
  check('no token is refused', (await call('GET', '/purchase-orders')).status === 401);

  // ---- Phase 3, stage 1: PR and budget lock ---------------------------------------------
  const budget = async () => (await call('GET', '/admin/departments', t.admin)).body.find((d: { code: string }) => d.code === 'IT').budget;
  const createPr = await call('POST', '/requisitions', t.requester, { department: it._id,
    title: 'Laptops', priority: 'HIGH', items: [{ description: 'Laptop', quantity: 10, uom: 'EA', estimatedUnitPrice: 50000 }],
  });
  check('requester creates a PR', createPr.status === 201, createPr.body);
  const pr = createPr.body;
  check('only requesters create PRs', (await call('POST', '/requisitions', t['hod.it'], { title: 'Nope', priority: 'LOW', items: [{ description: 'x', quantity: 1, uom: 'EA', estimatedUnitPrice: 1 }] })).status === 403);
  await call('POST', `/requisitions/${pr._id}/submit`, t.requester);
  check('HOD of another department cannot approve', (await call('POST', `/requisitions/${pr._id}/approve`, t['hod.ops'], {})).status >= 403);
  check('auditor cannot approve a PR', (await call('POST', `/requisitions/${pr._id}/approve`, t.auditor, {})).status === 403);
  const committedBefore = (await budget()).committed;
  const approvePr = await call('POST', `/requisitions/${pr._id}/approve`, t['hod.it'], { remarks: 'OK' });
  check('HOD approves the PR', approvePr.status === 200, approvePr.body);
  check('approval locks the budget', (await budget()).committed === committedBefore + 500000);

  // ---- Stage 2: sourcing -----------------------------------------------------------------
  const rfqRes = await call('POST', '/sourcing/rfqs', t.procurement, { title: 'Laptop RFQ', requisitionIds: [pr._id], invitedVendorIds: [], closeAt: new Date(Date.now() + 3_600_000).toISOString() });
  check('procurement floats an RFQ', rfqRes.status === 201, rfqRes.body);
  const rfq = rfqRes.body;
  await call('POST', `/sourcing/rfqs/${rfq._id}/publish`, t.procurement);
  const itemId = rfq.items[0]._id;
  const bid = (token: string, unitPrice: number) => call('POST', `/sourcing/rfqs/${rfq._id}/bids`, token, { items: [{ rfqItemId: itemId, unitPrice }], deliveryDays: 7 });
  check('pending vendor cannot bid', (await bid(newVendor.body.token, 40000)).status === 403);
  const bid1 = await bid(t.vendor1, 48000);
  const bid2 = await bid(t.vendor2, 45000);
  check('both vendors bid', bid1.status === 201 && bid2.status === 201, [bid1.body, bid2.body]);
  check('a bid response cannot reveal the lowest rival quote', bid1.body.priceScore === undefined && bid1.body.qualityScore === undefined, bid1.body);

  // A high technical score on the dearer bid must not move it ahead of the cheaper one.
  await call('PATCH', `/sourcing/bids/${bid1.body._id}/quality-score`, t.procurement, { qualityScore: 100 });
  await call('PATCH', `/sourcing/bids/${bid2.body._id}/quality-score`, t.procurement, { qualityScore: 1 });
  const dashboard = (await call('GET', '/sourcing/dashboard', t.procurement)).body.rfqs[0];
  check('live ranking is by lowest price', dashboard.rankings[0].rank === 1 && dashboard.rankings[0].totalAmount === 450000 && dashboard.rankings[1].totalAmount === 480000, dashboard.rankings);
  const vendorView = (await call('GET', `/sourcing/rfqs/${rfq._id}/bids`, t.vendor1)).body;
  check('vendor sees own rank but no competitor bid', vendorView.bid.rank === 2 && !Array.isArray(vendorView) && vendorView.totalBids === 2);

  await call('POST', `/sourcing/rfqs/${rfq._id}/close`, t.procurement);
  // Everything a vendor can read about this RFQ, to compare across the award.
  const vendorRfqRead = async (token: string) => ({
    row: ((await call('GET', '/sourcing/rfqs', token)).body as any[]).find((r) => r._id === rfq._id),
    detail: (await call('GET', `/sourcing/rfqs/${rfq._id}`, token)).body,
    bids: (await call('GET', `/sourcing/rfqs/${rfq._id}/bids`, token)).body,
  });
  const nonBidder = newVendor.body.token;
  const loserBeforeAward = await vendorRfqRead(t.vendor2);
  const nonBidderBeforeAward = await vendorRfqRead(nonBidder);
  check('closed bid shows no rank or bid count', loserBeforeAward.bids.bid.rank === undefined && loserBeforeAward.bids.totalBids === undefined, loserBeforeAward.bids);
  const noWhy = await call('POST', `/sourcing/rfqs/${rfq._id}/award`, t.procurement, { bidId: bid1.body._id });
  check('non-L1 award without justification is refused', noWhy.status === 422, noWhy.body);
  const blankWhy = await call('POST', `/sourcing/rfqs/${rfq._id}/award`, t.procurement, { bidId: bid1.body._id, justification: '                ' });
  check('blank justification is refused', blankWhy.status === 422, blankWhy.body);
  const why = 'Vendor 1 offers 3 year on-site warranty that L1 does not';
  const award = await call('POST', `/sourcing/rfqs/${rfq._id}/award`, t.procurement, { bidId: bid1.body._id, justification: why });
  check('non-L1 award with justification succeeds', award.status === 200, award.body);

  // ---- PO under Delegation of Authority ---------------------------------------------------
  const po = award.body.po;
  check('award generates the PO', !!po?.poNumber, award.body);
  const storedPo = await call('GET', `/purchase-orders/${po._id}`, t.procurement);
  check('PO is stored in the database', storedPo.status === 200 && storedPo.body.poNumber === po.poNumber && storedPo.body.grandTotal === 566400, storedPo.body);
  const listedFor = async (who: string, params = '') =>
    ((await call('GET', `/purchase-orders${params}`, t[who])).body as { _id: string }[]).some((p) => p._id === po._id);
  for (const who of ['procurement', 'hod.it', 'requester', 'finance', 'store', 'auditor', 'admin']) {
    check(`new PO appears for ${who}`, await listedFor(who));
  }
  check('other department HOD does not see the PO', !(await listedFor('hod.ops')));
  check('vendor does not see the PO before it is issued', !(await listedFor('vendor1')));
  check('requisition is marked PO created', (await call('GET', `/requisitions/${pr._id}`, t.requester)).body.status === 'PO_CREATED');
  const rfqRow = ((await call('GET', '/sourcing/rfqs', t.procurement)).body as any[]).find((r) => r._id === rfq._id);
  check('RFQ links to its PO', rfqRow.purchaseOrder?.poNumber === po.poNumber, rfqRow.purchaseOrder);

  // Award privacy: only the winner may tell that this RFQ was awarded.
  const loserAfterAward = await vendorRfqRead(t.vendor2);
  check('losing vendor reads exactly the same before and after the award', JSON.stringify(loserAfterAward) === JSON.stringify(loserBeforeAward), [loserBeforeAward, loserAfterAward]);
  check('vendor who did not bid reads exactly the same before and after the award', JSON.stringify(await vendorRfqRead(nonBidder)) === JSON.stringify(nonBidderBeforeAward));
  check('losing vendor sees the RFQ as closed and their bid as submitted', loserAfterAward.row.status === 'CLOSED' && loserAfterAward.detail.status === 'CLOSED' && loserAfterAward.bids.bid.status === 'SUBMITTED', loserAfterAward);
  const loserText = JSON.stringify(loserAfterAward);
  check('losing vendor gets no award fields, winner name or PO reference', !/AWARDED|REJECTED|awarded|purchaseOrder|invitedVendors|requisitions|updatedAt|sourcePr/.test(loserText) && !loserText.includes(po.poNumber) && !loserText.includes(String(po.vendor)), loserText);
  const rfqIdsWithStatus = async (token: string, status: string) =>
    ((await call('GET', `/sourcing/rfqs?status=${status}`, token)).body as { _id: string }[]).map((r) => r._id);
  check('status filter does not reveal the award to a losing vendor', !(await rfqIdsWithStatus(t.vendor2, 'AWARDED')).includes(rfq._id) && (await rfqIdsWithStatus(t.vendor2, 'CLOSED')).includes(rfq._id));
  check('losing vendor cannot open the PO', (await call('GET', `/purchase-orders/${po._id}`, t.vendor2)).status === 404);
  const winnerAfterAward = await vendorRfqRead(t.vendor1);
  check('winning vendor sees the award and their bid as awarded', winnerAfterAward.row.status === 'AWARDED' && winnerAfterAward.detail.status === 'AWARDED' && !!winnerAfterAward.row.awardedAt && winnerAfterAward.bids.bid.status === 'AWARDED', winnerAfterAward);
  check('status filter finds the award for the winning vendor', (await rfqIdsWithStatus(t.vendor1, 'AWARDED')).includes(rfq._id));
  check('winning vendor gets no PO reference before it is issued', !winnerAfterAward.row.purchaseOrder && !winnerAfterAward.detail.purchaseOrder, winnerAfterAward.row);
  check('winning vendor does not see the award justification', !JSON.stringify(winnerAfterAward).includes(why));
  for (const [path, label] of [['/sourcing/dashboard', 'bidding dashboard'], ['/audit/awards', 'award log'], ['/requisitions', 'requisitions'], ['/vendors', 'vendor list']]) {
    check(`vendor is refused the ${label}`, (await call('GET', path, t.vendor2)).status === 403);
  }
  check('vendor cannot create a PO from a bid', (await call('POST', `/purchase-orders/from-bid/${bid1.body._id}`, t.vendor2, { taxRate: 18 })).status === 403);
  check('a second PO for the bid is refused', (await call('POST', `/purchase-orders/from-bid/${bid1.body._id}`, t.procurement, { taxRate: 18 })).status === 409);
  let secondPoRejected = false;
  try {
    await PurchaseOrder.create({ poNumber: 'PO-DUPLICATE', rfq: rfq._id, bid: bid1.body._id, vendor: po.vendor, department: po.department, createdBy: po.createdBy });
  } catch (err) {
    secondPoRejected = (err as { code?: number }).code === 11000;
  }
  check('database index rejects a second live PO for a bid', secondPoRejected);
  check('PO value picks the DoA chain', po.approvals.map((a: { role: string }) => a.role).join() === 'PROCUREMENT,HOD', po.approvals);
  const inApprovalQueue = async (who: string) =>
    ((await call('GET', '/purchase-orders?pendingMyApproval=true', t[who])).body as { _id: string }[]).some((p) => p._id === po._id);
  // Phase 23: the Procurement level is taken at vendor selection; the HOD level above Procurement's authority stays.
  check('Procurement level is auto-approved by the user who selected the vendor', po.approvals[0].status === 'APPROVED' && po.approvals[0].actedBy === po.createdBy && /Auto-approved/.test(po.approvals[0].remarks), po.approvals);
  check('a PO above Procurement authority waits for the HOD', po.status === 'PENDING_APPROVAL' && po.approvals[1].status === 'PENDING', po);
  check('procurement queue has nothing left to approve on it', !(await inApprovalQueue('procurement')));
  check('HOD queue has the PO at once', await inApprovalQueue('hod.it'));
  const poTrack = (await call('GET', `/requisitions/${pr._id}/journey`, t['hod.it'])).body;
  const poStep = poTrack.steps.find((s: { label: string }) => s.label === 'PO generated');
  check('journey shows one PO generated step, waiting on the HOD', !!poStep && poStep.state === 'current' && /HOD/.test(poStep.status) && poTrack.yourAction === true, poTrack.steps);
  check('journey has no separate PO approval, PO issued or acknowledgement steps', !poTrack.steps.some((s: { label: string }) => ['PO approval', 'PO issued', 'Vendor acknowledgement', 'Acknowledge PO'].includes(s.label)), poTrack.steps);
  check('PO creator still cannot approve the HOD level', (await call('POST', `/purchase-orders/${po._id}/approve`, t.procurement, {})).status === 403);
  check('auditor cannot approve a PO', (await call('POST', `/purchase-orders/${po._id}/approve`, t.auditor, {})).status === 403);
  check('other department HOD cannot see or approve the PO', (await call('POST', `/purchase-orders/${po._id}/approve`, t['hod.ops'], {})).status === 404);
  const hodPoApproval = await call('POST', `/purchase-orders/${po._id}/approve`, t['hod.it'], {});
  check('the final HOD approval issues the PO automatically', hodPoApproval.status === 200 && hodPoApproval.body.status === 'ISSUED' && !!hodPoApproval.body.issuedAt, hodPoApproval.body);
  check('the old issue step is not needed', (await call('POST', `/purchase-orders/${po._id}/issue`, t.procurement)).status === 422);
  const afterPoTrack = (await call('GET', `/requisitions/${pr._id}/journey`, t.admin)).body;
  check('after the PO, the vendor invoice comes first', afterPoTrack.steps.find((s: { state: string }) => s.state === 'current')?.label === 'Invoice', afterPoTrack.steps);
  const pathLabels = (afterPoTrack.steps as { label: string }[]).map((s) => s.label);
  check('the path runs PO, vendor invoice, GRN, then the Finance match', pathLabels.indexOf('PO generated') < pathLabels.indexOf('Invoice') && pathLabels.indexOf('Invoice') < pathLabels.indexOf('Goods receipt & inspection') && pathLabels.indexOf('Goods receipt & inspection') < pathLabels.indexOf('Invoice verification & 3-way match'), pathLabels);
  const winnerAfterIssue = await vendorRfqRead(t.vendor1);
  check('winning vendor gets the PO reference once issued', winnerAfterIssue.row.purchaseOrder?.poNumber === po.poNumber && winnerAfterIssue.detail.purchaseOrder?.poNumber === po.poNumber, winnerAfterIssue.row);
  check('losing vendor still reads the same after the PO is issued', JSON.stringify(await vendorRfqRead(t.vendor2)) === JSON.stringify(loserBeforeAward));
  const poItemId = po.items[0]._id;

  // ---- Vendor-specific invoice dropdown --------------------------------------------------
  const invoiceable = async (who: string) => {
    const res = await call('GET', '/purchase-orders/invoiceable', t[who]);
    return { status: res.status, ids: (res.body as { _id: string; vendor: { _id: string } }[]).map((p) => p._id), rows: res.body as { vendor: { _id: string } }[] };
  };
  const earlyInvoice = { purchaseOrderId: po._id, invoiceNumber: 'EARLY-1', invoiceDate: new Date().toISOString(), claimedTotal: 566400, items: [{ poItemId, quantity: 10, unitPrice: 48000, taxRate: 18 }] };
  check('Finance can key an invoice for an issued PO', (await invoiceable('finance')).ids.includes(po._id));
  check('vendor sees the issued PO', await listedFor('vendor1'));
  check('there is no acknowledgement step any more', (await call('POST', `/purchase-orders/${po._id}/acknowledge`, t.vendor1)).status === 404);
  check('an issued PO is in the winning vendor dropdown at once', (await invoiceable('vendor1')).ids.includes(po._id));
  check('another vendor dropdown never shows it', !(await invoiceable('vendor2')).ids.includes(po._id));
  const vendor1Id = (await call('GET', '/auth/me', t.vendor1)).body.vendor._id;
  check('vendor dropdown holds only their own POs', (await invoiceable('vendor1')).rows.every((p) => p.vendor._id === vendor1Id));
  check('a new vendor dropdown is empty', (await call('GET', '/purchase-orders/invoiceable', newVendor.body.token)).body.length === 0);
  check('another vendor cannot read the PO', (await call('GET', `/purchase-orders/${po._id}`, t.vendor2)).status === 404);
  check('another vendor cannot invoice the PO', (await call('POST', '/invoices', t.vendor2, { ...earlyInvoice, invoiceNumber: 'STOLEN-1' })).status === 404);
  check('another vendor cannot see the PO in their list', !(await listedFor('vendor2')));
  check('roles without invoicing are refused the dropdown', (await call('GET', '/purchase-orders/invoiceable', t.store)).status === 403);

  // ---- Stage 3: warehouse GRN -----------------------------------------------------------
  const grnWait = await call('POST', '/invoices', t.vendor1, { ...earlyInvoice, invoiceNumber: 'GRN-WAIT' });
  check('an invoice without boxes on paperwork records 0', grnWait.body.boxesOnPaperwork === 0, grnWait.body.boxesOnPaperwork);
  check('the vendor can invoice before the goods arrive; the match waits for the GRN', grnWait.status === 201 && grnWait.body.status === 'SUBMITTED' && grnWait.body.match.status === 'PENDING' && grnWait.body.match.exceptions.length === 0, grnWait.body);
  await call('POST', `/invoices/${grnWait.body._id}/reject`, t.finance, { reason: 'Test of an early invoice' });
  const grnBody = (over: object) => ({
    purchaseOrderId: po._id, warehouse: 'MAIN-WH', deliveryNoteNumber: 'CH-100', physicalCheck: { boxesExpected: 10, boxesCounted: 10 },
    items: [{ poItemId, receivedQty: 8, acceptedQty: 7, qualityStatus: 'DAMAGED', rejectionReason: 'Cracked screen', shortageReason: 'Balance to follow' }],
    ...over,
  });
  check('GRN needs an invoice / challan number', (await call('POST', '/grn', t.store, grnBody({ deliveryNoteNumber: '' }))).status === 422);
  check('box mismatch needs remarks', (await call('POST', '/grn', t.store, grnBody({ physicalCheck: { boxesExpected: 10, boxesCounted: 8 } }))).status === 422);
  const shortNoReason = await call('POST', '/grn', t.store, grnBody({ items: [{ poItemId, receivedQty: 8, acceptedQty: 8, qualityStatus: 'PASSED' }] }));
  check('shortage needs a reason', shortNoReason.status === 422, shortNoReason.body);
  const noRejectReason = await call('POST', '/grn', t.store, grnBody({ items: [{ poItemId, receivedQty: 10, acceptedQty: 9, qualityStatus: 'DAMAGED' }] }));
  check('rejection needs a reason', noRejectReason.status === 422, noRejectReason.body);
  const grn1 = await call('POST', '/grn', t.store, grnBody({ physicalCheck: { boxesExpected: 10, boxesCounted: 8 }, qcRemarks: '2 cartons missing' }));
  check('partial GRN posts as MW GRN', grn1.status === 201 && grn1.body.grnNumber.startsWith('MW-GRN-'), grn1.body);
  check('GRN records shortage and rejection', grn1.body.items[0].shortageQty === 2 && grn1.body.items[0].rejectedQty === 1 && grn1.body.status === 'PARTIALLY_ACCEPTED', grn1.body.items);
  const grn2 = await call('POST', '/grn', t.store, grnBody({ deliveryNoteNumber: 'CH-101', physicalCheck: { boxesExpected: 3, boxesCounted: 3 }, items: [{ poItemId, receivedQty: 3, acceptedQty: 3, qualityStatus: 'PASSED' }] }));
  check('balance GRN completes receipt', grn2.status === 201, grn2.body);

  // ---- Stage 4: AP 3-way match -----------------------------------------------------------
  const invoice = (number: string, unitPrice: number, quantity = 10) => {
    const taxable = unitPrice * quantity;
    return { purchaseOrderId: po._id, invoiceNumber: number, invoiceDate: new Date().toISOString(), claimedTotal: Math.round(taxable * 1.18 * 100) / 100, items: [{ poItemId, quantity, unitPrice, taxRate: 18 }] };
  };
  const over = await call('POST', '/invoices', t.vendor1, invoice('INV-OVER', 49000));
  check('2.08% over PO price is an exception', over.status === 201 && over.body.status === 'EXCEPTION' && over.body.match.exceptions.some((e: { type: string }) => e.type === 'PRICE_VARIANCE'), over.body.match);
  check('booking an exception is refused', (await call('POST', `/invoices/${over.body._id}/book`, t.finance, { glAccount: '5000' })).status === 422);
  await call('POST', `/invoices/${over.body._id}/reject`, t.finance, { reason: 'Price above PO' });
  const inTol = await call('POST', '/invoices', t.vendor1, invoice('inv-001', 48900));
  check('1.88% over PO price matches automatically', inTol.status === 201 && inTol.body.status === 'MATCHED', inTol.body.match);
  const dup = await call('POST', '/invoices', t.vendor1, invoice('INV-001', 48000));
  check('duplicate invoice number is blocked, ignoring case', dup.status === 409 && /Duplicate invoice/.test(dup.body.message), dup.body);
  const booked = await call('POST', `/invoices/${inTol.body._id}/book`, t.finance, { glAccount: '5000' });
  check('Finance books the liability', booked.status === 200 && booked.body.status === 'BOOKED', booked.body);
  check('PO stays open until paid', (await call('GET', `/purchase-orders/${po._id}`, t.finance)).body.status === 'RECEIVED');
  check('fully billed PO leaves the invoice dropdown', !(await invoiceable('vendor1')).ids.includes(po._id) && !(await invoiceable('finance')).ids.includes(po._id));
  check('unpaid PO is in the active view', (await listedFor('procurement', '?view=active')) && !(await listedFor('procurement', '?view=past')));

  // ---- Stage 5: tax compliance and payment ---------------------------------------------
  check('another role cannot verify tax', (await call('POST', `/treasury/invoices/${inTol.body._id}/verify-tax`, t.store, {})).status === 403);
  check('auditor cannot verify tax', (await call('POST', `/treasury/invoices/${inTol.body._id}/verify-tax`, t.auditor, {})).status === 403);
  const tax = await call('POST', `/treasury/invoices/${inTol.body._id}/verify-tax`, t.finance, { tdsSection: '194Q' });
  check('Finance verifies tax', tax.status === 200, tax.body);
  check('TDS 194Q is 0.1% of the pre-GST value', tax.body.payment.tdsAmount === 489, tax.body.payment);
  const paymentId = tax.body.payment._id;
  const paidBefore = (await budget()).consumed;
  check('another role cannot release', (await call('POST', `/treasury/payments/${paymentId}/release`, t.store, { mode: 'RTGS' })).status === 403);
  check('auditor cannot release', (await call('POST', `/treasury/payments/${paymentId}/release`, t.auditor, { mode: 'RTGS' })).status === 403);
  const release = await call('POST', `/treasury/payments/${paymentId}/release`, t.finance, { mode: 'RTGS' });
  check('Finance releases what it verified, with a UTR', release.status === 200 && release.body.status === 'RELEASED' && !!release.body.utr, release.body);
  check('payment closes the PO', (await call('GET', `/purchase-orders/${po._id}`, t.finance)).body.status === 'CLOSED');
  check('payment records actual budget use', (await budget()).consumed === paidBefore + 489000);

  // ---- Past POs --------------------------------------------------------------------------
  for (const who of ['procurement', 'finance', 'vendor1', 'auditor']) {
    check(`${who} finds the paid PO in the past view, not active`, (await listedFor(who, '?view=past')) && !(await listedFor(who, '?view=active')));
  }
  check('another vendor past view excludes it', !(await listedFor('vendor2', '?view=past')));
  const pastRow = ((await call('GET', '/purchase-orders?view=past', t.vendor1)).body as any[]).find((p) => p._id === po._id);
  check('past PO shows invoiced and paid totals', pastRow.paidAmount === inTol.body.total && pastRow.invoicedAmount === inTol.body.total, pastRow);
  const vendorSummary = (await call('GET', '/purchase-orders/summary', t.vendor1)).body;
  check('summary counts the vendor history', vendorSummary.past === 1 && vendorSummary.active === 0, vendorSummary);

  // Admin bypasses role checks but not maker-checker.
  const pr2 = (await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Mouse', priority: 'LOW', items: [{ description: 'Mouse', quantity: 1, uom: 'EA', estimatedUnitPrice: 1000 }] })).body;
  await call('POST', `/requisitions/${pr2._id}/submit`, t.requester);
  await call('POST', `/requisitions/${pr2._id}/approve`, t['hod.it'], {});
  const rfq2 = (await call('POST', '/sourcing/rfqs', t.procurement, { title: 'Mouse RFQ', requisitionIds: [pr2._id], invitedVendorIds: [], closeAt: new Date(Date.now() + 3_600_000).toISOString() })).body;
  await call('POST', `/sourcing/rfqs/${rfq2._id}/publish`, t.procurement);
  const bid3 = (await call('POST', `/sourcing/rfqs/${rfq2._id}/bids`, t.vendor2, { items: [{ rfqItemId: rfq2.items[0]._id, unitPrice: 900 }], deliveryDays: 2 })).body;
  await call('POST', `/sourcing/rfqs/${rfq2._id}/close`, t.procurement);
  const rfqStatus = async () => (await call('GET', `/sourcing/rfqs/${rfq2._id}`, t.procurement)).body.status;
  const vendor2Id = (await call('GET', '/auth/me', t.vendor2)).body.vendor._id;
  await call('POST', `/vendors/${vendor2Id}/suspend`, t.procurement);
  const suspendedAward = await call('POST', `/sourcing/rfqs/${rfq2._id}/award`, t.procurement, { bidId: bid3._id });
  check('suspended vendor cannot be awarded', suspendedAward.status === 422 && (await rfqStatus()) === 'CLOSED', suspendedAward.body);
  await call('POST', `/vendors/${vendor2Id}/approve`, t.procurement);

  const rules = (await call('GET', '/admin/doa-rules', t.admin)).body as { _id: string }[];
  for (const r of rules) await call('PATCH', `/admin/doa-rules/${r._id}`, t.admin, { isActive: false });
  const noRule = await call('POST', `/sourcing/rfqs/${rfq2._id}/award`, t.procurement, { bidId: bid3._id });
  check('award is refused with no DoA rule, changing nothing', noRule.status === 422 && /Delegation of Authority/.test(noRule.body.message) && (await rfqStatus()) === 'CLOSED', noRule.body);
  for (const r of rules) await call('PATCH', `/admin/doa-rules/${r._id}`, t.admin, { isActive: true });
  check('award with an invalid GST rate is refused', (await call('POST', `/sourcing/rfqs/${rfq2._id}/award`, t.procurement, { bidId: bid3._id, taxRate: 7 })).status === 422);

  const raceAwards = await Promise.all(
    [1, 2, 3].map(() => call('POST', `/sourcing/rfqs/${rfq2._id}/award`, t.procurement, { bidId: bid3._id })),
  );
  const winners = raceAwards.filter((r) => r.status === 200);
  check('simultaneous awards: exactly one succeeds', winners.length === 1, raceAwards.map((r) => r.status));
  check('L1 award needs no justification', !!winners[0]?.body.po);
  const po2 = winners[0].body.po;
  const po2Copies = ((await call('GET', '/purchase-orders', t.procurement)).body as { rfq: { _id: string } }[]).filter((p) => p.rfq._id === rfq2._id);
  check('simultaneous awards leave one PO', po2Copies.length === 1, po2Copies.length);
  check('a PO within Procurement authority is approved and issued at vendor selection', po2.status === 'ISSUED' && !!po2.issuedAt && po2.approvals.every((a: { status: string }) => a.status === 'APPROVED'), po2);
  await call('POST', '/grn', t.store, { purchaseOrderId: po2._id, warehouse: 'MAIN-WH', deliveryNoteNumber: 'CH-200', physicalCheck: { boxesExpected: 1, boxesCounted: 1 }, items: [{ poItemId: po2.items[0]._id, receivedQty: 1, acceptedQty: 1, qualityStatus: 'PASSED' }] });
  const inv2 = (await call('POST', '/invoices', t.vendor2, { purchaseOrderId: po2._id, invoiceNumber: 'V2-1', invoiceDate: new Date().toISOString(), claimedTotal: 1062, items: [{ poItemId: po2.items[0]._id, quantity: 1, unitPrice: 900, taxRate: 18 }] })).body;
  check('second invoice matches', inv2.status === 'MATCHED', inv2.match);
  await call('POST', `/invoices/${inv2._id}/book`, t.finance, { glAccount: '5000' });
  const adminTax = await call('POST', `/treasury/invoices/${inv2._id}/verify-tax`, t.admin, {});
  check('admin can verify tax', adminTax.status === 200, adminTax.body);
  const adminRelease = await call('POST', `/treasury/payments/${adminTax.body.payment._id}/release`, t.admin, { mode: 'NEFT' });
  check('admin can release as well', adminRelease.status === 200, adminRelease.body);

  // A PO cancelled after issue stays in the vendor's history.
  const pr3 = (await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Keyboard', priority: 'LOW', items: [{ description: 'Keyboard', quantity: 1, uom: 'EA', estimatedUnitPrice: 2000 }] })).body;
  await call('POST', `/requisitions/${pr3._id}/submit`, t.requester);
  await call('POST', `/requisitions/${pr3._id}/approve`, t['hod.it'], {});
  const rfq3 = (await call('POST', '/sourcing/rfqs', t.procurement, { title: 'Keyboard RFQ', requisitionIds: [pr3._id], invitedVendorIds: [], closeAt: new Date(Date.now() + 3_600_000).toISOString() })).body;
  await call('POST', `/sourcing/rfqs/${rfq3._id}/publish`, t.procurement);
  const bid4 = (await call('POST', `/sourcing/rfqs/${rfq3._id}/bids`, t.vendor2, { items: [{ rfqItemId: rfq3.items[0]._id, unitPrice: 1500 }], deliveryDays: 2 })).body;
  await call('POST', `/sourcing/rfqs/${rfq3._id}/close`, t.procurement);
  const po3 = (await call('POST', `/sourcing/rfqs/${rfq3._id}/award`, t.procurement, { bidId: bid4._id })).body.po;
  await call('POST', `/purchase-orders/${po3._id}/cancel`, t.procurement, { reason: 'Requirement withdrawn' });
  const vendorPast = (await call('GET', '/purchase-orders?view=past', t.vendor2)).body as { _id: string; status: string }[];
  check('PO cancelled after issue stays in vendor history', vendorPast.some((p) => p._id === po3._id && p.status === 'CANCELLED'), vendorPast);
  check('cancelled PO leaves the vendor dropdown', !(await invoiceable('vendor2')).ids.includes(po3._id));

  // ---- Audit trail -----------------------------------------------------------------------
  await new Promise((resolve) => setTimeout(resolve, 300)); // audit entries are written after the response
  const activity = (await call('GET', '/audit/activity', t.auditor)).body as any[];
  check('audit trail records approvals with the document number', activity.some((l) => l.action === 'approve' && l.docRef === po.poNumber && l.actorRole === 'HOD'), activity.slice(0, 3));
  check('audit trail records refused attempts', activity.some((l) => l.actorRole === 'AUDITOR' && !l.success && l.statusCode === 403));
  check('audit trail keeps the award justification', activity.some((l) => l.remarks === why));
  check('audit trail records failed logins by email', activity.some((l) => l.module === 'auth' && !l.success && l.actorEmail === 'finance@p2p.local'));
  check('audit trail never stores a password', !JSON.stringify(activity).includes(PASSWORD));
  check('audit trail has no write route', (await call('POST', '/audit/activity', t.admin, {})).status === 404);
  const awards = (await call('GET', '/audit/awards', t.auditor)).body as any[];
  check('award log shows non-L1 rank and justification', awards.some((a) => a.awardedBid.rank === 2 && a.awardJustification === why), awards);
  const matching = (await call('GET', '/audit/matching', t.auditor)).body as any[];
  check('match log keeps exception details', matching.some((m) => m.match.exceptions.some((e: { type: string }) => e.type === 'PRICE_VARIANCE')));
  const compliance = (await call('GET', '/audit/compliance', t.auditor)).body;
  const paid = compliance.payments.find((p: { _id: string }) => p._id === paymentId);
  check('compliance shows who verified and released', paid.verifiedBy.name === 'Farhan Finance' && paid.releasedBy.name === 'Farhan Finance', paid);

  // ---- Hospital go-live: helpers ---------------------------------------------------------
  const closeAt = () => new Date(Date.now() + 3_600_000).toISOString();
  const raisePr = async (title: string, itemType: string, quantity: number, unitPrice: number, extra: object = {}) => {
    const created = await call('POST', '/requisitions', t.requester, { department: it._id, title, priority: 'HIGH', items: [{ description: title, quantity, uom: 'EA', estimatedUnitPrice: unitPrice, itemType }], ...extra });
    if (created.status !== 201) throw new Error(`PR failed: ${JSON.stringify(created.body)}`);
    await call('POST', `/requisitions/${created.body._id}/submit`, t.requester);
    return created.body;
  };
  const approvedPr = async (title: string, itemType: string, quantity: number, unitPrice: number) => {
    const pr = await raisePr(title, itemType, quantity, unitPrice);
    const first = await call('POST', `/requisitions/${pr._id}/approve`, t['hod.it'], {});
    if (first.body.status === 'SUBMITTED') await call('POST', `/requisitions/${pr._id}/approve`, t.finance, {});
    return pr;
  };
  const publishedRfq = async (title: string, prId: string, extra: object = {}) => {
    const res = await call('POST', '/sourcing/rfqs', t.procurement, { title, requisitionIds: [prId], invitedVendorIds: [], closeAt: closeAt(), ...extra });
    if (res.status !== 201) throw new Error(`RFQ failed: ${JSON.stringify(res.body)}`);
    await call('POST', `/sourcing/rfqs/${res.body._id}/publish`, t.procurement);
    return res.body;
  };
  const placeBid = (rfq: any, who: string, unitPrice: number, taxRate?: number) =>
    call('POST', `/sourcing/rfqs/${rfq._id}/bids`, t[who], { items: [{ rfqItemId: rfq.items[0]._id, unitPrice, ...(taxRate === undefined ? {} : { taxRate }) }], deliveryDays: 3 });
  /** Takes any approval level still pending above Procurement's authority; the last one issues the PO. */
  const approveAndIssue = async (po: any) => {
    const approver: Record<string, string> = { HOD: 'hod.it', FINANCE: 'finance' };
    for (const step of po.approvals.filter((a: { status: string }) => a.status === 'PENDING')) {
      await call('POST', `/purchase-orders/${po._id}/approve`, t[approver[step.role]], {});
    }
  };
  /** A PO issued to vendor1, from a fresh single-line requisition. */
  const acceptedPo = async (title: string, itemType: string, quantity: number, unitPrice: number) => {
    const pr = await approvedPr(title, itemType, quantity, unitPrice);
    const rfq = await publishedRfq(`${title} RFQ`, pr._id);
    const quoted = await placeBid(rfq, 'vendor1', unitPrice);
    await call('POST', `/sourcing/rfqs/${rfq._id}/close`, t.procurement);
    const awarded = await call('POST', `/sourcing/rfqs/${rfq._id}/award`, t.procurement, { bidId: quoted.body._id });
    if (!awarded.body.po) throw new Error(`Award failed: ${JSON.stringify(awarded.body)}`);
    await approveAndIssue(awarded.body.po);
    return { po: awarded.body.po, pr, rfq, bid: quoted.body };
  };
  const grnFor = (po: any, line: object, deliveryNoteNumber = 'CH-GL') => ({
    purchaseOrderId: po._id, warehouse: 'PHARMACY', deliveryNoteNumber, physicalCheck: { boxesExpected: 1, boxesCounted: 1 }, items: [{ poItemId: po.items[0]._id, qualityStatus: 'PASSED', ...line }],
  });
  const billOf = (po: any, number: string, quantity: number, unitPrice = po.items[0].unitPrice, taxRate = po.items[0].taxRate) => ({
    purchaseOrderId: po._id, invoiceNumber: number, invoiceDate: new Date().toISOString(), claimedTotal: Math.round(quantity * unitPrice * (1 + taxRate / 100) * 100) / 100, items: [{ poItemId: po.items[0]._id, quantity, unitPrice, taxRate }],
  });
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  // ---- Batch, expiry, serials, QC and quarantine ------------------------------------------
  const drug = await acceptedPo('Saline drip', 'BATCH', 10, 100);
  check('item type reaches the PO', drug.po.items[0].itemType === 'BATCH', drug.po.items[0]);
  const noBatch = await call('POST', '/grn', t.store, grnFor(drug.po, { receivedQty: 10, acceptedQty: 10 }));
  check('batch item needs a batch and expiry', noBatch.status === 422 && /batch number/.test(noBatch.body.message), noBatch.body);
  const expired = await call('POST', '/grn', t.store, grnFor(drug.po, { receivedQty: 10, acceptedQty: 10, batchNumber: 'B-OLD', expiryDate: days(-1) }));
  check('expired goods are refused at receipt', expired.status === 422 && /expired/.test(expired.body.message), expired.body);
  const rejectedExpired = await call('POST', '/grn', t.store, grnFor(drug.po, { receivedQty: 2, acceptedQty: 0, qualityStatus: 'QUALITY_FAILED', rejectionReason: 'Expired on arrival', shortageReason: 'Balance to follow', batchNumber: 'B-OLD', expiryDate: days(-1) }));
  check('expired goods can still be recorded as rejected', rejectedExpired.status === 201 && rejectedExpired.body.status === 'REJECTED', rejectedExpired.body);
  const vendorEarly = await call('POST', '/invoices', t.vendor1, billOf(drug.po, 'GL-EARLY', 8));
  check('a vendor bills before receipt and the match waits', vendorEarly.status === 201 && vendorEarly.body.status === 'SUBMITTED' && vendorEarly.body.match.status === 'PENDING', vendorEarly.body);
  await call('POST', `/invoices/${vendorEarly.body._id}/reject`, t.finance, { reason: 'Test of an early invoice' });
  const earlyAp = await call('POST', '/invoices', t.finance, billOf(drug.po, 'GL-EARLY-AP', 8));
  check('an invoice Finance keys early waits for the goods too', earlyAp.status === 201 && earlyAp.body.status === 'SUBMITTED' && earlyAp.body.match.status === 'PENDING', earlyAp.body.match);
  await call('POST', `/invoices/${earlyAp.body._id}/reject`, t.finance, { reason: 'Keyed too early' });
  const drugGrn = await call('POST', '/grn', t.store, grnFor(drug.po, { receivedQty: 8, acceptedQty: 6, qualityStatus: 'QUALITY_FAILED', rejectionReason: '2 units leaking', batchNumber: 'B-100', expiryDate: days(30), shortageReason: 'Balance to follow' }));
  check('GRN stores batch, expiry and the quality result', drugGrn.status === 201 && drugGrn.body.items[0].batchNumber === 'B-100' && !!drugGrn.body.items[0].expiryDate && drugGrn.body.items[0].rejectedQty === 2, drugGrn.body);
  const salineStock = async () => ((await call('GET', '/grn/inventory', t.store)).body as any[]).find((i) => i.description === 'Saline drip');
  const stockAfterGrn = await salineStock();
  check('what the Store accepts enters stock at once, with its batch', stockAfterGrn?.quantity === 6 && stockAfterGrn.batches[0].batchNumber === 'B-100', stockAfterGrn);
  const drugAfterGrn = (await call('GET', `/purchase-orders/${drug.po._id}`, t.procurement)).body;
  check('rejected goods stay open on the PO', drugAfterGrn.items[0].receivedQty === 6 && drugAfterGrn.status === 'PARTIALLY_RECEIVED', drugAfterGrn.items[0]);
  const nearExpiry = (await call('GET', '/grn/inventory/near-expiry', t.store)).body;
  check('near-expiry report lists the batch', nearExpiry.rows.some((r: any) => r.batchNumber === 'B-100' && r.quantity === 6 && r.daysLeft <= 30 && !r.expired), nearExpiry);
  check('near-expiry window can be narrowed', !(await call('GET', '/grn/inventory/near-expiry?days=5', t.store)).body.rows.some((r: any) => r.batchNumber === 'B-100'));
  const invoiceableDrug = ((await call('GET', '/purchase-orders/invoiceable', t.vendor1)).body as any[]).find((p) => p._id === drug.po._id);
  check('invoice dropdown shows the quantity accepted', invoiceableDrug.items[0].clearedQty === 6, invoiceableDrug.items[0]);
  const overQc = await call('POST', '/invoices', t.vendor1, billOf(drug.po, 'GL-OVERQC', 7));
  check('billing beyond what was accepted waits for the rest of the goods', overQc.body.status === 'SUBMITTED' && overQc.body.match.status === 'PENDING', overQc.body.match);
  await call('POST', `/invoices/${overQc.body._id}/reject`, t.finance, { reason: 'Over the accepted quantity' });
  check('a second delivery can be rejected in full', (await call('POST', '/grn', t.store, grnFor(drug.po, { receivedQty: 4, acceptedQty: 0, qualityStatus: 'DAMAGED', rejectionReason: 'Crushed', batchNumber: 'B-101', expiryDate: days(10) }, 'CH-GL2'))).status === 201);

  const device = await acceptedPo('Pulse oximeter', 'SERIAL', 2, 500);
  check('a serialised item needs one serial per unit', (await call('POST', '/grn', t.store, grnFor(device.po, { receivedQty: 2, acceptedQty: 2, serialNumbers: ['S1'] }))).status === 422);
  check('serials must be unique', (await call('POST', '/grn', t.store, grnFor(device.po, { receivedQty: 2, acceptedQty: 2, serialNumbers: ['S1', 'S1'] }))).status === 422);
  const deviceGrn = await call('POST', '/grn', t.store, grnFor(device.po, { receivedQty: 1, acceptedQty: 1, serialNumbers: ['S1'], shortageReason: 'One to follow' }));
  check('serial is stored', deviceGrn.status === 201 && deviceGrn.body.items[0].serialNumbers[0] === 'S1', deviceGrn.body);
  check('a serial cannot be received twice on a PO', (await call('POST', '/grn', t.store, grnFor(device.po, { receivedQty: 1, acceptedQty: 1, serialNumbers: ['S1'] }, 'CH-GL3'))).status === 409);

  // ---- Returns ------------------------------------------------------------------------------
  const drugGrnLine = drugGrn.body.items[0]._id;
  const tooMany = await call('POST', `/grn/${drugGrn.body._id}/returns`, t.store, { grnLineId: drugGrnLine, quantity: 3, reason: 'Leaking', resolution: 'CREDIT' });
  check('cannot return more than was rejected', tooMany.status === 422, tooMany.body);
  check('only the store raises returns', (await call('POST', `/grn/${drugGrn.body._id}/returns`, t.vendor1, { grnLineId: drugGrnLine, quantity: 1, reason: 'Leaking', resolution: 'CREDIT' })).status === 403);
  const returned = await call('POST', `/grn/${drugGrn.body._id}/returns`, t.store, { grnLineId: drugGrnLine, quantity: 2, reason: 'Leaking', resolution: 'CREDIT' });
  check('rejected goods can be returned', returned.status === 201 && returned.body.status === 'RAISED', returned.body);
  check('a line cannot be returned twice', (await call('POST', `/grn/${drugGrn.body._id}/returns`, t.store, { grnLineId: drugGrnLine, quantity: 1, reason: 'Again', resolution: 'CREDIT' })).status === 422);
  const dispatched = await call('POST', `/grn/returns/${returned.body._id}/dispatch`, t.store, { carrierReference: 'LR-55' });
  check('return is dispatched', dispatched.status === 200 && dispatched.body.status === 'DISPATCHED', dispatched.body);
  check('dispatch only happens once', (await call('POST', `/grn/returns/${returned.body._id}/dispatch`, t.store, { carrierReference: 'LR-56' })).status === 422);
  check('vendor sees their return', ((await call('GET', '/grn/returns', t.vendor1)).body as any[]).some((r) => r._id === returned.body._id));
  check('another vendor does not', !((await call('GET', '/grn/returns', t.vendor2)).body as any[]).some((r) => r._id === returned.body._id));

  // ---- Debit and credit notes ------------------------------------------------------------------
  const committedNow = async () => (await budget()).committed;
  check('short-close has been removed', (await call('POST', `/purchase-orders/${drug.po._id}/short-close`, t.procurement, { reason: 'Vendor cannot supply the rest' })).status === 404);
  const drugInvoice = await call('POST', '/invoices', t.vendor1, billOf(drug.po, 'GL-DRUG', 6));
  check('billing what QC released matches', drugInvoice.body.status === 'MATCHED', drugInvoice.body.match);
  const debit = await call('POST', `/invoices/${drugInvoice.body._id}/debit-notes`, t.finance, { taxableAmount: 100, gstAmount: 18, reason: 'Short-dated stock', returnNoteId: returned.body._id });
  check('Finance raises a debit note', debit.status === 201 && debit.body.adjustments[0].type === 'DEBIT' && debit.body.adjustments[0].total === 118, debit.body.adjustments);
  const credit = await call('POST', `/invoices/${drugInvoice.body._id}/credit-notes`, t.finance, { taxableAmount: 50, gstAmount: 9, reason: 'Vendor credit', vendorReference: 'VCN-9' });
  check('Finance records a credit note', credit.status === 201 && credit.body.adjustments[1].type === 'CREDIT', credit.body.adjustments);
  check('notes cannot cover the whole invoice', (await call('POST', `/invoices/${drugInvoice.body._id}/debit-notes`, t.finance, { taxableAmount: 10000, reason: 'Too much' })).status === 422);
  check('a vendor cannot raise a debit note', (await call('POST', `/invoices/${drugInvoice.body._id}/debit-notes`, t.vendor1, { taxableAmount: 1, reason: 'Nope' })).status === 403);
  await call('POST', `/invoices/${drugInvoice.body._id}/book`, t.finance, { glAccount: '5000' });
  const drugTax = await call('POST', `/treasury/invoices/${drugInvoice.body._id}/verify-tax`, t.finance, { tdsSection: '194Q' });
  check('notes reduce the payment and its TDS base', drugTax.status === 200 && drugTax.body.payment.grossAmount === 531 && drugTax.body.payment.adjustmentTotal === 177 && drugTax.body.payment.tdsAmount === 0.45 && drugTax.body.payment.netAmount === 530.55, drugTax.body.payment);
  check('no note after tax verification', (await call('POST', `/invoices/${drugInvoice.body._id}/debit-notes`, t.finance, { taxableAmount: 1, reason: 'Too late' })).status === 422);
  const consumedBefore = (await budget()).consumed;
  await call('POST', `/treasury/payments/${drugTax.body.payment._id}/release`, t.finance, { mode: 'NEFT' });
  check('budget actuals exclude the notes', (await budget()).consumed === consumedBefore + 450);

  // ---- Exception decisions ------------------------------------------------------------------
  const pricey = await acceptedPo('Gauze roll', 'GOODS', 5, 200);
  await call('POST', '/grn', t.store, grnFor(pricey.po, { receivedQty: 5, acceptedQty: 5 }));
  const priceyInvoice = await call('POST', '/invoices', t.vendor1, billOf(pricey.po, 'GL-PRICE', 5, 230));
  check('a price variance is an exception', priceyInvoice.body.status === 'EXCEPTION', priceyInvoice.body.match);
  const priceyListed = ((await call('GET', '/invoices', t.finance)).body as any[]).find((i) => i._id === priceyInvoice.body._id);
  check('an exception shows it is waiting on Finance', priceyListed.pendingAt.role === 'FINANCE' && /Farhan/.test(priceyListed.pendingAt.label), priceyListed.pendingAt);
  check('another role cannot accept an exception', (await call('POST', `/invoices/${priceyInvoice.body._id}/exception-decision`, t.store, { decision: 'ACCEPT', reason: 'Looks fine to me' })).status === 403);
  check('accepting needs a real reason', (await call('POST', `/invoices/${priceyInvoice.body._id}/exception-decision`, t.finance, { decision: 'ACCEPT', reason: 'ok' })).status === 422);
  const accepted = await call('POST', `/invoices/${priceyInvoice.body._id}/exception-decision`, t.finance, { decision: 'ACCEPT', reason: 'Vendor passed on a freight surcharge' });
  check('Finance accepts a price variance and the invoice moves on', accepted.status === 200 && accepted.body.status === 'MATCHED' && accepted.body.exceptionDecision.exceptionTypes.includes('PRICE_VARIANCE'), accepted.body);
  check('an accepted invoice can be booked', (await call('POST', `/invoices/${priceyInvoice.body._id}/book`, t.finance, { glAccount: '5000' })).status === 200);
  // Billing again for goods already received and billed is a real exception, never overridable.
  const syringes = (await acceptedPo('Syringe box', 'GOODS', 2, 100)).po;
  await call('POST', '/grn', t.store, grnFor(syringes, { receivedQty: 2, acceptedQty: 2 }));
  const firstBill = await call('POST', '/invoices', t.finance, billOf(syringes, 'GL-QTY-A', 2));
  await call('POST', `/invoices/${firstBill.body._id}/book`, t.finance, { glAccount: '5000' });
  const qtyException = await call('POST', '/invoices', t.finance, billOf(syringes, 'GL-QTY', 1));
  check('Finance can never accept billing for goods not received', qtyException.body.status === 'EXCEPTION' && qtyException.body.match.exceptions.some((e: any) => e.type === 'QTY_EXCEEDS_RECEIVED') && (await call('POST', `/invoices/${qtyException.body._id}/exception-decision`, t.finance, { decision: 'ACCEPT', reason: 'Please let this one through' })).status === 422, qtyException.body.match);
  const refused = await call('POST', `/invoices/${qtyException.body._id}/exception-decision`, t.finance, { decision: 'REJECT', reason: 'No goods have arrived yet' });
  check('Finance can reject an exception', refused.status === 200 && refused.body.status === 'REJECTED', refused.body);

  // ---- Direct selection: no envelopes, no technical gate --------------------------------------
  const techPr = await approvedPr('MRI contrast', 'BATCH', 10, 1000);
  // A flag left over from the old two-envelope form is ignored: prices are never sealed.
  const techRfq = await publishedRfq('MRI contrast tender', techPr._id, { technicalEvaluation: true });
  check('an RFQ has no two-envelope setting', !/technicalEvaluation|financialsOpened/.test(JSON.stringify(techRfq)), techRfq);
  const cheapBid = await placeBid(techRfq, 'vendor2', 800, 12);
  const dearBid = await placeBid(techRfq, 'vendor1', 900);
  check('a vendor quotes GST: actual + tax = total', cheapBid.body.totalAmount === 8000 && cheapBid.body.taxAmount === 960 && cheapBid.body.grandTotal === 8960, cheapBid.body);
  check('an invalid GST rate is refused on a bid', (await placeBid(techRfq, 'vendor1', 900, 7)).status === 422);
  const liveSheet = (await call('GET', `/sourcing/rfqs/${techRfq._id}/bids`, t.procurement)).body as any[];
  const liveCheap = liveSheet.find((b) => b._id === cheapBid.body._id);
  const liveDear = liveSheet.find((b) => b._id === dearBid.body._id);
  check('Procurement sees every bid and its prices while bidding is still open', liveSheet.length === 2 && liveCheap.totalAmount === 8000 && liveCheap.grandTotal === 8960 && liveCheap.items[0].unitPrice === 800 && liveDear.items[0].unitPrice === 900 && liveCheap.items[0].description === 'MRI contrast', liveSheet);
  check('bids are ranked at once, lowest price first', liveCheap.rank === 1 && liveDear.rank === 2, liveSheet.map((b) => [b.vendor.companyName, b.rank]));
  check('no sealed or technical fields remain on a bid', !/pricesSealed|technicalStatus|technicalRemarks/.test(JSON.stringify(liveSheet)));
  const liveDashboard = ((await call('GET', '/sourcing/dashboard', t.procurement)).body.rfqs as any[]).find((r) => r.rfqId === techRfq._id);
  check('the dashboard shows the lowest quote and ranking while bidding is open', liveDashboard.lowestBid === 8000 && liveDashboard.rankings.length === 2 && liveDashboard.pricesSealed === undefined, liveDashboard);
  check('the technical review endpoint is gone', (await call('PATCH', `/sourcing/bids/${cheapBid.body._id}/technical-review`, t.procurement, { result: 'QUALIFIED' })).status === 404);
  check('the open-financials endpoint is gone', (await call('POST', `/sourcing/rfqs/${techRfq._id}/open-financials`, t.procurement)).status === 404);
  const ownView = (await call('GET', `/sourcing/rfqs/${techRfq._id}/bids`, t.vendor1)).body;
  check('a vendor still sees only their own bid, never a rival price', ownView.bid._id === dearBid.body._id && !JSON.stringify(ownView).includes('8000') && !JSON.stringify(ownView).includes('Infra Supplies'), ownView);
  check('a vendor cannot read the comparison sheet of another vendor', !Array.isArray(ownView));
  check('selecting a non-L1 vendor still needs a written justification', (await call('POST', `/sourcing/rfqs/${techRfq._id}/award`, t.procurement, { bidId: dearBid.body._id })).status === 422);
  const techAward = await call('POST', `/sourcing/rfqs/${techRfq._id}/award`, t.procurement, { bidId: cheapBid.body._id });
  check('Procurement selects a vendor straight from the bid list, while bidding is open', techAward.status === 200 && techAward.body.rfq.status === 'AWARDED' && !!techAward.body.po, techAward.body);
  check('selecting during bidding closes it at once', new Date(techAward.body.rfq.closeAt).getTime() <= Date.now(), techAward.body.rfq.closeAt);
  check('the selected bid keeps its quoted GST on the PO', techAward.body.po.items[0].taxRate === 12, techAward.body.po.items);
  check('no more bids are taken once a vendor is selected', (await placeBid(techRfq, 'vendor1', 850)).status === 422);
  const loserAfter = (await call('GET', `/sourcing/rfqs/${techRfq._id}/bids`, t.vendor1)).body;
  const loserRfq = (await call('GET', `/sourcing/rfqs/${techRfq._id}`, t.vendor1)).body;
  check('a losing vendor never learns of the award', loserRfq.status === 'CLOSED' && loserAfter.bid.status === 'SUBMITTED' && loserAfter.bid.rank === undefined && !/AWARDED|REJECTED|purchaseOrder|Infra/.test(JSON.stringify([loserAfter, loserRfq])), [loserAfter, loserRfq]);

  // ---- Budget re-check at award --------------------------------------------------------------
  const overPr = await approvedPr('Ward monitors', 'GOODS', 1, 10000);
  const overRfq = await publishedRfq('Ward monitors RFQ', overPr._id);
  const overBid = await placeBid(overRfq, 'vendor1', 12000);
  await call('POST', `/sourcing/rfqs/${overRfq._id}/close`, t.procurement);
  const committedBeforeOver = await committedNow();
  const warned = await call('POST', `/sourcing/rfqs/${overRfq._id}/award`, t.procurement, { bidId: overBid.body._id });
  check('a quote above the estimate needs a reason', warned.status === 409 && warned.body.details.code === 'BUDGET_OVERRUN' && warned.body.details.overrun === 2000 && warned.body.details.estimate === 10000, warned.body);
  check('the warning changes nothing', (await committedNow()) === committedBeforeOver && (await call('GET', `/sourcing/rfqs/${overRfq._id}`, t.procurement)).body.status === 'CLOSED');
  const overAward = await call('POST', `/sourcing/rfqs/${overRfq._id}/award`, t.procurement, { bidId: overBid.body._id, overrunReason: 'Only supplier with stock this quarter' });
  check('with a reason the award goes ahead and commits the difference', overAward.status === 200 && (await committedNow()) === committedBeforeOver + 2000, overAward.body);
  await approveAndIssue(overAward.body.po);
  const overRow = ((await call('GET', '/purchase-orders', t.vendor1)).body as any[]).find((p) => p._id === overAward.body.po._id);
  const overOne = (await call('GET', `/purchase-orders/${overAward.body.po._id}`, t.vendor1)).body;
  check('the vendor never sees the budget variance', overRow.budgetVariance === undefined && overOne.budgetVariance === undefined, [overRow.budgetVariance, overOne.budgetVariance]);
  await call('POST', `/purchase-orders/${overAward.body.po._id}/cancel`, t.procurement, { reason: 'Requirement changed' });
  check('cancelling the PO undoes the extra commitment', (await committedNow()) === committedBeforeOver, await committedNow());

  const hugePr = await approvedPr('Linear accelerator part', 'GOODS', 1, 5000);
  const hugeRfq = await publishedRfq('Linear accelerator RFQ', hugePr._id);
  const hugeBid = await placeBid(hugeRfq, 'vendor1', 6_000_000);
  await call('POST', `/sourcing/rfqs/${hugeRfq._id}/close`, t.procurement);
  const exceeded = await call('POST', `/sourcing/rfqs/${hugeRfq._id}/award`, t.procurement, { bidId: hugeBid.body._id, overrunReason: 'Only supplier in the country' });
  check('a quote beyond the remaining budget is refused even with a reason', exceeded.status === 422 && exceeded.body.details.code === 'BUDGET_EXCEEDED' && exceeded.body.details.shortfall > 0, exceeded.body);
  const escalated = await call('POST', `/sourcing/rfqs/${hugeRfq._id}/budget-escalation`, t.procurement, { bidId: hugeBid.body._id, reason: 'Critical replacement part for radiotherapy' });
  check('Procurement escalates to Finance', escalated.status === 201 && escalated.body.budgetEscalation.status === 'PENDING', escalated.body);
  check('an escalation is raised once', (await call('POST', `/sourcing/rfqs/${hugeRfq._id}/budget-escalation`, t.procurement, { bidId: hugeBid.body._id, reason: 'Critical replacement part again' })).status === 409);
  check('it reaches the Finance queue', ((await call('GET', '/treasury/queue', t.finance)).body.escalations as any[]).some((r) => r._id === hugeRfq._id));
  check('Procurement cannot approve its own escalation', (await call('POST', `/sourcing/rfqs/${hugeRfq._id}/budget-escalation/decision`, t.procurement, { decision: 'APPROVE' })).status === 403);
  const allocatedBefore = (await budget()).allocated;
  const budgetRace = await Promise.all([1, 2, 3].map(() => call('POST', `/sourcing/rfqs/${hugeRfq._id}/budget-escalation/decision`, t.finance, { decision: 'APPROVE' })));
  check('simultaneous escalation approvals raise the budget once', budgetRace.filter((r) => r.status === 200).length === 1 && (await budget()).allocated === allocatedBefore + exceeded.body.details.shortfall, budgetRace.map((r) => r.status));
  const hugeAward = await call('POST', `/sourcing/rfqs/${hugeRfq._id}/award`, t.procurement, { bidId: hugeBid.body._id, overrunReason: 'Only supplier in the country' });
  check('after approval the award fits and goes ahead', hugeAward.status === 200 && (await budget()).allocated === (await budget()).committed, [hugeAward.body.message, await budget()]);
  await call('POST', `/purchase-orders/${hugeAward.body.po._id}/cancel`, t.procurement, { reason: 'Test finished' });

  // ---- Vendor licences -----------------------------------------------------------------------
  const licPr = await approvedPr('Narcotic analgesic', 'BATCH', 1, 1000);
  const licRfq = await publishedRfq('Narcotic analgesic RFQ', licPr._id, { requiredLicences: ['DRUG_LICENCE'] });
  const noLicence = await placeBid(licRfq, 'vendor1', 900);
  check('a required licence blocks the bid', noLicence.status === 403 && /Action locked/.test(noLicence.body.message), noLicence.body);
  check('an already expired document is refused', (await call('POST', '/vendors/me/documents', t.vendor1, { type: 'DRUG_LICENCE', number: 'DL-1', expiryDate: days(-1) })).status === 422);
  check('a vendor cannot pick an unknown licence type', (await call('POST', '/vendors/me/documents', t.vendor1, { type: 'NOPE', number: 'DL-1', expiryDate: days(10) })).status === 422);
  const uploaded = await call('POST', '/vendors/me/documents', t.vendor1, { type: 'DRUG_LICENCE', number: 'DL-1', issuedBy: 'State FDA', expiryDate: days(300) });
  check('a vendor adds a licence, pending verification', uploaded.status === 201 && uploaded.body.documents[0].status === 'PENDING', uploaded.body);
  check('an unverified licence does not unlock the bid', (await placeBid(licRfq, 'vendor1', 900)).status === 403);
  const licenceId = uploaded.body.documents[0]._id;
  const vendorIdOne = uploaded.body._id;
  check('a vendor cannot verify their own licence', (await call('POST', `/vendors/${vendorIdOne}/documents/${licenceId}/verify`, t.vendor1, { decision: 'VERIFIED' })).status === 403);
  check('rejecting a licence needs a reason', (await call('POST', `/vendors/${vendorIdOne}/documents/${licenceId}/verify`, t.procurement, { decision: 'REJECTED' })).status === 422);
  check('Procurement verifies the licence', (await call('POST', `/vendors/${vendorIdOne}/documents/${licenceId}/verify`, t.procurement, { decision: 'VERIFIED' })).status === 200);
  check('verification happens once', (await call('POST', `/vendors/${vendorIdOne}/documents/${licenceId}/verify`, t.procurement, { decision: 'VERIFIED' })).status === 422);
  const licBid = await placeBid(licRfq, 'vendor1', 900);
  check('a verified, current licence unlocks the bid', licBid.status === 201, licBid.body);
  await call('POST', `/sourcing/rfqs/${licRfq._id}/close`, t.procurement);
  const setLicenceExpiry = (when: string) =>
    mongoose.connection.collection('vendors').updateOne({ _id: new mongoose.Types.ObjectId(vendorIdOne), 'documents._id': new mongoose.Types.ObjectId(licenceId) }, { $set: { 'documents.$.expiryDate': new Date(when) } });
  await setLicenceExpiry(days(-1));
  const lapsedAward = await call('POST', `/sourcing/rfqs/${licRfq._id}/award`, t.procurement, { bidId: licBid.body._id });
  check('a licence that lapsed after bidding blocks the award', lapsedAward.status === 422 && /expired/.test(lapsedAward.body.message), lapsedAward.body);
  const anyRfq = await publishedRfq('Any supplier RFQ', (await approvedPr('Bandage', 'GOODS', 1, 100))._id);
  check('any expired licence on file blocks bidding, required or not', (await placeBid(anyRfq, 'vendor1', 90)).status === 403);
  const renewed = await call('POST', '/vendors/me/documents', t.vendor1, { type: 'DRUG_LICENCE', number: 'DL-2', expiryDate: days(400) });
  check('a renewal lifts the expiry block', renewed.status === 201 && (await placeBid(anyRfq, 'vendor1', 90)).status === 201, renewed.body);
  await setLicenceExpiry(days(300));

  // ---- Services and commissioning ----------------------------------------------------------------
  const amc = await acceptedPo('Autoclave service visit', 'SERVICE', 2, 1000);
  check('a service line cannot be goods-received', /service/.test((await call('POST', '/grn', t.store, grnFor(amc.po, { receivedQty: 2, acceptedQty: 2 }))).body.message));
  const svcEarly = await call('POST', '/invoices', t.vendor1, billOf(amc.po, 'GL-SVC0', 1));
  check('a service can be invoiced before sign-off; the match waits', svcEarly.status === 201 && svcEarly.body.status === 'SUBMITTED' && svcEarly.body.match.status === 'PENDING', svcEarly.body);
  await call('POST', `/invoices/${svcEarly.body._id}/reject`, t.finance, { reason: 'Test of an early invoice' });
  const entry = await call('POST', '/service-entries', t.requester, { purchaseOrderId: amc.po._id, poItemId: amc.po.items[0]._id, quantity: 1, completedOn: new Date().toISOString(), remarks: 'First visit done' });
  check('the department records the service', entry.status === 201 && entry.body.type === 'SERVICE' && entry.body.status === 'PENDING', entry.body);
  check('it cannot be signed off beyond what was ordered', (await call('POST', '/service-entries', t.requester, { purchaseOrderId: amc.po._id, poItemId: amc.po.items[0]._id, quantity: 2, completedOn: new Date().toISOString() })).status === 422);
  check('another department HOD cannot accept', (await call('POST', `/service-entries/${entry.body._id}/accept`, t['hod.ops'], {})).status === 403);
  const svcWaiting = await call('POST', '/invoices', t.vendor1, billOf(amc.po, 'GL-SVC1', 1));
  check('a pending sign-off keeps the invoice waiting', svcWaiting.status === 201 && svcWaiting.body.match.status === 'PENDING', svcWaiting.body);
  check('the HOD accepts', (await call('POST', `/service-entries/${entry.body._id}/accept`, t['hod.it'], {})).status === 200);
  check('accepting the sign-off matches the waiting invoice by itself', (await call('GET', `/invoices/${svcWaiting.body._id}`, t.finance)).body.status === 'MATCHED');
  check('it can be accepted once', (await call('POST', `/service-entries/${entry.body._id}/accept`, t['hod.it'], {})).status === 422);
  check('accepted service is billable', (await call('POST', '/invoices', t.vendor1, billOf(amc.po, 'GL-SVC2', 1))).body.status === 'MATCHED');
  check('accepted service counts as received', (await call('GET', `/purchase-orders/${amc.po._id}`, t.procurement)).body.status === 'PARTIALLY_RECEIVED');
  const rejectedEntry = await call('POST', '/service-entries', t['hod.it'], { purchaseOrderId: amc.po._id, poItemId: amc.po.items[0]._id, quantity: 1, completedOn: new Date().toISOString() });
  check('whoever raised a sign-off cannot accept it', (await call('POST', `/service-entries/${rejectedEntry.body._id}/accept`, t['hod.it'], {})).status === 403);

  const scanner = await acceptedPo('Ultrasound scanner', 'EQUIPMENT', 1, 2000);
  check('commissioning waits for delivery', (await call('POST', '/service-entries', t.store, { purchaseOrderId: scanner.po._id, poItemId: scanner.po.items[0]._id, quantity: 1, completedOn: new Date().toISOString() })).status === 422);
  await call('POST', '/grn', t.store, grnFor(scanner.po, { receivedQty: 1, acceptedQty: 1, serialNumbers: ['US-1'] }));
  const eqEarly = await call('POST', '/invoices', t.vendor1, billOf(scanner.po, 'GL-EQ1', 1));
  check('equipment invoiced before commissioning waits', eqEarly.status === 201 && eqEarly.body.match.status === 'PENDING', eqEarly.body);
  await call('POST', `/invoices/${eqEarly.body._id}/reject`, t.finance, { reason: 'Test of an early invoice' });
  const commissioning = await call('POST', '/service-entries', t.store, { purchaseOrderId: scanner.po._id, poItemId: scanner.po.items[0]._id, quantity: 1, completedOn: new Date().toISOString(), remarks: 'Installed and calibrated' });
  check('commissioning is recorded', commissioning.status === 201 && commissioning.body.type === 'COMMISSIONING', commissioning.body);
  await call('POST', `/service-entries/${commissioning.body._id}/accept`, t['hod.it'], {});
  check('commissioned equipment is billable', (await call('POST', '/invoices', t.vendor1, billOf(scanner.po, 'GL-EQ2', 1))).body.status === 'MATCHED');

  // ---- PR and payment approval chains --------------------------------------------------------
  const bigPr = await raisePr('Operating table', 'EQUIPMENT', 1, 1_200_000);
  check('a high-value PR gets the rule chain', (await call('GET', `/requisitions/${bigPr._id}`, t['hod.it'])).body.approvals.map((a: any) => a.role).join() === 'HOD,FINANCE');
  check('Finance cannot approve ahead of the HOD', /pending at HOD/.test((await call('POST', `/requisitions/${bigPr._id}/approve`, t.finance, {})).body.message));
  const committedBeforePr = await committedNow();
  const hodStep = await call('POST', `/requisitions/${bigPr._id}/approve`, t['hod.it'], {});
  check('the HOD step leaves the PR pending, with no budget locked', hodStep.body.status === 'SUBMITTED' && (await committedNow()) === committedBeforePr, hodStep.body);
  const bigListed = ((await call('GET', '/requisitions', t.requester)).body as any[]).find((p) => p._id === bigPr._id);
  check('the requester can see it is pending at Finance, by name', bigListed.pendingAt.role === 'FINANCE' && /Farhan/.test(bigListed.pendingAt.label), bigListed.pendingAt);
  const prRace = await Promise.all([1, 2].map(() => call('POST', `/requisitions/${bigPr._id}/approve`, t.finance, {})));
  check('the final step locks the budget exactly once', prRace.filter((r) => r.status === 200).length === 1 && (await committedNow()) === committedBeforePr + 1_200_000, prRace.map((r) => r.status));
  await call('POST', `/requisitions/${bigPr._id}/cancel`, t['hod.it'], { reason: 'Test finished' });

  const pricedPo = await acceptedPo('CT scanner tube', 'GOODS', 1, 1_100_000);
  await call('POST', '/grn', t.store, grnFor(pricedPo.po, { receivedQty: 1, acceptedQty: 1 }));
  const bigInvoice = await call('POST', '/invoices', t.vendor1, billOf(pricedPo.po, 'GL-BIG', 1));
  await call('POST', `/invoices/${bigInvoice.body._id}/book`, t.finance, { glAccount: '5000' });
  const bigTax = await call('POST', `/treasury/invoices/${bigInvoice.body._id}/verify-tax`, t.finance, { tdsSection: '194Q' });
  check('a high-value payment waits for its chain', bigTax.body.payment.status === 'PENDING_APPROVAL' && bigTax.body.payment.approvals.map((a: any) => a.role).join() === 'HOD,ADMIN', bigTax.body.payment);
  const bigPayId = bigTax.body.payment._id;
  check('it cannot be released before approval', (await call('POST', `/treasury/payments/${bigPayId}/release`, t.finance, { mode: 'RTGS' })).status === 422);
  check('another department HOD cannot approve it', (await call('POST', `/treasury/payments/${bigPayId}/approve`, t['hod.ops'], {})).status === 403);
  check('it is in the right HOD queue only', ((await call('GET', '/treasury/payments/my-approvals', t['hod.it'])).body as any[]).some((p) => p._id === bigPayId) && !((await call('GET', '/treasury/payments/my-approvals', t['hod.ops'])).body as any[]).some((p) => p._id === bigPayId));
  check('the HOD can reject it, into the failed queue', (await call('POST', `/treasury/payments/${bigPayId}/reject`, t['hod.it'], { remarks: 'Check the invoice' })).body.status === 'FAILED');
  check('a retry restarts the chain rather than paying', (await call('POST', `/treasury/payments/${bigPayId}/retry`, t.finance, { mode: 'RTGS' })).body.status === 'PENDING_APPROVAL');
  check('the HOD approves level 1', (await call('POST', `/treasury/payments/${bigPayId}/approve`, t['hod.it'], {})).body.status === 'PENDING_APPROVAL');
  check('the same person cannot approve twice', (await call('POST', `/treasury/payments/${bigPayId}/approve`, t['hod.it'], {})).status === 403);
  check('Admin approves the final level', (await call('POST', `/treasury/payments/${bigPayId}/approve`, t.admin, {})).body.status === 'PENDING_RELEASE');
  const invalidChain = await call('POST', '/admin/doa-rules', t.admin, { name: 'Bad chain', documentType: 'PAYMENT', minAmount: 0, levels: [{ level: 1, role: 'TREASURY' }] });
  check('a payment chain that would deadlock is refused', invalidChain.status === 422, invalidChain.body);

  // ---- Emergency purchases --------------------------------------------------------------------
  check('an emergency PR needs a reason', (await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Blood bags', priority: 'CRITICAL', isEmergency: true, items: [{ description: 'Blood bags', quantity: 1, uom: 'EA', estimatedUnitPrice: 10 }] })).status === 422);
  const emergencyPr = await raisePr('Blood bags', 'BATCH', 10, 500, { isEmergency: true, emergencyReason: 'Mass casualty event, stock out in the ER' });
  const emergencyItem = emergencyPr.items[0]._id;
  const emergencyBody = { requisitionId: emergencyPr._id, vendorId: vendorIdOne, prices: { [emergencyItem]: 480 }, justification: 'Mass casualty event, nearest stockist' };
  check('the emergency route needs HOD approval first', (await call('POST', '/sourcing/emergency-purchases', t.procurement, emergencyBody)).status === 422);
  const emergencyHod = await call('POST', `/requisitions/${emergencyPr._id}/approve`, t['hod.it'], {});
  check('the HOD alone approves an emergency PR', emergencyHod.body.status === 'APPROVED' && emergencyHod.body.approvals.length === 1, emergencyHod.body);
  check('the emergency route has a value cap', /capped/.test((await call('POST', '/sourcing/emergency-purchases', t.procurement, { ...emergencyBody, prices: { [emergencyItem]: 20000 } })).body.message));
  check('every line needs a price', (await call('POST', '/sourcing/emergency-purchases', t.procurement, { ...emergencyBody, prices: {} })).status === 422);
  check('a vendor cannot use the emergency route', (await call('POST', '/sourcing/emergency-purchases', t.vendor1, emergencyBody)).status === 403);
  const emergencyRace = await Promise.all([1, 2].map(() => call('POST', '/sourcing/emergency-purchases', t.procurement, emergencyBody)));
  const emergencyWin = emergencyRace.find((r) => r.status === 201);
  check('an emergency PR is bought once', emergencyRace.filter((r) => r.status === 201).length === 1 && !!emergencyWin, emergencyRace.map((r) => [r.status, r.body.message]));
  const ePo = emergencyWin!.body.po;
  check('the emergency PO skips prior approval and is issued at once', ePo.status === 'ISSUED' && !!ePo.issuedAt && ePo.isEmergency && ePo.approvals.length === 0, ePo);
  check('it is a normal awarded RFQ for the chosen vendor', ((await call('GET', '/sourcing/rfqs?status=AWARDED', t.vendor1)).body as any[]).some((r) => r._id === emergencyWin!.body.rfq._id));
  check('no other vendor sees it', !((await call('GET', '/sourcing/rfqs', t.vendor2)).body as any[]).some((r) => r._id === emergencyWin!.body.rfq._id));
  await call('POST', '/grn', t.store, grnFor(ePo, { receivedQty: 10, acceptedQty: 10, batchNumber: 'BB-1', expiryDate: days(200) }));
  const eInvoice = await call('POST', '/invoices', t.vendor1, billOf(ePo, 'GL-E1', 10));
  await call('POST', `/invoices/${eInvoice.body._id}/book`, t.finance, { glAccount: '5000' });
  const unratified = await call('POST', `/treasury/invoices/${eInvoice.body._id}/verify-tax`, t.finance, { tdsSection: '194Q' });
  check('an unratified emergency purchase cannot be paid', unratified.status === 422 && /ratify/.test(unratified.body.message), unratified.body);
  check('it waits in the Finance queue', ((await call('GET', '/treasury/queue', t.finance)).body.ratifications as any[]).some((p) => p._id === emergencyPr._id));
  check('only Finance ratifies', (await call('POST', `/requisitions/${emergencyPr._id}/ratify`, t.procurement, { decision: 'RATIFY' })).status === 403);
  check('refusing needs a reason', (await call('POST', `/requisitions/${emergencyPr._id}/ratify`, t.finance, { decision: 'REJECT' })).status === 422);
  check('Finance ratifies', (await call('POST', `/requisitions/${emergencyPr._id}/ratify`, t.finance, { decision: 'RATIFY', remarks: 'Confirmed with the ER' })).body.ratification.status === 'RATIFIED');
  check('ratification happens once', (await call('POST', `/requisitions/${emergencyPr._id}/ratify`, t.finance, { decision: 'RATIFY' })).status === 422);
  const eTax = await call('POST', `/treasury/invoices/${eInvoice.body._id}/verify-tax`, t.finance, { tdsSection: '194Q' });
  check('once ratified it can be paid', eTax.status === 200, eTax.body);

  // ---- Bank integration, against a mock bank ---------------------------------------------------
  type Mode = 'accept' | 'success' | 'refuse' | 'down' | 'hang';
  let bankMode: Mode = 'accept';
  const bankCalls: { reference: string; key?: string; amount: number; auth?: string }[] = [];
  const bankOutcome: Record<string, object> = {};
  const bank = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status: number, body: object) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET') {
        const outcome = bankOutcome[req.url!.split('/').pop()!];
        return send(outcome ? 200 : 404, outcome ?? {});
      }
      const payout = JSON.parse(raw);
      bankCalls.push({ reference: payout.reference, key: req.headers['idempotency-key'] as string, amount: payout.amount, auth: req.headers.authorization });
      if (bankMode === 'down') return send(503, { message: 'Maintenance' });
      if (bankMode === 'hang') return;
      if (bankMode === 'refuse') return send(400, { message: 'Beneficiary account is closed' });
      if (bankMode === 'success') return send(200, { status: 'SUCCESS', utr: `UTR${payout.reference}` });
      return send(202, { status: 'ACCEPTED', id: payout.reference });
    });
  });
  await new Promise<void>((resolve) => bank.listen(0, resolve));
  env.bankApiUrl = `http://127.0.0.1:${(bank.address() as AddressInfo).port}`;
  env.bankApiKey = 'test-key';
  env.bankWebhookSecret = 'test-webhook-secret';
  env.bankTimeoutMs = 400;
  const webhook = async (body: object, secret = 'test-webhook-secret') => {
    const raw = JSON.stringify(body);
    const res = await fetch(`${base}/treasury/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bank-Signature': createHmac('sha256', secret).update(raw).digest('hex') },
      body: raw,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const paymentOf = async (id: string) => ((await call('GET', '/treasury/payments', t.finance)).body as any[]).find((p) => p._id === id);
  /** A payment staged for release: the invoice is booked and verified. */
  const stagedPayment = async (title: string) => {
    const { po: bankPo } = await acceptedPo(title, 'GOODS', 1, 1000);
    await call('POST', '/grn', t.store, grnFor(bankPo, { receivedQty: 1, acceptedQty: 1 }));
    const inv = await call('POST', '/invoices', t.vendor1, billOf(bankPo, `GL-${title.replace(/\s/g, '')}`, 1));
    await call('POST', `/invoices/${inv.body._id}/book`, t.finance, { glAccount: '5000' });
    const taxed = await call('POST', `/treasury/invoices/${inv.body._id}/verify-tax`, t.finance, { tdsSection: '194Q' });
    return { payment: taxed.body.payment, invoiceId: inv.body._id, po: bankPo };
  };
  const invoiceStatus = async (id: string) => (await call('GET', `/invoices/${id}`, t.finance)).body.status;

  const pay1 = await stagedPayment('Bank test one');
  const consumedBank = (await budget()).consumed;
  const raceRelease = await Promise.all([1, 2, 3].map(() => call('POST', `/treasury/payments/${pay1.payment._id}/release`, t.finance, { mode: 'NEFT' })));
  check('simultaneous releases reach the bank once', bankCalls.length === 1 && raceRelease.filter((r) => r.status === 202).length === 1, [bankCalls.length, raceRelease.map((r) => r.status)]);
  check('the bank call is authenticated, with an idempotency key', bankCalls[0]?.auth === 'Bearer test-key' && bankCalls[0]?.key === bankCalls[0]?.reference && bankCalls[0]?.amount === pay1.payment.netAmount, bankCalls[0]);
  const inFlight = await paymentOf(pay1.payment._id);
  check('an accepted transfer is processing, not paid', inFlight.status === 'PROCESSING' && !inFlight.utr && (await invoiceStatus(pay1.invoiceId)) === 'TAX_VERIFIED', inFlight);
  check('no budget moves until the bank confirms', (await budget()).consumed === consumedBank);
  check('a wrong webhook signature is refused', (await webhook({ reference: inFlight.bankReference, status: 'SUCCESS', utr: 'FAKE' }, 'wrong-secret')).status === 401);
  check('an unsigned webhook is refused', (await call('POST', '/treasury/payments/webhook', undefined, { reference: inFlight.bankReference, status: 'SUCCESS', utr: 'FAKE' })).status === 401);
  check('a tampered status is still unpaid', (await paymentOf(pay1.payment._id)).status === 'PROCESSING');
  check('a webhook with the wrong amount is refused', (await webhook({ reference: inFlight.bankReference, status: 'SUCCESS', amount: 1 })).status === 422);
  const good = await webhook({ reference: inFlight.bankReference, status: 'SUCCESS', utr: 'UTR-REAL-1', amount: pay1.payment.netAmount });
  check('a signed webhook settles the payment', good.status === 200 && good.body.applied, good.body);
  const settled = await paymentOf(pay1.payment._id);
  check('the UTR is recorded and it is not marked simulated', settled.status === 'RELEASED' && settled.utr === 'UTR-REAL-1' && !settled.simulated, settled);
  check('the invoice is paid and the budget moves', (await invoiceStatus(pay1.invoiceId)) === 'PAID' && (await budget()).consumed === consumedBank + 1000);
  const replay = await webhook({ reference: inFlight.bankReference, status: 'SUCCESS', utr: 'UTR-REAL-1' });
  check('a repeated webhook changes nothing', replay.status === 200 && !replay.body.applied && (await budget()).consumed === consumedBank + 1000, replay.body);
  const lateFail = await webhook({ reference: inFlight.bankReference, status: 'FAILED', failureReason: 'Too late' });
  check('a failure after success changes nothing', !lateFail.body.applied && (await paymentOf(pay1.payment._id)).status === 'RELEASED');
  check('an unknown reference is ignored without an error', (await webhook({ reference: 'NOPE-1', status: 'SUCCESS' })).body.applied === false);

  const pay2 = await stagedPayment('Bank test two');
  const callsBefore = bankCalls.length;
  await call('POST', `/treasury/payments/${pay2.payment._id}/release`, t.finance, { mode: 'NEFT' });
  const firstReference = (await paymentOf(pay2.payment._id)).bankReference;
  await webhook({ reference: firstReference, status: 'FAILED', failureReason: 'Account closed' });
  const failedPayment = await paymentOf(pay2.payment._id);
  check('a reported failure goes to the failed queue, unpaid', failedPayment.status === 'FAILED' && failedPayment.failureReason === 'Account closed' && (await invoiceStatus(pay2.invoiceId)) === 'TAX_VERIFIED', failedPayment);
  check('it shows in the queue', ((await call('GET', '/treasury/queue', t.finance)).body.failed as any[]).some((p) => p._id === pay2.payment._id));
  check('release cannot be used on a failed payment', (await call('POST', `/treasury/payments/${pay2.payment._id}/release`, t.finance, { mode: 'NEFT' })).status === 422);
  await call('PATCH', '/vendors/me', t.vendor1, { bankDetails: { accountName: 'TechNova Systems Pvt Ltd', accountNumber: '111122223333', ifsc: 'HDFC0000999', bankName: 'HDFC Bank' } });
  const retried = await call('POST', `/treasury/payments/${pay2.payment._id}/retry`, t.finance, { mode: 'IMPS' });
  const afterRetry = await paymentOf(pay2.payment._id);
  check('a retry uses a new reference and the corrected account', retried.status === 202 && afterRetry.bankReference !== firstReference && afterRetry.beneficiary.accountNumber === '111122223333' && bankCalls.length === callsBefore + 2, [afterRetry, bankCalls.length]);
  const stale = await webhook({ reference: firstReference, status: 'SUCCESS', utr: 'OLD' });
  check('a report for an earlier attempt is not applied', stale.body.applied === false && (await paymentOf(pay2.payment._id)).status === 'PROCESSING', stale.body);
  await webhook({ reference: afterRetry.bankReference, status: 'SUCCESS', utr: 'UTR-2' });
  check('the retry can settle', (await invoiceStatus(pay2.invoiceId)) === 'PAID');

  const pay3 = await stagedPayment('Bank test three');
  bankMode = 'refuse';
  const refusedRelease = await call('POST', `/treasury/payments/${pay3.payment._id}/release`, t.finance, { mode: 'NEFT' });
  check('a refusal is reported at once and queued', refusedRelease.status === 422 && /account is closed/.test(refusedRelease.body.message) && (await paymentOf(pay3.payment._id)).status === 'FAILED', refusedRelease.body);
  bankMode = 'down';
  const unknownOutcome = await call('POST', `/treasury/payments/${pay3.payment._id}/retry`, t.finance, { mode: 'NEFT' });
  const stillOpen = await paymentOf(pay3.payment._id);
  check('a bank outage leaves the outcome unknown, not failed', unknownOutcome.status === 202 && stillOpen.status === 'PROCESSING', stillOpen);
  check('an unknown outcome cannot be retried, which could pay twice', (await call('POST', `/treasury/payments/${pay3.payment._id}/retry`, t.finance, { mode: 'NEFT' })).status === 422);
  check('a status check with no answer changes nothing', (await call('POST', `/treasury/payments/${pay3.payment._id}/check-status`, t.finance)).status === 503 && (await paymentOf(pay3.payment._id)).status === 'PROCESSING');
  bankOutcome[stillOpen.bankReference] = { status: 'SUCCESS', utr: 'UTR-CHECKED' };
  const checked = await call('POST', `/treasury/payments/${pay3.payment._id}/check-status`, t.finance);
  check('a status check settles it', checked.status === 200 && checked.body.utr === 'UTR-CHECKED' && (await invoiceStatus(pay3.invoiceId)) === 'PAID', checked.body);

  bankMode = 'accept';
  const pay4 = await stagedPayment('Bank test four');
  bankMode = 'hang';
  const hung = await call('POST', `/treasury/payments/${pay4.payment._id}/release`, t.finance, { mode: 'NEFT' });
  check('a bank timeout also leaves the outcome unknown', hung.status === 202 && (await paymentOf(pay4.payment._id)).status === 'PROCESSING', hung.body);
  bankMode = 'success';
  const pay5 = await stagedPayment('Bank test five');
  const instant = await call('POST', `/treasury/payments/${pay5.payment._id}/release`, t.finance, { mode: 'NEFT' });
  check('an instant success settles at once', instant.status === 200 && instant.body.status === 'RELEASED' && !instant.body.simulated, instant.body);
  env.bankWebhookSecret = undefined;
  check('the webhook is shut without a configured secret', (await webhook({ reference: 'X', status: 'SUCCESS' })).status === 401);

  // Back to no bank: simulated outside production, refused in production.
  bank.closeAllConnections();
  bank.close();
  env.bankApiUrl = undefined;
  const pay6 = await stagedPayment('Bank test six');
  env.isProduction = true;
  const prodNoBank = await call('POST', `/treasury/payments/${pay6.payment._id}/release`, t.finance, { mode: 'NEFT' });
  env.isProduction = false;
  check('production refuses to release with no bank configured', prodNoBank.status === 503 && (await paymentOf(pay6.payment._id)).status === 'PENDING_RELEASE', prodNoBank.body);
  const simulated = await call('POST', `/treasury/payments/${pay6.payment._id}/release`, t.finance, { mode: 'NEFT' });
  check('outside production a transfer is marked simulated', simulated.body.simulated === true && simulated.body.utr.startsWith('SIM-'), simulated.body);

  // ---- Journey path and workflow locks ---------------------------------------------------------
  const journeyFor = async (who: string) => (await call('GET', '/journey', t[who])).body;
  check('no journey without a session', (await call('GET', '/journey')).status === 401);
  const lockPr = await raisePr('Journey PR', 'GOODS', 1, 100);
  const requesterJourney = await journeyFor('requester');
  const lockTrack = requesterJourney.tracks.find((tr: any) => tr.reference === lockPr.prNumber);
  check('the requester sees the approval pending at their HOD, by name', lockTrack?.pendingAt?.role === 'HOD' && /Harish/.test(lockTrack.message) && !lockTrack.yourAction, lockTrack);
  check('steps after the current one are locked', lockTrack?.steps.find((s: any) => s.label === 'HOD approval').state === 'current' && lockTrack?.steps.find((s: any) => s.label === 'Vendor selected').state === 'locked', lockTrack?.steps);
  const hodJourney = await journeyFor('hod.it');
  check('the HOD sees the same PR as their action, first', hodJourney.tracks[0].yourAction && hodJourney.yourActions >= 1 && hodJourney.tracks.some((tr: any) => tr.reference === lockPr.prNumber && tr.yourAction), hodJourney.tracks[0]);
  check('another department HOD does not see it', !(await journeyFor('hod.ops')).tracks.some((tr: any) => tr.reference === lockPr.prNumber));
  check('Store sees no requisitions', !(await journeyFor('store')).tracks.some((tr: any) => tr.reference === lockPr.prNumber));
  const storePo = await acceptedPo('Journey Store', 'GOODS', 1, 10);
  const storeBeforeInvoice = (await journeyFor('store')).tracks.find((tr: any) => tr.reference === storePo.po.poNumber);
  check('before the vendor invoice, the Store waits for it', !!storeBeforeInvoice && !storeBeforeInvoice.yourAction && storeBeforeInvoice.steps.find((s: any) => s.state === 'current')?.label === 'Invoice', storeBeforeInvoice);
  const storeInvoice = await call('POST', '/invoices', t.vendor1, billOf(storePo.po, 'J-STORE-1', 1));
  const storeTrack = (await journeyFor('store')).tracks.find((tr: any) => tr.reference === storePo.po.poNumber);
  check('Store sees receipt and inspection as their action', storeTrack?.yourAction && storeTrack.steps.some((s: any) => s.label === 'Goods receipt & inspection' && s.state === 'current') && !storeTrack.steps.some((s: any) => s.label === 'Quality inspection'), storeTrack);
  await call('POST', '/grn', t.store, grnFor(storePo.po, { receivedQty: 1, acceptedQty: 1 }));
  const financeTrack = (await journeyFor('finance')).tracks.find((tr: any) => tr.reference === storePo.po.poNumber);
  check('after the GRN the waiting invoice is matched, and it is with Finance', financeTrack?.pendingAt?.role === 'FINANCE' && (await call('GET', `/invoices/${storeInvoice.body._id}`, t.finance)).body.status === 'MATCHED', financeTrack?.pendingAt);

  const jPr = await approvedPr('Journey privacy', 'GOODS', 1, 1000);
  const jRfq = await publishedRfq('Journey privacy RFQ', jPr._id);
  const jWin = await placeBid(jRfq, 'vendor1', 1000);
  await placeBid(jRfq, 'vendor2', 1100);
  const openJourney = (await journeyFor('vendor2')).tracks.find((tr: any) => tr.reference === jRfq.rfqNumber);
  check('an open RFQ tells the vendor they can still revise', /Bidding is open/.test(openJourney?.message), openJourney);
  await call('POST', `/sourcing/rfqs/${jRfq._id}/close`, t.procurement);
  const loserTrack = async () => (await journeyFor('vendor2')).tracks.find((tr: any) => tr.reference === jRfq.rfqNumber);
  const loserJourneyBefore = await loserTrack();
  const jAward = await call('POST', `/sourcing/rfqs/${jRfq._id}/award`, t.procurement, { bidId: jWin.body._id });
  check('a losing vendor journey is identical across the award', JSON.stringify(await loserTrack()) === JSON.stringify(loserJourneyBefore), [loserJourneyBefore, await loserTrack()]);
  check('a losing vendor journey never mentions selection', !/Selected|Awarded|PO /.test(JSON.stringify(loserJourneyBefore)), loserJourneyBefore);
  const winnerTrack = (await journeyFor('vendor1')).tracks.find((tr: any) => tr.reference === jAward.body.po.poNumber);
  check('the winner sees they were selected and the PO received at once, with no staff names', winnerTrack?.steps.some((s: any) => s.label === 'Selected by the buyer' && s.state === 'done') && winnerTrack?.steps.some((s: any) => s.label === 'PO received' && s.state === 'done') && winnerTrack?.pendingAt.userName === undefined, winnerTrack);
  await approveAndIssue(jAward.body.po);
  const issuedTrack = (await journeyFor('vendor1')).tracks.find((tr: any) => tr.reference === jAward.body.po.poNumber);
  check('once issued the vendor invoices first, with no acknowledgement step', issuedTrack?.yourAction && issuedTrack.actionLabel === 'Submit invoice' && !issuedTrack.steps.some((s: any) => /cknowledge/.test(s.label)), issuedTrack);
  const vendorJourneyText = JSON.stringify(await journeyFor('vendor1'));
  check('a vendor journey carries no internal names', !/Farhan|Priya|Harish|Sunil/.test(vendorJourneyText), vendorJourneyText.slice(0, 200));
  const vendorPoRow = ((await call('GET', '/purchase-orders', t.vendor1)).body as any[]).find((p) => p._id === jAward.body.po._id);
  check('a vendor PO row carries no internal names', vendorPoRow.pendingAt.label === 'Store' && !vendorPoRow.pendingAt.userName, vendorPoRow.pendingAt);
  const lockPo = await acceptedPo('Lock PO', 'GOODS', 1, 50000);
  const internalPoRow = ((await call('GET', '/purchase-orders', t.finance)).body as any[]).find((p) => p._id === lockPo.po._id);
  check('an internal PO row says who it waits on, by name', internalPoRow.pendingAt.role === 'STORE' && /Sunil/.test(internalPoRow.pendingAt.label), internalPoRow.pendingAt);
  check('a vendor PO row does not expose who created it', vendorPoRow.createdBy === undefined, vendorPoRow.createdBy);
  check('rich PO labels have what they need', internalPoRow.vendor.contactPerson === 'Vikram Shah' && !!internalPoRow.vendor.companyName && internalPoRow.items[0].description === 'Lock PO' && !!internalPoRow.createdAt, internalPoRow.vendor);

  // ---- PR department, item types, catalog and messages -----------------------------------------
  const noDept = await call('POST', '/requisitions', t.requester, { title: 'No department', priority: 'LOW', items: [{ description: 'Pens', quantity: 1, uom: 'EA', estimatedUnitPrice: 10 }] });
  check('a PR needs a department', noDept.status === 422 && JSON.stringify(noDept.body).includes('department'), noDept.body);
  const opsId = options.departments.find((d: { code: string }) => d.code === 'OPS')._id;
  const opsPr = (await call('POST', '/requisitions', t.requester, { department: opsId, title: 'Ops chairs', priority: 'LOW', items: [{ description: 'Chair', quantity: 2, uom: 'EA', estimatedUnitPrice: 500 }] })).body;
  check('the chosen department is kept on the PR', opsPr.department === opsId, opsPr.department);
  await call('POST', `/requisitions/${opsPr._id}/submit`, t.requester);
  check('it routes to that department HOD, not the requester HOD', (await call('POST', `/requisitions/${opsPr._id}/approve`, t['hod.it'], {})).status === 404 && (await call('POST', `/requisitions/${opsPr._id}/approve`, t['hod.ops'], {})).body.status === 'APPROVED');
  check('an unknown department is refused', (await call('POST', '/requisitions', t.requester, { department: '0123456789abcdef01234567', title: 'Nowhere', priority: 'LOW', items: [{ description: 'Pens', quantity: 1, uom: 'EA', estimatedUnitPrice: 10 }] })).status === 422);

  for (const type of ['SURGICAL_INSTRUMENT', 'CAPITAL_EQUIPMENT', 'LAB_REAGENT', 'IT_ELECTRONICS', 'MAINTENANCE']) {
    const created = await call('POST', '/requisitions', t.requester, { department: it._id, title: `Type ${type}`, priority: 'LOW', items: [{ description: `Type ${type}`, quantity: 1, uom: 'EA', estimatedUnitPrice: 10, itemType: type }] });
    check(`the new item type ${type} is accepted`, created.status === 201 && created.body.items[0].itemType === type, created.body);
  }
  const reagent = await acceptedPo('Blood test reagent', 'LAB_REAGENT', 2, 100);
  check('lab reagents need a batch and expiry, like drugs', /batch number/.test((await call('POST', '/grn', t.store, grnFor(reagent.po, { receivedQty: 2, acceptedQty: 2 }))).body.message));
  check('and are received with them', (await call('POST', '/grn', t.store, grnFor(reagent.po, { receivedQty: 2, acceptedQty: 2, batchNumber: 'R-1', expiryDate: days(60) }))).status === 201);
  const asset = await acceptedPo('MRI coil', 'CAPITAL_EQUIPMENT', 1, 5000);
  check('capital equipment needs serials, like equipment', (await call('POST', '/grn', t.store, grnFor(asset.po, { receivedQty: 1, acceptedQty: 1 }))).status === 422);
  await call('POST', '/grn', t.store, grnFor(asset.po, { receivedQty: 1, acceptedQty: 1, serialNumbers: ['COIL-1'] }));
  const assetEarly = await call('POST', '/invoices', t.vendor1, billOf(asset.po, 'GL-ASSET0', 1));
  check('and an invoice before commissioning waits', assetEarly.status === 201 && assetEarly.body.match.status === 'PENDING', assetEarly.body);
  await call('POST', `/invoices/${assetEarly.body._id}/reject`, t.finance, { reason: 'Test of an early invoice' });
  const assetSignOff = await call('POST', '/service-entries', t.store, { purchaseOrderId: asset.po._id, poItemId: asset.po.items[0]._id, quantity: 1, completedOn: new Date().toISOString() });
  check('capital equipment is commissioned like equipment', assetSignOff.body.type === 'COMMISSIONING', assetSignOff.body);
  await call('POST', `/service-entries/${assetSignOff.body._id}/accept`, t['hod.it'], {});
  check('and is billable once commissioned', (await call('POST', '/invoices', t.vendor1, billOf(asset.po, 'GL-ASSET1', 1))).body.status === 'MATCHED');
  const tools = await acceptedPo('Forceps set', 'SURGICAL_INSTRUMENT', 3, 200);
  check('surgical instruments are received as general goods', (await call('POST', '/grn', t.store, grnFor(tools.po, { receivedQty: 3, acceptedQty: 3 }))).status === 201);

  const searchFor = async (q: string, who = 'requester') => call('GET', `/catalog/items?q=${encodeURIComponent(q)}`, t[who]);
  const laptop = (await searchFor('lapt')).body.find((i: any) => i.description === 'Laptop');
  check('the catalog suggests a bought item, with the last purchase price', laptop?.uom === 'EA' && laptop.estimatedUnitPrice === 48000, laptop);
  const forceps = (await searchFor('Forceps')).body[0];
  check('an item suggests its unit and price', forceps?.description === 'Forceps set' && forceps.uom === 'EA' && forceps.estimatedUnitPrice === 200, forceps);
  // Item codes are gone: one an old client still sends is ignored, and the line keeps a single name.
  const coded = await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Coded item', priority: 'LOW', items: [{ itemCode: 'SYR-10', description: 'Syringe 10ml luer', quantity: 1, uom: 'BOX', estimatedUnitPrice: 75 }] });
  check('an item code sent on a PR line is not stored', coded.status === 201 && coded.body.items[0].itemCode === undefined && coded.body.items[0].description === 'Syringe 10ml luer', coded.body.items);
  const syringe = (await searchFor('syringe 10')).body[0];
  check('a suggestion fills in the unit and price, with no item code', syringe?.description === 'Syringe 10ml luer' && syringe.itemCode === undefined && syringe.uom === 'BOX' && syringe.estimatedUnitPrice === 75, syringe);
  for (const path of ['/requisitions', '/sourcing/rfqs', '/purchase-orders']) {
    check(`no item code anywhere in ${path}`, !JSON.stringify((await call('GET', path, t.procurement)).body).includes('itemCode'));
  }
  check('a short search returns nothing', (await searchFor('a')).body.length === 0);
  check('search text is taken literally', (await searchFor('(*[')).status === 200);
  check('vendors cannot search the catalog', (await searchFor('lapt', 'vendor1')).status === 403);

  check('the post-action messages are gone', (await call('GET', '/notifications', t['hod.it'])).status === 404);

  // ---- PRs go live at once, can be edited or cancelled, and carry a conversation ----------------
  const livePr = await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Live at once', priority: 'LOW', items: [{ description: 'Cotton', quantity: 2, uom: 'EA', estimatedUnitPrice: 50 }] });
  check('a new PR goes straight to its approvers', livePr.status === 201 && livePr.body.status === 'SUBMITTED' && livePr.body.approvals[0].role === 'HOD', livePr.body);
  check('a PR that does not fit the budget is refused, not saved', (await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Too big', priority: 'LOW', items: [{ description: 'Wing', quantity: 1, uom: 'EA', estimatedUnitPrice: 999_999_999 }] })).status === 422 && !((await call('GET', '/requisitions', t.requester)).body as any[]).some((p) => p.title === 'Too big'));
  const edited = await call('PATCH', `/requisitions/${livePr.body._id}`, t.requester, { title: 'Live at once, edited', items: [{ description: 'Cotton', quantity: 5, uom: 'EA', estimatedUnitPrice: 50 }] });
  check('the requester edits a submitted PR', edited.status === 200 && edited.body.status === 'SUBMITTED' && edited.body.totalEstimate === 250 && edited.body.history.some((h: any) => h.action === 'EDITED'), edited.body);
  check('nobody else can edit it', (await call('PATCH', `/requisitions/${livePr.body._id}`, t['hod.it'], { title: 'Hijacked' })).status === 403);
  const chainPr = await raisePr('Edit resets the chain', 'GOODS', 1, 1_200_000);
  await call('POST', `/requisitions/${chainPr._id}/approve`, t['hod.it'], {});
  // Phase 23: once the HOD has approved, the PR is locked for the requester even while Finance has still to decide.
  const lockedEdit = await call('PATCH', `/requisitions/${chainPr._id}`, t.requester, { title: 'Edit after HOD approval' });
  check('a direct edit after HOD approval is refused', lockedEdit.status === 422 && /HOD has approved/.test(lockedEdit.body.message), lockedEdit.body);
  const stillApproved = (await call('GET', `/requisitions/${chainPr._id}`, t.requester)).body;
  check('the refused edit leaves the HOD approval and title in place', stillApproved.title === 'Edit resets the chain' && stillApproved.approvals[0].status === 'APPROVED' && stillApproved.status === 'SUBMITTED', stillApproved);
  const committedBeforeCancel = (await budget()).committed;
  check('the requester cancels their own submitted PR', (await call('POST', `/requisitions/${chainPr._id}/cancel`, t.requester, { reason: 'No longer needed' })).body.status === 'CANCELLED' && (await budget()).committed === committedBeforeCancel);
  const approvedOwn = await approvedPr('Cancel after approval', 'GOODS', 1, 300);
  const committedApproved = (await budget()).committed;
  check('cancelling an approved PR releases its budget', (await call('POST', `/requisitions/${approvedOwn._id}/cancel`, t.requester, { reason: 'Bought elsewhere' })).body.status === 'CANCELLED' && (await budget()).committed === committedApproved - 300);
  check('an approved PR can no longer be edited', (await call('PATCH', `/requisitions/${(await approvedPr('Locked edit', 'GOODS', 1, 10))._id}`, t.requester, { title: 'Too late' })).status === 422);
  check('a PR under sourcing cannot be cancelled', (await call('POST', `/requisitions/${pr._id}/cancel`, t.requester, { reason: 'Too late now' })).status === 422);

  const chatPr = livePr.body;
  check('an empty chat message is refused', (await call('POST', `/requisitions/${chatPr._id}/messages`, t.requester, { text: '  ' })).status === 422);
  const hello = await call('POST', `/requisitions/${chatPr._id}/messages`, t.requester, { text: 'Needed for the new ward' });
  check('the requester writes on the PR', hello.status === 201 && hello.body.readBy.length === 0, hello.body);
  check('the auditor reads without it counting as read', (await call('GET', `/requisitions/${chatPr._id}/messages`, t.auditor)).body.length === 1 && (await call('GET', `/requisitions/${chatPr._id}/messages`, t.requester)).body[0].readBy.length === 0);
  check('the auditor cannot write', (await call('POST', `/requisitions/${chatPr._id}/messages`, t.auditor, { text: 'Hi' })).status === 403);
  const hodView = (await call('GET', `/requisitions/${chatPr._id}/messages`, t['hod.it'])).body;
  check('the HOD sees the conversation', hodView[0].text === 'Needed for the new ward' && hodView[0].senderName === 'Riya Requester');
  await call('POST', `/requisitions/${chatPr._id}/messages`, t['hod.it'], { text: 'How many beds?' });
  const requesterView = (await call('GET', `/requisitions/${chatPr._id}/messages`, t.requester)).body;
  check('the sender sees who read it, the reply in order', requesterView[0].readBy.some((r: any) => r.name.startsWith('Harish')) && requesterView[1].text === 'How many beds?', requesterView);
  check('the reply is now read by the requester', (await call('GET', `/requisitions/${chatPr._id}/messages`, t['hod.it'])).body[1].readBy.some((r: any) => r.name === 'Riya Requester'));
  check('reading twice does not add a second receipt', (await call('GET', `/requisitions/${chatPr._id}/messages`, t['hod.it'])).body[0].readBy.length === 1);
  check('another department HOD cannot see it', (await call('GET', `/requisitions/${chatPr._id}/messages`, t['hod.ops'])).status === 404);
  check('Procurement cannot see a PR before approval', (await call('GET', `/requisitions/${chatPr._id}/messages`, t.procurement)).status === 404);
  check('a vendor cannot see the conversation of a PR that is not their order', (await call('GET', `/requisitions/${chatPr._id}/messages`, t.vendor1)).status === 404);

  // ---- Phase 24: the chat icon on each journey card, with the user's unread count -------------------
  const unread = async (who: string) => (await call('GET', '/chat/unread', t[who])).body;
  const prUnread = async (who: string, prId: string) => (await unread(who)).prs?.[prId] ?? 0;
  for (const who of accounts) check(`${who} gets their card badges`, (await call('GET', '/chat/unread', t[who])).status === 200);
  check('the sidebar inbox endpoint is gone', (await call('GET', '/requisitions/messages/unread', t.requester)).status === 404);
  await call('POST', `/requisitions/${chatPr._id}/messages`, t.requester, { text: 'Two more questions' });
  await call('POST', `/requisitions/${chatPr._id}/messages`, t.requester, { text: 'And a third' });
  check('the HOD has the 2 new messages unread on that PR', (await prUnread('hod.it', chatPr._id)) === 2, await unread('hod.it'));
  check('a sender never has their own messages unread', (await prUnread('requester', chatPr._id)) === 0, await unread('requester'));
  check('Finance has every message from others unread, each counted once', (await prUnread('finance', chatPr._id)) === 4, await unread('finance'));
  await call('GET', `/requisitions/${chatPr._id}/messages`, t['hod.it']);
  check('reading clears the count for the reader', (await prUnread('hod.it', chatPr._id)) === 0);
  check('one reader does not clear it for another', (await prUnread('finance', chatPr._id)) === 4);
  check('the auditor has the unread they have not looked at', (await prUnread('auditor', chatPr._id)) === 3, await unread('auditor'));
  await call('GET', `/requisitions/${chatPr._id}/messages`, t.auditor);
  check('the auditor reading clears only their own count', (await prUnread('auditor', chatPr._id)) === 0 && (await prUnread('finance', chatPr._id)) === 4);
  const afterAuditor = (await call('GET', `/requisitions/${chatPr._id}/messages`, t.requester)).body as any[];
  check('the auditor never shows in a read receipt', afterAuditor.every((m) => !m.readBy.some((r: any) => r.name === 'Asha Auditor')) && afterAuditor[3].readBy.some((r: any) => r.name.startsWith('Harish')), afterAuditor);
  check('a read receipt says when it was read', afterAuditor[3].readBy.every((r: any) => !!r.at));
  check('the Store has no say on a PR without a PO', (await call('GET', `/requisitions/${chatPr._id}/messages`, t.store)).status === 404 && (await prUnread('store', chatPr._id)) === 0);
  await call('POST', `/requisitions/${pr._id}/messages`, t.procurement, { text: 'Delivery is due on Friday' });
  check('the Store takes part once the PR has a PO', (await prUnread('store', pr._id)) === 1, await unread('store'));
  check('the Store can read and reply there', (await call('GET', `/requisitions/${pr._id}/messages`, t.store)).status === 200 && (await call('POST', `/requisitions/${pr._id}/messages`, t.store, { text: 'Dock 2 is ready' })).status === 201);
  check('a vendor is only counted on PRs whose PO is theirs', Object.keys((await unread('vendor1')).prs).every((id) => id !== chatPr._id) && !Object.keys((await unread('vendor2')).prs).includes(pr._id), [await unread('vendor1'), await unread('vendor2')]);

  // A vendor's private conversation with Procurement on an RFQ, carried on into their PO.
  const vendor1Tracks = (await call('GET', '/journey', t.vendor1)).body.tracks as any[];
  check('every vendor journey card carries its RFQ; only a selected vendor\'s card carries its PR', vendor1Tracks.length > 0 && vendor1Tracks.every((tr) => tr.rfqId === tr.id && (tr.prId === undefined || tr.steps.some((st: any) => st.label === 'Selected by the buyer' && st.state === 'done'))), vendor1Tracks.map((tr) => [tr.id, tr.rfqId, tr.prId]));
  const internalCard = (await call('GET', `/requisitions/${pr._id}/journey`, t.procurement)).body;
  check('an internal card carries its PR and RFQ', internalCard.prId === pr._id && internalCard.rfqId === rfq._id, internalCard);
  const v1Msg = await call('POST', `/chat/rfqs/${rfq._id}/messages`, t.vendor1, { text: 'When should we deliver?' });
  check('the vendor writes to the buyer on their RFQ', v1Msg.status === 201 && v1Msg.body.readBy.length === 0, v1Msg.body);
  check('Procurement sees it as unread on that RFQ', (await unread('procurement')).rfqs[rfq._id] === 1, await unread('procurement'));
  check('roles that do not deal with vendors are not counted', !(await unread('hod.it')).rfqs[rfq._id] && !(await unread('finance')).rfqs[rfq._id] && !(await unread('store')).rfqs[rfq._id]);
  check('those roles cannot open a vendor conversation', (await call('GET', `/chat/rfqs/${rfq._id}/vendors`, t['hod.it'])).status === 403 && (await call('GET', `/chat/rfqs/${rfq._id}/vendors/${vendorIdOne}/messages`, t.store)).status === 403);
  const threads = (await call('GET', `/chat/rfqs/${rfq._id}/vendors`, t.procurement)).body as any[];
  check('Procurement lists the vendor conversations on the RFQ, with unread', threads.some((x) => x.vendorId === vendorIdOne && x.unread === 1) && threads.some((x) => x.vendorId !== vendorIdOne), threads);
  const reply = await call('POST', `/chat/rfqs/${rfq._id}/vendors/${vendorIdOne}/messages`, t.procurement, { text: 'Monday, dock 2' });
  check('Procurement replies to that vendor', reply.status === 201, reply.body);
  check('reading the vendor conversation clears Procurement\'s count', ((await call('GET', `/chat/rfqs/${rfq._id}/vendors/${vendorIdOne}/messages`, t.procurement)).body as any[]).length === 2 && !(await unread('procurement')).rfqs[rfq._id]);
  check('the vendor has the reply unread on their card', (await unread('vendor1')).rfqs[rfq._id] === 1, await unread('vendor1'));
  const v1Conversation = (await call('GET', `/chat/rfqs/${rfq._id}/messages`, t.vendor1)).body as any[];
  check('the vendor sees the buyer team, never a staff name', v1Conversation[1].senderName === 'Procurement' && v1Conversation[0].readBy.every((r: any) => r.name === 'Procurement') && !/Priya/.test(JSON.stringify(v1Conversation)), v1Conversation);
  check('the vendor\'s blue ticks show the buyer read it', v1Conversation[0].readBy.length === 1, v1Conversation[0]);
  check('reading clears the vendor\'s count', !(await unread('vendor1')).rfqs[rfq._id]);
  check('another vendor never sees that conversation', ((await call('GET', `/chat/rfqs/${rfq._id}/messages`, t.vendor2)).body as any[]).length === 0 && !(await unread('vendor2')).rfqs[rfq._id]);
  check('a vendor cannot read another vendor\'s conversation by id', (await call('GET', `/chat/rfqs/${rfq._id}/vendors/${vendorIdOne}/messages`, t.vendor2)).status === 403);
  const inviteOnly = await publishedRfq('Invite-only chat', (await approvedPr('Invite-only chat', 'GOODS', 1, 100))._id, { invitedVendorIds: [vendor2Id] });
  check('a vendor cannot talk on an RFQ they were not invited to', (await call('POST', `/chat/rfqs/${inviteOnly._id}/messages`, t.vendor1, { text: 'Hi' })).status === 404 && (await call('POST', `/chat/rfqs/${inviteOnly._id}/messages`, t.vendor2, { text: 'A question' })).status === 201);
  // From the moment they are invited, before any bid: the buyer's replies, history, badges and ticks.
  check('an invited vendor\'s own message is not unread for them', !(await unread('vendor2')).rfqs[inviteOnly._id]);
  check('the vendor\'s card for the invitation offers the conversation', ((await call('GET', '/journey', t.vendor2)).body.tracks as any[]).some((tr) => tr.rfqId === inviteOnly._id), inviteOnly._id);
  await call('POST', `/chat/rfqs/${inviteOnly._id}/vendors/${vendor2Id}/messages`, t.procurement, { text: 'Please quote by Friday' });
  await call('POST', `/chat/rfqs/${inviteOnly._id}/vendors/${vendor2Id}/messages`, t.procurement, { text: 'Delivery to the main store' });
  check('the invited vendor has the buyer\'s 2 replies unread before bidding', (await unread('vendor2')).rfqs[inviteOnly._id] === 2, await unread('vendor2'));
  check('Procurement\'s own replies are not unread for Procurement: only the vendor\'s question is', (await unread('procurement')).rfqs[inviteOnly._id] === 1, await unread('procurement'));
  const invitedThread = (await call('GET', `/chat/rfqs/${inviteOnly._id}/messages`, t.vendor2)).body as any[];
  check('the invited vendor reads the whole conversation, the buyer shown by team', invitedThread.length === 3 && invitedThread[0].text === 'A question' && invitedThread[2].text === 'Delivery to the main store' && invitedThread[1].senderName === 'Procurement', invitedThread);
  check('reading clears the invited vendor\'s count', !(await unread('vendor2')).rfqs[inviteOnly._id]);
  const buyerSees = (await call('GET', `/chat/rfqs/${inviteOnly._id}/vendors/${vendor2Id}/messages`, t.procurement)).body as any[];
  check('the buyer sees blue ticks once the vendor has read the replies', buyerSees[2].readBy.some((r: any) => r.name === 'Meera Iyer'), buyerSees[2]);
  check('the auditor reads vendor conversations but cannot write', (await call('GET', `/chat/rfqs/${rfq._id}/vendors/${vendorIdOne}/messages`, t.auditor)).status === 200 && (await call('POST', `/chat/rfqs/${rfq._id}/vendors/${vendorIdOne}/messages`, t.auditor, { text: 'Hi' })).status === 403);
  check('the auditor never shows in the vendor\'s read receipts', ((await call('GET', `/chat/rfqs/${rfq._id}/messages`, t.vendor1)).body as any[]).every((m) => m.readBy.every((r: any) => r.name !== 'Audit')));
  check('vendor messages never appear in the internal PR conversation', !((await call('GET', `/requisitions/${pr._id}/messages`, t.procurement)).body as any[]).some((m) => m.text === 'When should we deliver?'));

  // ---- The selected vendor joins the PR/PO conversation from the moment they are selected ------------
  const gatePr = await approvedPr('Vendor chat gate', 'GOODS', 1, 200000);
  await call('POST', `/requisitions/${gatePr._id}/messages`, t.procurement, { text: 'Budget is tight on this one' });
  const gateRfq = await publishedRfq('Vendor chat gate RFQ', gatePr._id);
  await call('POST', `/requisitions/${gatePr._id}/messages`, t['hod.it'], { text: 'Keep the vendor out of this one' });
  const gateBid = await placeBid(gateRfq, 'vendor1', 200000);
  await placeBid(gateRfq, 'vendor2', 210000);
  await call('POST', `/sourcing/rfqs/${gateRfq._id}/close`, t.procurement);
  const gatePo = (await call('POST', `/sourcing/rfqs/${gateRfq._id}/award`, t.procurement, { bidId: gateBid.body._id })).body.po;
  check('(the gate PO waits for the HOD)', gatePo.status === 'PENDING_APPROVAL', gatePo);
  // Everything said on the PR before the vendor was selected stays hidden from them.
  check('internal messages from before the selection never count as unread for the vendor', (await prUnread('vendor1', gatePr._id)) === 0, await unread('vendor1'));
  const beforeWelcome = await call('GET', `/requisitions/${gatePr._id}/messages`, t.vendor1);
  check('the selected vendor sees none of the messages from before their selection', beforeWelcome.status === 200 && beforeWelcome.body.length === 0, beforeWelcome.body);
  const staffFull = (await call('GET', `/requisitions/${gatePr._id}/messages`, t.requester)).body as any[];
  check('staff still see the full history, including what came before the selection', staffFull.some((m) => m.text === 'Budget is tight on this one') && staffFull.some((m) => m.text === 'Keep the vendor out of this one'), staffFull.map((m) => m.text));
  check('the vendor opening the conversation leaves no read receipt on hidden messages', staffFull.every((m) => m.readBy.every((r: any) => r.name !== 'Vikram Shah')), staffFull);
  for (const who of ['hod.it', 'procurement', 'finance', 'admin']) {
    check(`${who} still sees the messages from before the selection`, ((await call('GET', `/requisitions/${gatePr._id}/messages`, t[who])).body as any[]).some((m) => m.text === 'Budget is tight on this one'));
  }
  await call('POST', `/requisitions/${gatePr._id}/messages`, t.procurement, { text: 'Welcome aboard' });
  check('a message sent after the selection reaches the vendor as unread', (await prUnread('vendor1', gatePr._id)) === 1, await unread('vendor1'));
  const pendingCard = ((await call('GET', '/journey', t.vendor1)).body.tracks as any[]).find((tr) => tr.rfqId === gateRfq._id);
  check('the selected vendor\'s card carries the PR conversation while the PO waits', pendingCard?.prId === gatePr._id && pendingCard.steps.some((st: any) => st.label === 'PO received' && st.state !== 'done'), pendingCard);
  const vendorHistory = await call('GET', `/requisitions/${gatePr._id}/messages`, t.vendor1);
  check('the vendor reads only what was said from their selection on, with staff shown by team', vendorHistory.status === 200 && vendorHistory.body.length === 1 && vendorHistory.body[0].text === 'Welcome aboard' && vendorHistory.body[0].senderName === 'Procurement' && !/Priya|Budget is tight|Keep the vendor out/.test(JSON.stringify(vendorHistory.body)), vendorHistory.body);
  check('reading clears that unread for the vendor', (await prUnread('vendor1', gatePr._id)) === 0);
  check('…and can post there before the PO is issued', (await call('POST', `/requisitions/${gatePr._id}/messages`, t.vendor1, { text: 'Stock is reserved for you' })).status === 201);
  await approveAndIssue(gatePo);
  check('the vendor keeps the conversation once the PO is issued', (await call('GET', `/requisitions/${gatePr._id}/messages`, t.vendor1)).status === 200);
  check('a losing vendor never joins', (await call('GET', `/requisitions/${gatePr._id}/messages`, t.vendor2)).status === 404 && (await call('POST', `/requisitions/${gatePr._id}/messages`, t.vendor2, { text: 'Me too' })).status === 404);
  const vendorPost = await call('POST', `/requisitions/${gatePr._id}/messages`, t.vendor1, { text: 'Dispatching on Monday' });
  check('the vendor posts in the PR/PO conversation', vendorPost.status === 201 && vendorPost.body.senderRole === 'VENDOR', vendorPost.body);
  check('staff see the vendor messages unread', (await prUnread('procurement', gatePr._id)) === 2 && (await prUnread('hod.it', gatePr._id)) >= 1 && (await prUnread('store', gatePr._id)) >= 1);
  const staffView = (await call('GET', `/requisitions/${gatePr._id}/messages`, t.procurement)).body as any[];
  check('staff see the vendor by name', staffView.filter((m) => m.senderRole === 'VENDOR').every((m) => m.senderName === 'Vikram Shah') && staffView.some((m) => m.senderRole === 'VENDOR'), staffView);
  await call('POST', `/requisitions/${gatePr._id}/messages`, t.procurement, { text: 'Monday works' });
  check('the vendor has the internal reply unread on their card', (await prUnread('vendor1', gatePr._id)) === 1, await unread('vendor1'));
  const vendorThread = (await call('GET', `/requisitions/${gatePr._id}/messages`, t.vendor1)).body as any[];
  const lastOwn = vendorThread.filter((m) => m.senderRole === 'VENDOR').pop();
  check('the vendor sees the reply, and blue ticks once staff read their message', vendorThread[vendorThread.length - 1].text === 'Monday works' && lastOwn.readBy.some((r: any) => r.name === 'Procurement') && lastOwn.readBy.every((r: any) => !/Priya/.test(r.name)), vendorThread);
  check('reading clears the vendor\'s count', (await prUnread('vendor1', gatePr._id)) === 0);
  const vendorCard = ((await call('GET', '/journey', t.vendor1)).body.tracks as any[]).find((tr) => tr.rfqId === gateRfq._id);
  check('the vendor\'s PO card carries the PR for its order conversation', vendorCard?.prId === gatePr._id && vendorCard.reference === gatePo.poNumber, vendorCard);
  check('a vendor still cannot open the PR itself', (await call('GET', `/requisitions/${gatePr._id}`, t.vendor1)).status === 403);

  // A cancelled PO sends the PR back to sourcing, and the vendor leaves its conversation.
  const dropPr = await approvedPr('Vendor chat drop', 'GOODS', 1, 200000);
  const dropRfq = await publishedRfq('Vendor chat drop RFQ', dropPr._id);
  const dropBid = await placeBid(dropRfq, 'vendor1', 200000);
  const dropPo = (await call('POST', `/sourcing/rfqs/${dropRfq._id}/award`, t.procurement, { bidId: dropBid.body._id })).body.po;
  check('(the selected vendor is in that conversation)', (await call('GET', `/requisitions/${dropPr._id}/messages`, t.vendor1)).status === 200);
  await call('POST', `/purchase-orders/${dropPo._id}/cancel`, t.procurement, { reason: 'Requirement changed' });
  check('once the PO is cancelled the vendor leaves the conversation', (await call('GET', `/requisitions/${dropPr._id}/messages`, t.vendor1)).status === 404 && !(await unread('vendor1')).prs[dropPr._id]);

  // Phase 26: a sender's own messages never count as unread for them, in any conversation.
  for (const who of ['requester', 'hod.it', 'procurement', 'store', 'finance', 'admin', 'vendor1']) {
    const before = await prUnread(who, gatePr._id);
    await call('GET', `/requisitions/${gatePr._id}/messages`, t[who]);
    await call('POST', `/requisitions/${gatePr._id}/messages`, t[who], { text: `From ${who}` });
    check(`${who}'s own message never counts as unread for them`, (await prUnread(who, gatePr._id)) === 0, [before, await unread(who)]);
  }
  check('everyone else has each of those messages unread once', (await prUnread('auditor', gatePr._id)) === ((await call('GET', `/requisitions/${gatePr._id}/messages`, t.procurement)).body as any[]).length, await unread('auditor'));
  check('auditor still sees the messages from before the selection', ((await call('GET', `/requisitions/${gatePr._id}/messages`, t.auditor)).body as any[]).some((m) => m.text === 'Budget is tight on this one'));
  const vendorFinal = (await call('GET', `/requisitions/${gatePr._id}/messages`, t.vendor1)).body as any[];
  const staffFinal = (await call('GET', `/requisitions/${gatePr._id}/messages`, t.procurement)).body as any[];
  check('at the end the vendor still sees only messages from their selection on', vendorFinal.length === staffFinal.length - 2 && !/Budget is tight|Keep the vendor out/.test(JSON.stringify(vendorFinal)), [vendorFinal.length, staffFinal.length]);
  const ownVendorNote = await call('POST', `/chat/rfqs/${gateRfq._id}/messages`, t.vendor1, { text: 'Private note to the buyer' });
  check('own messages in a private vendor conversation never count either', ownVendorNote.status === 201 && !(await unread('vendor1')).rfqs[gateRfq._id] && (await unread('procurement')).rfqs[gateRfq._id] === 1);
  await call('POST', `/chat/rfqs/${gateRfq._id}/vendors/${vendorIdOne}/messages`, t.procurement, { text: 'Noted' });
  check('…for the buyer too', (await unread('procurement')).rfqs[gateRfq._id] === 1 && (await unread('vendor1')).rfqs[gateRfq._id] === 1);

  await call('POST', `/purchase-orders/${gatePo._id}/cancel`, t.procurement, { reason: 'Requirement changed' });
  check('once the PO is cancelled, the vendor leaves the conversation', (await call('GET', `/requisitions/${gatePr._id}/messages`, t.vendor1)).status === 404 && !(await unread('vendor1')).prs[gatePr._id]);

  // ---- Phase 23: product title, PO title and description, carried from PR to GRN ------------------
  const titled = await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Office Equipment Purchase', justification: 'Business laptops for office use', priority: 'LOW', items: [{ title: 'Dell Latitude Laptop', description: 'Laptop for office use', quantity: 2, uom: 'EA', estimatedUnitPrice: 40000 }] });
  check('a PR line keeps its product title and description', titled.status === 201 && titled.body.items[0].title === 'Dell Latitude Laptop' && titled.body.items[0].description === 'Laptop for office use', titled.body);
  await call('POST', `/requisitions/${titled.body._id}/approve`, t['hod.it'], {});
  const titledRfq = await publishedRfq('Office Equipment Purchase', titled.body._id);
  check('the RFQ line carries the product title', titledRfq.items[0].title === 'Dell Latitude Laptop', titledRfq.items);
  const prRow = ((await call('GET', '/requisitions', t.procurement)).body as any[]).find((x) => x._id === titled.body._id);
  check('the PR row links to its exact RFQ', prRow.status === 'SOURCING' && prRow.rfq === titledRfq._id, prRow);
  check('a second RFQ for the same PR is refused', (await call('POST', '/sourcing/rfqs', t.procurement, { title: 'Again', requisitionIds: [titled.body._id], invitedVendorIds: [], closeAt: new Date(Date.now() + 3_600_000).toISOString() })).status === 422);
  const vendorItem = ((await call('GET', `/sourcing/rfqs/${titledRfq._id}`, t.vendor1)).body.items as any[])[0];
  check('the vendor sees the product title', vendorItem.title === 'Dell Latitude Laptop', vendorItem);
  const titledBid = await placeBid(titledRfq, 'vendor1', 40000);
  await call('POST', `/sourcing/rfqs/${titledRfq._id}/close`, t.procurement);
  const titledSheet = (await call('GET', `/sourcing/rfqs/${titledRfq._id}/bids`, t.procurement)).body as any[];
  check('the comparison sheet names the product', titledSheet[0].items[0].title === 'Dell Latitude Laptop', titledSheet[0].items);
  const titledAward = await call('POST', `/sourcing/rfqs/${titledRfq._id}/award`, t.procurement, { bidId: titledBid.body._id });
  const titledPo = titledAward.body.po;
  check('the PO line carries the product title and is issued at once', titledPo.items[0].title === 'Dell Latitude Laptop' && titledPo.status === 'ISSUED', titledPo);
  const storeRow = ((await call('GET', '/purchase-orders', t.store)).body as any[]).find((x) => x._id === titledPo._id);
  check('the Store PO list has what the GRN dropdown shows', storeRow.rfq.title === 'Office Equipment Purchase' && storeRow.vendor.companyName && storeRow.vendor.contactPerson && storeRow.items[0].title === 'Dell Latitude Laptop' && storeRow.items[0].description === 'Laptop for office use' && !!storeRow.createdAt, storeRow);
  const titledGrn = await call('POST', '/grn', t.store, grnFor(titledPo, { receivedQty: 2, acceptedQty: 2 }, 'CH-TITLE'));
  check('the GRN line carries the product title', titledGrn.status === 201 && titledGrn.body.items[0].title === 'Dell Latitude Laptop', titledGrn.body);
  const titledTrack = (await call('GET', `/requisitions/${titled.body._id}/journey`, t.requester)).body;
  check('a PO journey card has its RFQ title and the PR justification', titledTrack.reference === titledPo.poNumber && titledTrack.title === 'Office Equipment Purchase' && titledTrack.description === 'Business laptops for office use', titledTrack);
  const oldStyle = await call('POST', '/requisitions', t.requester, { department: it._id, title: 'No product title', priority: 'LOW', items: [{ description: 'Plain description', quantity: 1, uom: 'EA', estimatedUnitPrice: 10 }] });
  check('a line without a product title is still accepted', oldStyle.status === 201 && oldStyle.body.items[0].title === undefined, oldStyle.body);
  const prCard = (await call('GET', `/requisitions/${oldStyle.body._id}/journey`, t.requester)).body;
  check('a PR card with no justification has no description', prCard.title === 'No product title' && prCard.description === undefined, prCard);

  const prJourney = (await call('GET', `/requisitions/${chatPr._id}/journey`, t.requester)).body;
  check('a PR track carries its PR, for the chat', prJourney.prId === chatPr._id);
  const dashTrack = (await call('GET', '/journey', t['hod.it'])).body.tracks.find((tr: any) => tr.reference === chatPr.prNumber);
  check('the dashboard track carries its PR too', dashTrack?.prId === chatPr._id, dashTrack);
  check('a PO track carries the PR behind it', (await call('GET', `/requisitions/${pr._id}/journey`, t.requester)).body.prId === pr._id);
  check('a vendor track carries a PR only once they are selected', ((await call('GET', '/journey', t.vendor1)).body.tracks as any[]).every((tr) => tr.prId === undefined || tr.steps.some((st: any) => st.label === 'Selected by the buyer' && st.state === 'done')));
  check('a losing vendor track never carries a PR', ((await call('GET', '/journey', t.vendor2)).body.tracks as any[]).every((tr) => tr.prId === undefined || tr.steps.some((st: any) => st.label === 'Selected by the buyer' && st.state === 'done')));
  const prLabels = prJourney.steps.map((st: any) => st.label);
  check('a new PR shows its whole path, to payment', ['HOD approval', 'RFQ published', 'PO generated', 'Goods receipt & inspection', 'Invoice', 'Tax verification', 'Payment release', 'Closed'].every((l) => prLabels.includes(l)), prLabels);
  check('the path has no separate PO approval, issue or acknowledgement stages', !prLabels.some((l: string) => ['PO approval', 'PO issued', 'Vendor acknowledgement'].includes(l)), prLabels);
  check('each step says what it waits for or what happened', prJourney.steps[0].status === 'PR submitted' && prJourney.steps.find((st: any) => st.label === 'HOD approval').status === 'HOD approval pending: waiting for HOD review' && prJourney.steps.find((st: any) => st.label === 'Payment release').status === 'Upcoming', prJourney.steps.slice(0, 3));
  await call('POST', `/requisitions/${chatPr._id}/approve`, t['hod.it'], {});
  const approvedJourney = (await call('GET', `/requisitions/${chatPr._id}/journey`, t.requester)).body;
  check('a completed step says so', approvedJourney.steps.find((st: any) => st.label === 'HOD approval').status === 'HOD approval completed' && approvedJourney.steps.find((st: any) => st.state === 'current').status === 'Waiting for Procurement to initiate the RFQ', approvedJourney.steps.slice(0, 4));
  const poJourney = (await call('GET', `/requisitions/${pr._id}/journey`, t.requester)).body;
  check('a PR with a PO follows it through to the end', poJourney.reference === po.poNumber && poJourney.steps.every((st: any) => st.state === 'done'), poJourney.steps.filter((st: any) => st.state !== 'done'));
  check('a cancelled PR says why', /Cancelled: No longer needed/.test((await call('GET', `/requisitions/${chainPr._id}/journey`, t.requester)).body.message));

  const past = (await call('GET', '/vendors?status=APPROVED&past=true', t.procurement)).body as any[];
  check('past vendors are those who bid or supplied before', past.length === 2 && past.every((v) => ['vendor1@p2p.local', 'vendor2@p2p.local'].includes(v.email)), past.map((v) => v.email));
  const privatePr = await approvedPr('Private invite', 'GOODS', 1, 100);
  const privateRfq = (await call('POST', '/sourcing/rfqs', t.procurement, { title: 'Private invite', requisitionIds: [privatePr._id], invitedVendorIds: [past.find((v) => v.email === 'vendor2@p2p.local')._id], closeAt: closeAt() })).body;
  await call('POST', `/sourcing/rfqs/${privateRfq._id}/publish`, t.procurement);
  const seesRfq = async (who: string) => ((await call('GET', '/sourcing/rfqs', t[who])).body as any[]).some((r) => r._id === privateRfq._id);
  check('a private invitation reaches only the chosen vendor', (await seesRfq('vendor2')) && !(await seesRfq('vendor1')));
  const globalPr = await approvedPr('Global tender', 'GOODS', 1, 100);
  const globalRfq = (await call('POST', '/sourcing/rfqs', t.procurement, { title: 'Global tender', requisitionIds: [globalPr._id], invitedVendorIds: [], closeAt: closeAt() })).body;
  await call('POST', `/sourcing/rfqs/${globalRfq._id}/publish`, t.procurement);
  const allSee = await Promise.all(['vendor1', 'vendor2'].map(async (who) => ((await call('GET', '/sourcing/rfqs', t[who])).body as any[]).some((r) => r._id === globalRfq._id)));
  check('a global RFQ reaches every vendor', allSee.every(Boolean));

  // Every page each role uses loads without a permission error.
  const PAGE_CALLS: Record<string, string[]> = {
    requester: ['/journey', '/purchase-orders/summary', '/requisitions', '/admin/departments', '/catalog/items?q=co', '/purchase-orders', '/service-entries', `/requisitions/${chatPr._id}`, `/requisitions/${chatPr._id}/journey`, `/requisitions/${chatPr._id}/messages`],
    'hod.it': ['/journey', '/purchase-orders/summary', '/treasury/payments/my-approvals', '/requisitions', '/purchase-orders', '/service-entries', `/requisitions/${chatPr._id}/messages`],
    'hod.ops': ['/journey', '/purchase-orders/summary', '/treasury/payments/my-approvals', '/requisitions', '/purchase-orders', '/service-entries'],
    procurement: ['/journey', '/requisitions', '/vendors', '/vendors?status=APPROVED&past=true', '/sourcing/rfqs', '/sourcing/dashboard', '/purchase-orders', '/service-entries', `/requisitions/${chatPr._id}/messages`, `/requisitions/${chatPr._id}/journey`],
    store: ['/journey', '/grn', '/grn/inventory', '/grn/inventory/near-expiry', '/grn/returns', '/purchase-orders', '/service-entries'],
    finance: ['/journey', '/requisitions', '/invoices', '/purchase-orders/invoiceable', '/treasury/queue', '/treasury/payments', '/purchase-orders', `/requisitions/${chatPr._id}/messages`],
    vendor1: ['/journey', '/sourcing/rfqs', '/vendors/me', '/purchase-orders', '/purchase-orders/invoiceable', '/invoices', '/service-entries', '/grn/returns'],
    auditor: ['/journey', '/requisitions', '/vendors', '/sourcing/rfqs', '/purchase-orders', '/grn', '/service-entries', '/invoices', '/treasury/queue', '/audit/activity', '/admin/users'],
    admin: ['/journey', '/treasury/payments/my-approvals', '/requisitions', '/sourcing/rfqs', '/grn', '/invoices', '/treasury/queue', '/admin/users'],
  };
  for (const [who, paths] of Object.entries(PAGE_CALLS)) {
    const refused: string[] = [];
    for (const path of paths) {
      const r = await call('GET', path, t[who]);
      if (r.status >= 400) refused.push(`${path} ${r.status}`);
    }
    check(`${who}: every page call is allowed`, refused.length === 0, refused);
  }

  // ---- The track only names active roles ------------------------------------------------------
  const MERGED_WORDING = /Quality (Control|inspection)|\bQC\b|Accounts Payable|\bAP\b|Treasury|TREASURY|Liability booked|quarantine/;
  const ACTIVE_OWNERS = ['REQUESTER', 'HOD', 'PROCUREMENT', 'STORE', 'FINANCE', 'AUDITOR', 'ADMIN', 'VENDOR'];
  const allTracks: any[] = [];
  for (const who of accounts) {
    const journey = await journeyFor(who);
    allTracks.push(...journey.tracks);
    const text = JSON.stringify(journey.tracks.map((tr: any) => ({ steps: tr.steps.map((st: any) => st.label), message: tr.message, pendingAt: tr.pendingAt })));
    check(`${who}: the track names no removed department`, !MERGED_WORDING.test(text), text.slice(0, 300));
    check(`${who}: every lock points at an active role`, journey.tracks.every((tr: any) => !tr.pendingAt || ACTIVE_OWNERS.includes(tr.pendingAt.role)), journey.tracks.map((tr: any) => tr.pendingAt?.role));
  }
  const fullTrack = allTracks.find((tr) => tr.steps.some((st: any) => st.label === 'Payment release'));
  const labelsOf = fullTrack.steps.map((st: any) => st.label);
  check('goods receipt and inspection is one step', labelsOf.filter((l: string) => /Goods receipt|inspection/i.test(l)).filter((l: string) => !/Invoice/.test(l)).join() === 'Goods receipt & inspection', labelsOf);
  const financeSteps = fullTrack.steps.filter((st: any) => st.group === 'Finance').map((st: any) => st.label);
  check('invoice checks, tax and payment form one Finance stage', financeSteps[0] === 'Invoice verification & 3-way match' && financeSteps.includes('Tax verification') && financeSteps[financeSteps.length - 1] === 'Payment release', financeSteps);
  const firstFinance = fullTrack.steps.findIndex((st: any) => st.group === 'Finance');
  check('the Finance stage is unbroken', fullTrack.steps.slice(firstFinance, firstFinance + financeSteps.length).every((st: any) => st.group === 'Finance'), labelsOf);

  const trackPo = await acceptedPo('Finance track', 'GOODS', 1, 100);
  await call('POST', '/grn', t.store, grnFor(trackPo.po, { receivedQty: 1, acceptedQty: 1 }));
  const trackStep = async () => (await journeyFor('finance')).tracks.find((tr: any) => tr.reference === trackPo.po.poNumber);
  const trackInvoice = await call('POST', '/invoices', t.vendor1, billOf(trackPo.po, 'GL-TRACK', 1));
  const atMatch = await trackStep();
  check('a matched invoice waits at Finance, ready to book', atMatch.yourAction && atMatch.pendingAt.role === 'FINANCE' && atMatch.steps.find((st: any) => st.state === 'current').detail === 'Matched, ready to book', atMatch);
  await call('POST', `/invoices/${trackInvoice.body._id}/book`, t.finance, { glAccount: '5000' });
  check('booking moves on to tax verification', (await trackStep()).steps.find((st: any) => st.state === 'current').label === 'Tax verification');
  const trackTax = await call('POST', `/treasury/invoices/${trackInvoice.body._id}/verify-tax`, t.finance, { tdsSection: '194Q' });
  const atRelease = await trackStep();
  check('payment release waits at Finance, by name', atRelease.steps.find((st: any) => st.state === 'current').label === 'Payment release' && /Finance \(Farhan/.test(atRelease.message), atRelease);
  check('a payment waits on Finance in the queue too', ((await call('GET', '/treasury/queue', t.finance)).body.awaitingRelease as any[]).find((p) => p._id === trackTax.body.payment._id).pendingAt.role === 'FINANCE');
  check('Finance is told to release the payment', atRelease.yourAction && atRelease.actionLabel === 'Release payment', atRelease);
  check('Finance was told to verify the matched invoice', atMatch.actionLabel === 'Verify invoice', atMatch);

  // ---- "Your action" says what to do; a passive wait is never shown as the user's action ----------------
  const cardFor = async (who: string, reference: string) => ((await journeyFor(who)).tracks as any[]).find((tr) => tr.reference === reference);
  // The dashboard lists a few cards, actions first; a PR's own journey always has its card.
  const journeyCard = async (who: string, prId: string) => (await call('GET', `/requisitions/${prId}/journey`, t[who])).body;
  const labelPr = await approvedPr('Action labels', 'GOODS', 1, 200000);
  const labelRfq = await publishedRfq('Action labels RFQ', labelPr._id);
  const noBids = await journeyCard('procurement', labelPr._id);
  check('bidding open with no bids: Procurement is only waiting for vendor bids', !!noBids && !noBids.yourAction && noBids.actionLabel === undefined && noBids.message === 'Waiting for vendor bids', noBids);
  const labelBid = await placeBid(labelRfq, 'vendor1', 190000);
  const withBids = await journeyCard('procurement', labelPr._id);
  check('bidding open with a bid in: Close bid & select vendor', withBids?.yourAction && withBids.actionLabel === 'Close bid & select vendor', withBids);
  const openBidding = withBids.steps.find((st: any) => st.label === 'Bidding');
  check('while bidding is open the Bidding step shows when it ends', openBidding?.detail === labelRfq.rfqNumber && openBidding.deadline?.label === 'Ends' && new Date(openBidding.deadline.at).getTime() === new Date(labelRfq.closeAt).getTime(), openBidding);
  for (const who of ['requester', 'hod.it', 'finance', 'admin', 'auditor']) {
    const theirs = (await journeyCard(who, labelPr._id))?.steps?.find((st: any) => st.label === 'Bidding');
    check(`${who} sees the same bidding end date`, theirs?.deadline?.label === 'Ends' && theirs.deadline.at === openBidding.deadline.at, theirs);
  }
  const vendorBidding = ((await journeyFor('vendor1')).tracks as any[]).find((tr) => tr.rfqId === labelRfq._id)?.steps.find((st: any) => st.label === 'Bidding closed');
  check('the vendor sees when bidding ends on their card', vendorBidding?.deadline?.label === 'Ends' && vendorBidding.deadline.at === openBidding.deadline.at, vendorBidding);
  check('…and the dashboard card says the same', (await cardFor('procurement', labelPr.prNumber))?.actionLabel === 'Close bid & select vendor');
  const hodDuringBids = await journeyCard('hod.it', labelPr._id);
  check('the HOD does not see Procurement\'s selection as their action', !!hodDuringBids && !hodDuringBids.yourAction && hodDuringBids.actionLabel === undefined, hodDuringBids);
  await call('POST', `/sourcing/rfqs/${labelRfq._id}/close`, t.procurement);
  const afterClose = await journeyCard('procurement', labelPr._id);
  check('bidding closed, no vendor yet: Select vendor', afterClose?.yourAction && afterClose.actionLabel === 'Select vendor', afterClose);
  check('once closed the Bidding step says Closed with its date', afterClose.steps.find((st: any) => st.label === 'Bidding')?.deadline?.label === 'Closed', afterClose.steps.find((st: any) => st.label === 'Bidding'));
  check('…and so does the vendor\'s card', ((await journeyFor('vendor1')).tracks as any[]).find((tr) => tr.rfqId === labelRfq._id)?.steps.find((st: any) => st.label === 'Bidding closed')?.deadline?.label === 'Closed');
  const emptyPr = await approvedPr('No bids label', 'GOODS', 1, 100);
  const emptyRfq = await publishedRfq('No bids label RFQ', emptyPr._id);
  await call('POST', `/sourcing/rfqs/${emptyRfq._id}/close`, t.procurement);
  const noBidCard = await journeyCard('procurement', emptyPr._id);
  check('bidding closed with no bids: No bids received, and nothing to select', !!noBidCard && !noBidCard.yourAction && noBidCard.actionLabel === undefined && noBidCard.message === 'No bids received', noBidCard);
  const labelPo = (await call('POST', `/sourcing/rfqs/${labelRfq._id}/award`, t.procurement, { bidId: labelBid.body._id })).body.po;
  check('(the label PO waits for the HOD)', labelPo?.status === 'PENDING_APPROVAL', labelPo);
  const hodPoCard = await cardFor('hod.it', labelPo.poNumber);
  check('the HOD is told to approve the PO', hodPoCard?.yourAction && hodPoCard.actionLabel === 'Approve PO', hodPoCard);
  const procPoCard = await journeyCard('procurement', labelPr._id);
  check('Procurement waits on the HOD for that PO', !!procPoCard && !procPoCard.yourAction && /HOD/.test(procPoCard.message), procPoCard);

  const toApprove = await call('POST', '/requisitions', t.requester, { department: it._id, title: 'Approve me label', priority: 'LOW', items: [{ description: 'Gauze roll', quantity: 1, uom: 'EA', estimatedUnitPrice: 50 }] });
  const hodPrCard = await cardFor('hod.it', toApprove.body.prNumber);
  check('the HOD is told to approve the PR', hodPrCard?.yourAction && hodPrCard.actionLabel === 'Approve PR', hodPrCard);
  const requesterPrCard = await cardFor('requester', toApprove.body.prNumber);
  check('the requester waits for the HOD instead', !!requesterPrCard && !requesterPrCard.yourAction && /HOD/.test(requesterPrCard.message), requesterPrCard);

  const bidRfq = await publishedRfq('Bid label RFQ', (await approvedPr('Bid label', 'GOODS', 1, 100))._id);
  const vendorBidCard = ((await journeyFor('vendor2')).tracks as any[]).find((tr) => tr.rfqId === bidRfq._id);
  check('a vendor with an open RFQ is told to submit a bid', vendorBidCard?.yourAction && vendorBidCard.actionLabel === 'Submit bid', vendorBidCard);
  const grnLabel = await acceptedPo('GRN label', 'GOODS', 1, 100);
  const grnLabelPo = grnLabel.po;
  const storeWaitsInvoice = await cardFor('store', grnLabelPo.poNumber);
  check('the Store waits for the vendor invoice first', !!storeWaitsInvoice && !storeWaitsInvoice.yourAction && /vendor/i.test(storeWaitsInvoice.message), storeWaitsInvoice);
  check('the vendor is told to submit the invoice', (await cardFor('vendor1', grnLabelPo.poNumber))?.actionLabel === 'Submit invoice');
  await call('POST', '/invoices', t.vendor1, billOf(grnLabelPo, 'GRN-LABEL-1', 1));
  const storeLabelCard = await cardFor('store', grnLabelPo.poNumber);
  check('the Store is told to record the GRN', storeLabelCard?.yourAction && storeLabelCard.actionLabel === 'Record GRN', storeLabelCard);
  const financeWaitsGrn = await journeyCard('finance', grnLabel.pr._id);
  check('Finance waits for the GRN instead', !!financeWaitsGrn && !financeWaitsGrn.yourAction && /Store/.test(financeWaitsGrn.message), financeWaitsGrn);

  // ---- Vendor invoice before the GRN, per PO, with GRN photos ------------------------------------------
  const isoA = await acceptedPo('Isolation A', 'GOODS', 3, 100);
  const poA = isoA.po;
  const poB = (await acceptedPo('Isolation B', 'GOODS', 5, 200)).po;
  const rowsFor = async (who: string) => (await call('GET', '/purchase-orders', t[who])).body as any[];
  const rowOf = (rows: any[], po: any) => rows.find((r) => r._id === po._id);
  let vendorRows = await rowsFor('vendor1');
  check('each issued PO offers its own Submit Invoice, with its own open quantities', rowOf(vendorRows, poA)?.canInvoice && rowOf(vendorRows, poB)?.canInvoice && rowOf(vendorRows, poA).items[0].openToInvoiceQty === 3 && rowOf(vendorRows, poB).items[0].openToInvoiceQty === 5, [rowOf(vendorRows, poA)?.items, rowOf(vendorRows, poB)?.items]);
  check('nothing to receive before the vendor invoices', !rowOf(await rowsFor('store'), poA)?.invoiceToReceive && !rowOf(await rowsFor('store'), poB)?.invoiceToReceive);
  check('boxes on paperwork must be a whole number of 0 or more', (await call('POST', '/invoices', t.vendor1, { ...billOf(poA, 'ISO-A-BAD', 3), boxesOnPaperwork: -1 })).status === 422);
  const invA = await call('POST', '/invoices', t.vendor1, { ...billOf(poA, 'ISO-A-1', 3), boxesOnPaperwork: 4 });
  check('the invoice keeps the boxes on its paperwork', invA.body.boxesOnPaperwork === 4, invA.body.boxesOnPaperwork);
  check('the vendor invoices PO A before any GRN; it waits at the Store', invA.status === 201 && invA.body.match.status === 'PENDING', invA.body);
  check('the invoice list shows it pending at the Store', ((await call('GET', '/invoices', t.vendor1)).body as any[]).find((i) => i._id === invA.body._id)?.pendingAt?.role === 'STORE');
  vendorRows = await rowsFor('vendor1');
  check('PO A has nothing left to invoice; PO B still does', !rowOf(vendorRows, poA).canInvoice && rowOf(vendorRows, poB).canInvoice && rowOf(vendorRows, poB).items[0].openToInvoiceQty === 5, [rowOf(vendorRows, poA).canInvoice, rowOf(vendorRows, poB).canInvoice]);
  let storeRows = await rowsFor('store');
  check('the Store receives PO A against its own invoice, and nothing yet on PO B', rowOf(storeRows, poA)?.invoiceToReceive?.invoiceNumber === 'ISO-A-1' && rowOf(storeRows, poA).invoiceToReceive.items[0].quantity === 3 && rowOf(storeRows, poA).invoiceToReceive.items[0].poItem === poA.items[0]._id && !rowOf(storeRows, poB).invoiceToReceive, [rowOf(storeRows, poA)?.invoiceToReceive, rowOf(storeRows, poB)?.invoiceToReceive]);
  const invB = await call('POST', '/invoices', t.vendor1, { ...billOf(poB, 'ISO-B-1', 5), boxesOnPaperwork: 7 });
  storeRows = await rowsFor('store');
  check('each PO\'s GRN starts from its own invoice\'s boxes: A 4, B 7', rowOf(storeRows, poA).invoiceToReceive.boxesOnPaperwork === 4 && rowOf(storeRows, poB).invoiceToReceive.boxesOnPaperwork === 7, [rowOf(storeRows, poA).invoiceToReceive, rowOf(storeRows, poB).invoiceToReceive]);
  const viewA = rowOf(storeRows, poA).invoices;
  const viewB = rowOf(storeRows, poB).invoices;
  check('View Invoice on PO A shows only PO A\'s bill', viewA?.length === 1 && viewA[0].invoiceNumber === 'ISO-A-1' && viewA[0].boxesOnPaperwork === 4 && viewA[0].items.length === 1 && viewA[0].items[0].quantity === 3 && viewA[0].items[0].unitPrice === 100 && viewA[0].items[0].taxRate === 18 && viewA[0].subtotal === 300 && viewA[0].gstAmount === 54 && viewA[0].total === 354 && !!viewA[0].internalRef && !!viewA[0].invoiceDate && !!viewA[0].status, viewA);
  check('View Invoice on PO B shows only PO B\'s bill', viewB?.length === 1 && viewB[0].invoiceNumber === 'ISO-B-1' && viewB[0].boxesOnPaperwork === 7 && viewB[0].total === 1180, viewB);
  check('only the Store gets the invoice view on PO rows', rowOf(await rowsFor('vendor1'), poA).invoices === undefined && rowOf(await rowsFor('finance'), poA).invoices === undefined);
  check('the Store still has no Invoices tab access', (await call('GET', '/invoices', t.store)).status === 403);
  check('each PO keeps its own invoice: A with ISO-A-1, B with ISO-B-1', rowOf(storeRows, poA).invoiceToReceive.invoiceNumber === 'ISO-A-1' && rowOf(storeRows, poB).invoiceToReceive.invoiceNumber === 'ISO-B-1' && rowOf(storeRows, poB).invoiceToReceive.items[0].quantity === 5 && rowOf(storeRows, poB).invoiceToReceive.items[0].poItem === poB.items[0]._id, [rowOf(storeRows, poA).invoiceToReceive, rowOf(storeRows, poB).invoiceToReceive]);
  check('the Store is told to record each GRN', (await cardFor('store', poA.poNumber))?.actionLabel === 'Record GRN' && (await cardFor('store', poB.poNumber))?.actionLabel === 'Record GRN');

  const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  check('a GRN photo must be an image', (await call('POST', '/grn', t.store, { ...grnFor(poA, { receivedQty: 3, acceptedQty: 3 }, 'ISO-A-1'), photos: ['data:text/html;base64,PGI+aGk8L2I+'] })).status === 422);
  const grnA = await call('POST', '/grn', t.store, { ...grnFor(poA, { receivedQty: 3, acceptedQty: 3 }, 'ISO-A-1'), photos: [PHOTO, PHOTO.replace('image/png', 'image/jpeg')] });
  check('the GRN keeps its photos', grnA.status === 201 && grnA.body.photos.length === 2 && grnA.body.photos[0] === PHOTO, grnA.body.photos?.length);
  check('the recorded GRN shows its photos to the Store and the Auditor', ((await call('GET', '/grn', t.store)).body as any[]).find((g) => g._id === grnA.body._id)?.photos.length === 2 && ((await call('GET', '/grn', t.auditor)).body as any[]).find((g) => g._id === grnA.body._id)?.photos.length === 2);
  check('a GRN without photos still works and has none', (await call('GET', '/grn', t.store)).body.every((g: any) => Array.isArray(g.photos)));
  check('the GRN on PO A matches its waiting invoice by itself', (await call('GET', `/invoices/${invA.body._id}`, t.finance)).body.status === 'MATCHED');
  check('…and leaves PO B\'s invoice waiting', (await call('GET', `/invoices/${invB.body._id}`, t.finance)).body.match.status === 'PENDING');
  storeRows = await rowsFor('store');
  check('PO A has nothing left to receive; PO B still has its own', !rowOf(storeRows, poA)?.invoiceToReceive && rowOf(storeRows, poB).invoiceToReceive.invoiceNumber === 'ISO-B-1', [rowOf(storeRows, poA)?.invoiceToReceive, rowOf(storeRows, poB)?.invoiceToReceive]);
  check('after the GRN, PO A\'s invoice can still be viewed', rowOf(storeRows, poA).invoices?.[0]?.invoiceNumber === 'ISO-A-1', rowOf(storeRows, poA).invoices);
  const grnBPartial = await call('POST', '/grn', t.store, grnFor(poB, { receivedQty: 2, acceptedQty: 2, shortageReason: 'Balance to follow' }, 'ISO-B-1'));
  check('a partial receipt leaves the rest of the invoice to receive', grnBPartial.status === 201 && rowOf(await rowsFor('store'), poB).invoiceToReceive.items[0].quantity === 3, rowOf(await rowsFor('store'), poB)?.invoiceToReceive);

  // Every role: an action card has an instruction, never a bare step name; any other card has none.
  const BARE_STEPS = ['Bidding', 'Bidding closed', 'Closed', 'Short-closed', 'PR raised', 'RFQ published', 'Vendor selected', 'PO generated', 'Goods receipt & inspection', 'Invoice', 'RFQ received'];
  for (const who of accounts) {
    const tracks = (await journeyFor(who)).tracks as any[];
    check(`${who}: every "Your action" names what to do, and only action cards have one`, tracks.every((tr) => (tr.yourAction ? typeof tr.actionLabel === 'string' && !BARE_STEPS.includes(tr.actionLabel) : tr.actionLabel === undefined)), tracks.map((tr) => [tr.reference, tr.yourAction, tr.actionLabel]));
  }

  // An old record naming a merged role, before the migration has moved it, still points at the role doing that work now.
  const oldStep = await acceptedPo('Old approval record', 'GOODS', 1, 100);
  await mongoose.connection.collection('purchaseorders').updateOne(
    { _id: new mongoose.Types.ObjectId(oldStep.po._id) },
    { $set: { status: 'PENDING_APPROVAL', approvals: [{ level: 1, role: 'TREASURY', status: 'PENDING' }] } },
  );
  const oldRow = ((await call('GET', '/purchase-orders', t.store)).body as any[]).find((p) => p._id === oldStep.po._id);
  check('an old pending step on a merged role shows as Finance', oldRow.pendingAt.role === 'FINANCE' && !/Treasury/.test(oldRow.pendingAt.label), oldRow.pendingAt);
  const oldTrack = (await journeyFor('finance')).tracks.find((tr: any) => tr.reference === oldStep.po.poNumber);
  check('and on the track', !oldTrack || (oldTrack.pendingAt.role === 'FINANCE' && !/Treasury/.test(oldTrack.message)), oldTrack);
  await mongoose.connection.collection('purchaseorders').updateOne({ _id: new mongoose.Types.ObjectId(oldStep.po._id) }, { $set: { status: 'CANCELLED', approvals: [] } });

  // ---- Merging QC, AP and Treasury into an existing database ---------------------------------
  const { consolidateRoles } = await import('../src/seed/consolidateRoles');
  const users = mongoose.connection.collection('users');
  const legacyPo = await acceptedPo('Legacy quarantine', 'BATCH', 5, 10);
  const legacyGrn = await call('POST', '/grn', t.store, grnFor(legacyPo.po, { receivedQty: 5, acceptedQty: 2, qualityStatus: 'DAMAGED', rejectionReason: 'Three crushed', batchNumber: 'OK-1', expiryDate: days(50) }));
  const legacyGrn2 = await call('POST', '/grn', t.store, grnFor(legacyPo.po, { receivedQty: 3, acceptedQty: 3, batchNumber: 'OLD-1', expiryDate: days(50) }, 'CH-LEG2'));
  const legacyId = new mongoose.Types.ObjectId();
  const treasuryPay = (await stagedPayment('Legacy treasury')).payment;
  await mongoose.connection.collection('payments').updateOne({ _id: new mongoose.Types.ObjectId(treasuryPay._id) }, { $set: { status: 'RELEASED', releasedBy: legacyId, utr: 'OLD' } });
  await users.dropIndex('single_master_account');
  await users.insertMany([
    { _id: legacyId, name: 'Tara Treasury', email: 'tara@legacy.test', password: 'x', role: 'TREASURY', isActive: true, doaLimit: 0 },
    { name: 'Anita AP', email: 'anita@legacy.test', password: 'x', role: 'AP', isActive: true, doaLimit: 0 },
    { name: 'Qasim Quality', email: 'qasim@legacy.test', password: 'x', role: 'QC', isActive: true, doaLimit: 0 },
  ]);
  await users.createIndex({ role: 1 }, { unique: true, name: 'single_master_account', partialFilterExpression: { role: { $in: ['ADMIN', 'AUDITOR', 'FINANCE', 'TREASURY', 'STORE', 'AP'] } } });
  const inspections = mongoose.connection.collection('qcinspections');
  const inspectionFor = (grn: any, expiryDate: Date) => ({
    inspectionNumber: `QC-L-${grn.grnNumber}`, grn: new mongoose.Types.ObjectId(grn._id), grnLine: new mongoose.Types.ObjectId(grn.items[0]._id), purchaseOrder: new mongoose.Types.ObjectId(legacyPo.po._id), poItem: new mongoose.Types.ObjectId(legacyPo.po.items[0]._id), vendor: new mongoose.Types.ObjectId(legacyPo.po.vendor), warehouse: 'LEGACY-WH', description: 'Legacy quarantine', batchNumber: grn.items[0].batchNumber, expiryDate, serialNumbers: [], quantity: grn.items[0].acceptedQty, status: 'PENDING', releasedQty: 0, rejectedQty: 0, receivedBy: legacyId,
  });
  await inspections.insertMany([inspectionFor(legacyGrn.body, new Date(Date.now() + 864e5)), inspectionFor(legacyGrn2.body, new Date(Date.now() - 864e5))]);
  const legacyRule = await mongoose.connection.collection('doarules').insertOne({ name: 'Legacy chain', documentType: 'PO', minAmount: 999_000_000, maxAmount: null, isActive: true, levels: [{ level: 1, role: 'AP' }, { level: 2, role: 'TREASURY' }, { level: 3, role: 'FINANCE' }] });
  await mongoose.connection.collection('purchaseorders').updateOne({ _id: new mongoose.Types.ObjectId(legacyPo.po._id) }, { $push: { approvals: { $each: [{ level: 8, role: 'AP', status: 'APPROVED' }, { level: 9, role: 'TREASURY', status: 'PENDING' }] } } as any });
  const legacyStockBefore = ((await call('GET', '/grn/inventory?warehouse=LEGACY-WH', t.store)).body as any[]).length;

  await consolidateRoles();
  await consolidateRoles(); // safe to repeat
  check('merged accounts are removed', (await users.countDocuments({ role: { $in: ['QC', 'AP', 'TREASURY'] } })) === 0);
  check('other accounts are untouched', (await users.countDocuments({ email: { $in: ['finance@p2p.local', 'store@p2p.local', 'requester@p2p.local', 'hod.it@p2p.local', 'procurement@p2p.local', 'auditor@p2p.local', 'admin@p2p.local', 'vendor1@p2p.local'] } })) === 8);
  const removedLogs = (await call('GET', '/audit/activity', t.auditor)).body as any[];
  check('each removal is in the audit trail, once', ['tara@legacy.test', 'anita@legacy.test', 'qasim@legacy.test'].every((email) => removedLogs.filter((l) => l.actorEmail === email && l.action === 'role-consolidation.account-removed').length === 1), removedLogs.slice(0, 3));
  check('a payment keeps who released it', ((await call('GET', '/audit/compliance', t.auditor)).body.payments as any[]).find((p) => p._id === treasuryPay._id).releasedByName === 'Tara Treasury (TREASURY)');
  const legacyStock = ((await call('GET', '/grn/inventory?warehouse=LEGACY-WH', t.store)).body as any[])[0];
  check('goods left in quarantine are settled once, only the current ones in stock', legacyStockBefore === 0 && legacyStock?.quantity === 2 && (await inspections.countDocuments({ status: 'PENDING' })) === 0, legacyStock);
  const legacyAfter = (await call('GET', `/purchase-orders/${legacyPo.po._id}`, t.procurement)).body;
  check('expired goods left in quarantine reopen on the PO', legacyAfter.items[0].receivedQty === 2, legacyAfter.items[0]);
  check('a pending step on a merged role moves to Finance', legacyAfter.approvals.some((a: any) => a.level === 9 && a.role === 'FINANCE'), legacyAfter.approvals);
  check('a past approval keeps the role that gave it', legacyAfter.approvals.some((a: any) => a.level === 8 && a.role === 'AP'), legacyAfter.approvals);
  check('a PO with a merged role in its history can still be changed', (await call('POST', '/grn', t.store, grnFor(legacyPo.po, { receivedQty: 3, acceptedQty: 3, batchNumber: 'NEW-1', expiryDate: days(50) }, 'CH-LEG3'))).status === 201);
  check('a rule on merged roles moves to Finance, once', JSON.stringify((await mongoose.connection.collection('doarules').findOne({ _id: legacyRule.insertedId }))!.levels.map((l: any) => l.role)) === '["FINANCE"]');
  const accountIndex = (await users.indexes()).find((i) => i.name === 'single_master_account');
  await User.createIndexes();
  const newIndex = (await users.indexes()).find((i) => i.name === 'single_master_account');
  check('the account index no longer names merged roles', !accountIndex && JSON.stringify(newIndex?.partialFilterExpression).includes('FINANCE') && !/TREASURY|"AP"/.test(JSON.stringify(newIndex?.partialFilterExpression)), newIndex);
  let storeStillSingle = false;
  try {
    await User.create({ name: 'Direct Two', email: 'direct2@test.local', password: PASSWORD, role: 'FINANCE' });
  } catch (err) {
    storeStillSingle = (err as { code?: number }).code === 11000;
  }
  check('Finance stays a single account', storeStillSingle);

  // ---- Database outage -------------------------------------------------------------------
  const waitFor = async (condition: () => boolean | Promise<boolean>, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  };
  const credentials = { email: 'admin@p2p.local', password: PASSWORD };

  await mongo.stop({ doCleanup: false });
  check('API notices the database has gone', await waitFor(async () => (await call('GET', '/health')).status === 503, 20_000));
  const startedAt = Date.now();
  const downOptions = await call('GET', '/auth/signup-options');
  const downLogin = await call('POST', '/auth/login', undefined, credentials);
  check('signup options answers 503 during an outage', downOptions.status === 503 && /temporarily unavailable/.test(downOptions.body.message), downOptions);
  check('login answers 503 during an outage', downLogin.status === 503 && /temporarily unavailable/.test(downLogin.body.message), downLogin);
  check('outage responses are immediate', Date.now() - startedAt < 1000, Date.now() - startedAt);
  check('existing session gets 503, not 401', (await call('GET', '/auth/me', t.admin)).status === 503);

  await mongo.start(true);
  check('API reconnects by itself', await waitFor(async () => (await call('GET', '/health')).status === 200, 60_000));
  check('login works after reconnecting', (await call('POST', '/auth/login', undefined, credentials)).status === 200);
  check('data survives the outage', (await call('GET', '/auth/signup-options')).body.claimedRoles.includes('ADMIN'));

  server.close();
  await disconnectDatabase();
  await mongoose.disconnect();
  await mongo.stop();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

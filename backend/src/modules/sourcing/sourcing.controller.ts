import { FilterQuery, Types } from 'mongoose';
import { ROLES } from '../../constants/roles';
import { BID_STATUS, ESCALATION_STATUS, PR_STATUS, RATIFICATION_STATUS, RFQ_STATUS, VENDOR_STATUS } from '../../constants/status';
import { env } from '../../config/env';
import { currentUser } from '../../middleware/auth';
import { Bid, BidDocument } from '../../models/Bid';
import { Department } from '../../models/Department';
import { PurchaseRequisition } from '../../models/PurchaseRequisition';
import { RFQ, RfqDocument } from '../../models/RFQ';
import { Vendor, VendorDocument } from '../../models/Vendor';
import { evaluateRfqBids } from '../../services/bidEvaluation.service';
import { adjustCommitment, requisitionEstimate } from '../../services/budget.service';
import { createPoFromBid, preparePoFromBid } from '../../services/purchaseOrder.service';
import { licenceIssues } from '../../services/vendorCompliance.service';
import { vendorRfqScope, vendorRfqViews } from '../../services/vendorRfq.service';
import { AuthUser } from '../../types/auth';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { calcOrderTotals, round2 } from '../../utils/money';
import { oid } from '../../utils/objectId';
import { nextDocNumber } from '../../utils/sequence';

const isVendor = (user: AuthUser) => user.role === ROLES.VENDOR;

/** priceScore is left out because it reveals the lowest rival quote. */
const VENDOR_BID_FIELDS = 'rfq vendor items totalAmount taxAmount grandTotal deliveryDays validityDays notes rank revision status submittedAt';

/** A closed bid shows no rank, and a losing bid stays as it was submitted rather than turning REJECTED at the award. */
function closedBidView(bid: BidDocument) {
  const { rank: _rank, ...view } = bid.toObject();
  return { ...view, status: bid.status === BID_STATUS.REJECTED ? BID_STATUS.SUBMITTED : bid.status };
}

async function loadRfq(id: string, user: AuthUser): Promise<RfqDocument> {
  const scope = isVendor(user) ? vendorRfqScope(user) : {};
  const rfq = await RFQ.findOne({ $and: [{ _id: id }, scope] });
  if (!rfq) throw ApiError.notFound('RFQ');
  return rfq;
}

const isBiddingOpen = (rfq: RfqDocument, now = new Date()) =>
  rfq.status === RFQ_STATUS.PUBLISHED && now >= rfq.openAt && now < rfq.closeAt;

// ---- RFQ lifecycle (procurement) --------------------------------------------------

export const createRfq = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { requisitionIds, invitedVendorIds, openAt, ...rest } = req.body;
  if (await PurchaseRequisition.exists({ _id: { $in: requisitionIds }, isEmergency: true, 'ratification.status': { $exists: true } })) {
    throw ApiError.unprocessable('A requisition has already been bought through the emergency route');
  }
  const uniquePrIds: string[] = [...new Set<string>(requisitionIds)];

  const prs = await PurchaseRequisition.find({ _id: { $in: uniquePrIds }, status: PR_STATUS.APPROVED });
  if (prs.length !== uniquePrIds.length) {
    throw ApiError.unprocessable('Every requisition must be approved and not already under sourcing');
  }
  const departments = new Set(prs.map((p) => p.department.toString()));
  if (departments.size > 1) {
    throw ApiError.unprocessable('An RFQ can only consolidate requisitions from a single department');
  }

  if (invitedVendorIds.length) {
    const approved = await Vendor.countDocuments({ _id: { $in: invitedVendorIds }, status: VENDOR_STATUS.APPROVED });
    if (approved !== new Set(invitedVendorIds).size) {
      throw ApiError.unprocessable('All invited vendors must be approved');
    }
  }

  // Claim the PRs first (conditional update) so two RFQs can never source the same PR.
  const rfqId = new Types.ObjectId();
  const claim = await PurchaseRequisition.updateMany(
    { _id: { $in: uniquePrIds }, status: PR_STATUS.APPROVED },
    {
      $set: { status: PR_STATUS.SOURCING, rfq: rfqId },
      $push: { history: { action: 'SOURCING_STARTED', by: oid(user.id), at: new Date() } },
    },
  );
  if (claim.modifiedCount !== uniquePrIds.length) {
    await PurchaseRequisition.updateMany({ rfq: rfqId }, { $set: { status: PR_STATUS.APPROVED }, $unset: { rfq: 1 } });
    throw ApiError.conflict('One or more requisitions were picked up by another RFQ; please retry');
  }

  try {
    const rfq = await RFQ.create({
      _id: rfqId,
      ...rest,
      rfqNumber: await nextDocNumber('RFQ'),
      department: prs[0].department,
      requisitions: prs.map((p) => p._id),
      items: prs.flatMap((pr) =>
        pr.items.map((i) => ({
          itemCode: i.itemCode,
          title: i.title,
          description: i.description,
          quantity: i.quantity,
          uom: i.uom,
          specifications: i.category,
          itemType: i.itemType,
          sourcePr: pr._id,
          sourcePrItem: i._id,
        })),
      ),
      invitedVendors: invitedVendorIds,
      openAt: openAt ?? new Date(),
      createdBy: user.id,
    });
    res.status(201).json(rfq);
  } catch (err) {
    await PurchaseRequisition.updateMany({ rfq: rfqId }, { $set: { status: PR_STATUS.APPROVED }, $unset: { rfq: 1 } });
    throw err;
  }
});

export const listRfqs = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  if (isVendor(user)) {
    const rfqs = await RFQ.find(vendorRfqScope(user)).populate('department', 'name code').sort({ createdAt: -1 });
    const views = await vendorRfqViews(rfqs, user);
    // Filters on what the vendor sees: filtering on the stored status would reveal which RFQs were awarded.
    return res.json(req.query.status ? views.filter((r) => r.status === String(req.query.status)) : views);
  }

  const rfqs = await RFQ.find(req.query.status ? { status: String(req.query.status) } : {})
    .populate('department', 'name code')
    .populate('purchaseOrder', 'poNumber status')
    .populate({
      path: 'awardedBid',
      select: 'vendor totalAmount taxAmount grandTotal rank',
      populate: { path: 'vendor', select: 'companyName contactPerson vendorCode' },
    })
    .sort({ createdAt: -1 });

  const prs = await PurchaseRequisition.find({ _id: { $in: rfqs.flatMap((r) => r.requisitions) } }).select('totalEstimate');
  const estimateOf = new Map(prs.map((pr) => [pr._id.toString(), pr.totalEstimate]));
  res.json(
    rfqs.map((rfq) => ({
      ...rfq.toObject(),
      budgetEstimate: round2(rfq.requisitions.reduce((sum, id) => sum + (estimateOf.get(id.toString()) ?? 0), 0)),
    })),
  );
});

export const getRfq = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadRfq(req.params.id, user);
  if (isVendor(user)) {
    const [view] = await vendorRfqViews([rfq], user);
    return res.json(view);
  }
  await rfq.populate([
    { path: 'invitedVendors', select: 'companyName vendorCode rating' },
    { path: 'requisitions', select: 'prNumber title totalEstimate' },
  ]);
  res.json(rfq);
});

export const publishRfq = asyncHandler(async (req, res) => {
  const rfq = await loadRfq(req.params.id, currentUser(req));
  if (rfq.status !== RFQ_STATUS.DRAFT) throw ApiError.unprocessable(`RFQ is ${rfq.status}`);
  if (rfq.closeAt <= new Date()) throw ApiError.unprocessable('Closing time has already passed - update closeAt');
  rfq.status = RFQ_STATUS.PUBLISHED;
  await rfq.save();
  res.json(rfq);
});

export const closeRfq = asyncHandler(async (req, res) => {
  const rfq = await loadRfq(req.params.id, currentUser(req));
  if (rfq.status !== RFQ_STATUS.PUBLISHED) throw ApiError.unprocessable(`RFQ is ${rfq.status}`);
  rfq.status = RFQ_STATUS.CLOSED;
  await rfq.save();
  await evaluateRfqBids(rfq._id);
  res.json(rfq);
});

export const cancelRfq = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadRfq(req.params.id, user);
  if (([RFQ_STATUS.AWARDED, RFQ_STATUS.CANCELLED] as string[]).includes(rfq.status)) {
    throw ApiError.unprocessable(`RFQ is ${rfq.status}`);
  }
  rfq.status = RFQ_STATUS.CANCELLED;
  await rfq.save();
  await Bid.updateMany({ rfq: rfq._id, status: BID_STATUS.SUBMITTED }, { status: BID_STATUS.REJECTED });
  // Release the requisitions back to the approved pool for re-sourcing.
  await PurchaseRequisition.updateMany(
    { rfq: rfq._id },
    {
      $set: { status: PR_STATUS.APPROVED },
      $unset: { rfq: 1 },
      $push: { history: { action: 'SOURCING_CANCELLED', by: oid(user.id), at: new Date() } },
    },
  );
  res.json(rfq);
});

/** Refuses a vendor who may not be given this RFQ: not approved, or missing a current licence. */
async function assertVendorCanBeAwarded(vendorId: unknown, rfq: RfqDocument): Promise<VendorDocument> {
  const vendor = await Vendor.findById(vendorId).select('status companyName documents');
  if (vendor?.status !== VENDOR_STATUS.APPROVED) {
    throw ApiError.unprocessable(`${vendor?.companyName ?? 'This vendor'} is ${vendor?.status ?? 'missing'} and cannot be awarded`);
  }
  const issues = licenceIssues(vendor, rfq.requiredLicences);
  if (issues.length) throw ApiError.unprocessable(`${vendor.companyName} cannot be awarded: ${issues.join('; ')}`);
  return vendor;
}

/** How the chosen quote compares with what the requisitions committed, and whether the rest of the budget can cover it. */
async function budgetCheck(rfq: RfqDocument, bid: BidDocument) {
  const estimate = await requisitionEstimate(rfq.requisitions);
  const department = await Department.findById(rfq.department).select('budget name');
  if (!department) throw ApiError.notFound('Department');
  const overrun = round2(bid.totalAmount - estimate);
  const available = round2(department.budget.allocated - department.budget.committed);
  return { estimate, quote: bid.totalAmount, overrun, available, shortfall: round2(Math.max(overrun - available, 0)), department: department.name };
}

/**
 * Awards the RFQ and generates its PO. Awarding to a non-L1 (rank != 1) bid requires a written
 * justification. Everything that could block the PO is checked before anything changes; if storing
 * the PO still fails, the award stands and the response says so, so it can be retried from the bid.
 *
 * The budget commitment moves from the PR estimates to the awarded value. A quote above the estimate
 * needs a written acknowledgement (409 BUDGET_OVERRUN), and one beyond what is left of the budget is
 * refused (422 BUDGET_EXCEEDED) until Finance approves an escalation.
 */
export const awardRfq = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadRfq(req.params.id, user);
  if (rfq.status === RFQ_STATUS.PUBLISHED && new Date() >= rfq.closeAt) {
    rfq.status = RFQ_STATUS.CLOSED;
  }
  // Procurement can select a vendor as soon as bids arrive. Selecting while bidding is open closes it for every vendor.
  if (rfq.status !== RFQ_STATUS.CLOSED && rfq.status !== RFQ_STATUS.PUBLISHED) {
    throw ApiError.unprocessable(`RFQ is ${rfq.status}`);
  }
  const closesBiddingNow = isBiddingOpen(rfq);

  await evaluateRfqBids(rfq._id);
  const bid = await Bid.findOne({ _id: req.body.bidId, rfq: rfq._id, status: BID_STATUS.SUBMITTED });
  if (!bid) throw ApiError.notFound('Bid on this RFQ');
  if (bid.rank !== 1 && !req.body.justification) {
    throw ApiError.unprocessable('A written justification is required when awarding to a vendor other than L1');
  }
  await assertVendorCanBeAwarded(bid.vendor, rfq);
  const prepared = await preparePoFromBid(bid, rfq, { taxRate: req.body.taxRate });

  const budget = await budgetCheck(rfq, bid);
  if (budget.shortfall > 0) {
    throw ApiError.unprocessable(
      `This quote is ${budget.overrun} over the requisition estimate and ${budget.shortfall} beyond what is left of the ${budget.department} budget. Escalate it to Finance.`,
      { code: 'BUDGET_EXCEEDED', ...budget, escalation: rfq.budgetEscalation?.status },
    );
  }
  if (budget.overrun > 0 && !req.body.overrunReason) {
    throw ApiError.conflict(`This quote is ${budget.overrun} over the requisition estimate. Give a reason to proceed.`, { code: 'BUDGET_OVERRUN', ...budget });
  }
  if (!(await adjustCommitment(rfq.department, budget.overrun))) {
    throw ApiError.conflict('The department budget changed while selecting this vendor; please retry');
  }

  // Claimed in one atomic update so that two simultaneous awards cannot both succeed.
  const awarded = await RFQ.findOneAndUpdate(
    { _id: rfq._id, status: { $in: [RFQ_STATUS.PUBLISHED, RFQ_STATUS.CLOSED] } },
    {
      $set: {
        status: RFQ_STATUS.AWARDED,
        awardedBid: bid._id,
        awardJustification: req.body.justification,
        awardedBy: oid(user.id),
        awardedAt: new Date(),
        ...(closesBiddingNow && { closeAt: new Date() }),
        budgetVariance: budget.overrun,
        overrunReason: budget.overrun > 0 ? req.body.overrunReason : undefined,
      },
    },
    { new: true },
  );
  if (!awarded) {
    await adjustCommitment(rfq.department, -budget.overrun);
    throw ApiError.conflict('This RFQ has already been awarded or cancelled');
  }

  bid.status = BID_STATUS.AWARDED;
  await bid.save();
  await Bid.updateMany({ rfq: rfq._id, _id: { $ne: bid._id }, status: BID_STATUS.SUBMITTED }, { status: BID_STATUS.REJECTED });

  try {
    const po = await createPoFromBid(bid, awarded, user, prepared);
    res.json({ rfq: awarded, bid, po });
  } catch (err) {
    console.error(`[sourcing] ${awarded.rfqNumber} awarded but PO creation failed:`, err);
    res.json({ rfq: awarded, bid, poError: 'The award is saved but the PO could not be created. Use Create PO to retry.' });
  }
});

// ---- Budget escalation --------------------------------------------------------------

/** Procurement asks Finance to cover a quote that does not fit what is left of the department budget. */
export const requestBudgetEscalation = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadRfq(req.params.id, user);
  if (rfq.status === RFQ_STATUS.AWARDED || rfq.status === RFQ_STATUS.CANCELLED) throw ApiError.unprocessable(`RFQ is ${rfq.status}`);
  if (rfq.budgetEscalation?.status === ESCALATION_STATUS.PENDING) throw ApiError.conflict('An escalation is already waiting on Finance');

  const bid = await Bid.findOne({ _id: req.body.bidId, rfq: rfq._id, status: BID_STATUS.SUBMITTED });
  if (!bid) throw ApiError.notFound('Bid on this RFQ');
  const budget = await budgetCheck(rfq, bid);
  if (budget.shortfall <= 0) throw ApiError.unprocessable('This quote fits the remaining budget, so it needs no escalation');

  rfq.budgetEscalation = {
    status: ESCALATION_STATUS.PENDING,
    bid: bid._id,
    overrun: budget.overrun,
    shortfall: budget.shortfall,
    reason: req.body.reason,
    requestedBy: oid(user.id),
    requestedAt: new Date(),
  };
  await rfq.save();
  res.status(201).json(rfq);
});

/** Finance approves by raising the allocation by the current shortfall, or refuses. */
export const decideBudgetEscalation = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadRfq(req.params.id, user);
  const escalation = rfq.budgetEscalation;
  if (escalation?.status !== ESCALATION_STATUS.PENDING) throw ApiError.unprocessable('No escalation is waiting on this RFQ');
  if (escalation.requestedBy.toString() === user.id) {
    throw ApiError.forbidden('Segregation of duties: you cannot decide an escalation you raised');
  }

  // Claimed first, so that two simultaneous approvals cannot both raise the budget.
  const approved = req.body.decision === 'APPROVE';
  const claimed = await RFQ.findOneAndUpdate(
    { _id: rfq._id, 'budgetEscalation.status': ESCALATION_STATUS.PENDING },
    {
      $set: {
        'budgetEscalation.status': approved ? ESCALATION_STATUS.APPROVED : ESCALATION_STATUS.REJECTED,
        'budgetEscalation.decidedBy': oid(user.id),
        'budgetEscalation.decidedAt': new Date(),
        'budgetEscalation.remarks': req.body.remarks,
      },
    },
    { new: true },
  );
  if (!claimed) throw ApiError.conflict('This escalation has already been decided');

  if (approved) {
    const bid = await Bid.findById(escalation.bid);
    if (!bid) throw ApiError.notFound('Bid');
    const { shortfall } = await budgetCheck(rfq, bid);
    if (shortfall > 0) await Department.updateOne({ _id: rfq.department }, { $inc: { 'budget.allocated': shortfall } });
  }
  res.json(claimed);
});

// ---- Emergency purchase --------------------------------------------------------------

/**
 * Buys an approved emergency PR directly from one approved vendor, up to the cap. It still leaves a
 * full record: an RFQ and a bid created as already awarded, and a PO that Finance must ratify before payment.
 */
export const emergencyPurchase = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { requisitionId, vendorId, prices, justification, taxRate } = req.body;

  const pr = await PurchaseRequisition.findOne({ _id: requisitionId, status: PR_STATUS.APPROVED, isEmergency: true });
  if (!pr) throw ApiError.unprocessable('Only an approved emergency requisition can use this route');

  const rfqId = new Types.ObjectId();
  const priced = pr.items.map((item) => ({ item, unitPrice: prices[item._id.toString()] as number | undefined }));
  if (priced.some((p) => p.unitPrice === undefined)) throw ApiError.unprocessable('Enter a unit price for every line');
  const lines = priced.map((p) => ({ quantity: p.item.quantity, unitPrice: p.unitPrice!, taxRate }));
  const value = calcOrderTotals(lines).subtotal;
  if (value > env.emergencyPoCap) {
    throw ApiError.unprocessable(`An emergency purchase is capped at ${env.emergencyPoCap} before tax; this one is ${value}. Run an RFQ instead.`);
  }

  const rfq = new RFQ({
    _id: rfqId,
    rfqNumber: await nextDocNumber('RFQ'),
    title: `Emergency: ${pr.title}`,
    description: justification,
    department: pr.department,
    requisitions: [pr._id],
    items: pr.items.map((i) => ({
      itemCode: i.itemCode,
      title: i.title,
      description: i.description,
      quantity: i.quantity,
      uom: i.uom,
      specifications: i.category,
      itemType: i.itemType,
      sourcePr: pr._id,
      sourcePrItem: i._id,
    })),
    invitedVendors: [vendorId],
    openAt: new Date(Date.now() - 1000),
    closeAt: new Date(),
    createdBy: user.id,
    isEmergency: true,
    status: RFQ_STATUS.CLOSED,
  });

  await assertVendorCanBeAwarded(vendorId, rfq);

  const bid = new Bid({
    rfq: rfqId,
    vendor: vendorId,
    items: rfq.items.map((i, index) => ({ rfqItem: i._id, quantity: i.quantity, unitPrice: priced[index].unitPrice, taxRate })),
    deliveryDays: req.body.deliveryDays,
    submittedBy: user.id,
    status: BID_STATUS.AWARDED,
    rank: 1,
    notes: 'Emergency purchase: single direct quote',
  });
  await bid.validate();

  const estimate = pr.totalEstimate;
  const variance = round2(value - estimate);
  if (!(await adjustCommitment(pr.department, variance))) {
    throw ApiError.unprocessable('This purchase is beyond what is left of the department budget');
  }

  // Claimed in one update, so that the requisition cannot be bought twice.
  const claimed = await PurchaseRequisition.findOneAndUpdate(
    { _id: pr._id, status: PR_STATUS.APPROVED, 'ratification.status': { $exists: false } },
    {
      $set: { status: PR_STATUS.SOURCING, rfq: rfqId, 'ratification.status': RATIFICATION_STATUS.PENDING },
      $push: { history: { action: 'EMERGENCY_PURCHASE', by: oid(user.id), at: new Date(), remarks: justification } },
    },
    { new: true },
  );
  if (!claimed) {
    await adjustCommitment(pr.department, -variance);
    throw ApiError.conflict('This requisition is already being bought');
  }

  rfq.status = RFQ_STATUS.AWARDED;
  rfq.awardedBid = bid._id;
  rfq.awardedBy = oid(user.id);
  rfq.awardedAt = new Date();
  rfq.awardJustification = justification;
  rfq.budgetVariance = variance;
  await rfq.save();
  await bid.save();

  const prepared = await preparePoFromBid(bid, rfq, {});
  const po = await createPoFromBid(bid, rfq, user, { ...prepared, approvals: [] });
  res.status(201).json({ rfq, bid, po });
});

// ---- Bids --------------------------------------------------------------------------

/** Vendor submits or revises their bid while the RFQ is open. Other vendors never see it. */
export const submitBid = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadRfq(req.params.id, user);
  if (!isBiddingOpen(rfq)) throw ApiError.unprocessable('Bidding is not open for this RFQ');

  const vendor = await Vendor.findById(user.vendor);
  if (!vendor || vendor.status !== VENDOR_STATUS.APPROVED) {
    throw ApiError.forbidden('Only approved vendors can bid');
  }
  const issues = licenceIssues(vendor, rfq.requiredLicences);
  if (issues.length) throw ApiError.forbidden(`Action locked: ${issues.join('; ')}. Update your documents under Company Profile.`);

  const priced = new Map<string, number>(
    req.body.items.map((i: { rfqItemId: string; unitPrice: number }) => [i.rfqItemId, i.unitPrice]),
  );
  const taxRates = new Map<string, number>(
    req.body.items.map((i: { rfqItemId: string; taxRate: number }) => [i.rfqItemId, i.taxRate]),
  );
  const missing = rfq.items.filter((i) => !priced.has(i._id.toString()));
  if (missing.length || priced.size !== rfq.items.length) {
    throw ApiError.unprocessable('Quote a unit price for every RFQ line (and only RFQ lines)', {
      missing: missing.map((i) => i.description),
    });
  }
  const items = rfq.items.map((i) => ({
    rfqItem: i._id,
    quantity: i.quantity,
    unitPrice: priced.get(i._id.toString())!,
    taxRate: taxRates.get(i._id.toString())!,
  }));

  let bid = await Bid.findOne({ rfq: rfq._id, vendor: vendor._id });
  if (bid) {
    bid.set({
      items,
      deliveryDays: req.body.deliveryDays,
      validityDays: req.body.validityDays,
      notes: req.body.notes,
      status: BID_STATUS.SUBMITTED,
      revision: bid.revision + 1,
      submittedBy: user.id,
      submittedAt: new Date(),
    });
    await bid.save();
  } else {
    bid = await Bid.create({
      rfq: rfq._id,
      vendor: vendor._id,
      items,
      deliveryDays: req.body.deliveryDays,
      validityDays: req.body.validityDays,
      notes: req.body.notes,
      submittedBy: user.id,
    });
  }

  await evaluateRfqBids(rfq._id);
  res.status(201).json(await Bid.findById(bid._id).select(VENDOR_BID_FIELDS));
});

export const withdrawBid = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const bid = await Bid.findOne({ _id: req.params.bidId, vendor: user.vendor });
  if (!bid) throw ApiError.notFound('Bid');
  const rfq = await RFQ.findById(bid.rfq);
  if (!rfq || !isBiddingOpen(rfq)) throw ApiError.unprocessable('Bids can only be withdrawn while bidding is open');
  if (bid.status !== BID_STATUS.SUBMITTED) throw ApiError.unprocessable(`Bid is ${bid.status}`);

  bid.status = BID_STATUS.WITHDRAWN;
  await bid.save();
  await evaluateRfqBids(rfq._id);
  res.json(await Bid.findById(bid._id).select(VENDOR_BID_FIELDS));
});

/**
 * Procurement sees every bid, fully scored and ranked.
 * Vendors see only their own bid (sealed bidding: no competitor prices), plus their rank and the
 * bid count while bidding is open. Neither is shown afterwards, when they could hint at the outcome.
 */
export const listRfqBids = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadRfq(req.params.id, user);

  if (isVendor(user)) {
    const own = await Bid.findOne({ rfq: rfq._id, vendor: user.vendor }).select(VENDOR_BID_FIELDS);
    if (!isBiddingOpen(rfq)) return res.json({ bid: own && closedBidView(own) });
    const totalBids = await Bid.countDocuments({ rfq: rfq._id, status: { $ne: BID_STATUS.WITHDRAWN } });
    return res.json({ bid: own, totalBids });
  }

  const bids = await Bid.find({ rfq: rfq._id })
    .populate('vendor', 'companyName contactPerson vendorCode rating isMsme')
    .sort({ status: 1, rank: 1 });

  // Every bid and its prices, from the moment it is submitted.
  res.json(
    bids.map((bid) => {
      const { items, ...rest } = bid.toObject();
      const lines = items.map((line) => {
        const rfqItem = rfq.items.find((i) => i._id.equals(line.rfqItem));
        return {
          _id: line._id,
          rfqItem: line.rfqItem,
          quantity: line.quantity,
          title: rfqItem?.title,
          description: rfqItem?.description,
          uom: rfqItem?.uom,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          lineTotal: line.lineTotal,
        };
      });
      return { ...rest, items: lines };
    }),
  );
});

export const setQualityScore = asyncHandler(async (req, res) => {
  const bid = await Bid.findById(req.params.bidId);
  if (!bid) throw ApiError.notFound('Bid');
  if (bid.status !== BID_STATUS.SUBMITTED) throw ApiError.unprocessable(`Bid is ${bid.status}`);
  bid.qualityScore = req.body.qualityScore;
  await bid.save();
  await evaluateRfqBids(bid.rfq);
  res.json(await Bid.findById(bid._id));
});

// ---- Live bidding dashboard ---------------------------------------------------------

export const biddingDashboard = asyncHandler(async (_req, res) => {
  const now = new Date();
  const rfqs = await RFQ.find({ status: { $in: [RFQ_STATUS.PUBLISHED, RFQ_STATUS.CLOSED, RFQ_STATUS.AWARDED] } })
    .sort({ closeAt: 1 })
    .lean();

  const bids = await Bid.find({ rfq: { $in: rfqs.map((r) => r._id) }, status: { $ne: BID_STATUS.WITHDRAWN } })
    .populate<{ vendor: { _id: Types.ObjectId; companyName: string; vendorCode: string } }>('vendor', 'companyName vendorCode')
    .lean();

  const byRfq = new Map<string, typeof bids>();
  for (const bid of bids) {
    const key = bid.rfq.toString();
    byRfq.set(key, [...(byRfq.get(key) ?? []), bid]);
  }

  const rows = rfqs.map((rfq) => {
    const rfqBids = byRfq.get(rfq._id.toString()) ?? [];
    const pricedBids = rfqBids;
    const top = pricedBids.find((b) => b.status === BID_STATUS.AWARDED) ?? pricedBids.find((b) => b.rank === 1);
    const isLive = rfq.status === RFQ_STATUS.PUBLISHED && now >= rfq.openAt && now < rfq.closeAt;
    return {
      rfqId: rfq._id,
      rfqNumber: rfq.rfqNumber,
      title: rfq.title,
      status: isLive ? 'LIVE' : rfq.status === RFQ_STATUS.PUBLISHED ? 'AWAITING_CLOSE' : rfq.status,
      isLive,
      closeAt: rfq.closeAt,
      timeRemainingMs: isLive ? rfq.closeAt.getTime() - now.getTime() : 0,
      totalBids: rfqBids.length,
      items: rfq.items.map((i) => `${i.title?.trim() || i.description} × ${i.quantity} ${i.uom}`),
      lowestBid: pricedBids.length ? Math.min(...pricedBids.map((b) => b.totalAmount)) : null,
      rankings: pricedBids
        .filter((b) => b.rank)
        .sort((a, b) => a.rank! - b.rank!)
        .map((b) => ({ rank: b.rank, companyName: b.vendor.companyName, totalAmount: b.totalAmount })),
      topVendor: top
        ? {
            vendorId: top.vendor._id,
            companyName: top.vendor.companyName,
            vendorCode: top.vendor.vendorCode,
            totalAmount: top.totalAmount,
            taxAmount: top.taxAmount,
            grandTotal: top.grandTotal,
            rank: top.rank,
            awarded: top.status === BID_STATUS.AWARDED,
          }
        : null,
    };
  });

  res.json({
    summary: {
      liveRfqs: rows.filter((r) => r.isLive).length,
      awaitingAward: rows.filter((r) => r.status === RFQ_STATUS.CLOSED || r.status === 'AWAITING_CLOSE').length,
      awarded: rows.filter((r) => r.status === RFQ_STATUS.AWARDED).length,
      totalBids: bids.length,
    },
    rfqs: rows,
  });
});

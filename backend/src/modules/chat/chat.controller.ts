import { FilterQuery, Types } from 'mongoose';
import { ROLES } from '../../constants/roles';
import { currentUser } from '../../middleware/auth';
import { Bid } from '../../models/Bid';
import { IPrMessage, PrMessage } from '../../models/PrMessage';
import { PurchaseRequisition } from '../../models/PurchaseRequisition';
import { RFQ, RfqDocument } from '../../models/RFQ';
import { Vendor } from '../../models/Vendor';
import { VENDOR_THREAD_ROLES, markRead, messageView, unreadBy } from '../../services/chat.service';
import { vendorRfqScope } from '../../services/vendorRfq.service';
import { AuthUser } from '../../types/auth';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { oid } from '../../utils/objectId';
import { chatScope } from '../requisition/requisition.controller';

const countBy = async (match: FilterQuery<IPrMessage>, field: 'pr' | 'rfq') => {
  const rows = await PrMessage.aggregate<{ _id: Types.ObjectId; unread: number }>([{ $match: match }, { $group: { _id: `$${field}`, unread: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id.toString(), r.unread]));
};

/**
 * The caller's unread messages, for the badge on each journey card: per PR conversation they take part
 * in, and per RFQ for their vendor conversations. Messages they sent never count, and each counts once.
 */
export const unreadCounts = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const unread = unreadBy(user);

  const scope = await chatScope(user);
  const prIds = scope ? await PurchaseRequisition.find(scope).distinct('_id') : [];
  const prs = prIds.length ? await countBy({ ...unread, pr: { $in: prIds } }, 'pr') : {};

  const vendorThreads: FilterQuery<IPrMessage> | null =
    user.role === ROLES.VENDOR ? { vendor: oid(user.vendor ?? '') } : VENDOR_THREAD_ROLES.includes(user.role) ? { vendor: { $exists: true } } : null;
  const rfqs = vendorThreads ? await countBy({ ...unread, ...vendorThreads, rfq: { $exists: true } }, 'rfq') : {};

  res.json({ prs, rfqs });
});

/** The RFQ, if the caller may talk about it: a vendor who can see it, or a role that deals with vendors. */
async function loadThreadRfq(id: string, user: AuthUser): Promise<RfqDocument> {
  if (user.role !== ROLES.VENDOR && !VENDOR_THREAD_ROLES.includes(user.role)) {
    throw ApiError.forbidden('Vendor conversations are handled by Procurement');
  }
  const scope = user.role === ROLES.VENDOR ? vendorRfqScope(user) : {};
  const rfq = await RFQ.findOne({ $and: [{ _id: id }, scope] });
  if (!rfq) throw ApiError.notFound('RFQ');
  return rfq;
}

/** Vendors Procurement can talk to on an RFQ: those invited, those who bid, and any already in a conversation. */
async function participants(rfq: RfqDocument): Promise<string[]> {
  const [bidders, talked] = await Promise.all([
    Bid.find({ rfq: rfq._id }).distinct('vendor'),
    PrMessage.find({ rfq: rfq._id, vendor: { $exists: true } }).distinct('vendor'),
  ]);
  return [...new Set([...rfq.invitedVendors, ...bidders, ...talked].map(String))];
}

/** The vendor whose conversation this is: the caller's own company, or one Procurement names that is part of the RFQ. */
async function threadVendor(rfq: RfqDocument, user: AuthUser, named?: string): Promise<Types.ObjectId> {
  if (user.role === ROLES.VENDOR) return oid(user.vendor ?? '');
  if (!named || !(await participants(rfq)).includes(named)) throw ApiError.notFound('Vendor conversation');
  return oid(named);
}

/** For Procurement, Admin and the Auditor: every vendor conversation on an RFQ, with the caller's unread count in each. */
export const listVendorThreads = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  if (user.role === ROLES.VENDOR) throw ApiError.forbidden('A vendor sees only their own conversation');
  const rfq = await loadThreadRfq(req.params.rfqId, user);
  const ids = await participants(rfq);
  const [vendors, unread, latest] = await Promise.all([
    Vendor.find({ _id: { $in: ids } }).select('companyName'),
    PrMessage.aggregate<{ _id: Types.ObjectId; unread: number }>([
      { $match: { rfq: rfq._id, vendor: { $exists: true }, ...unreadBy(user) } },
      { $group: { _id: '$vendor', unread: { $sum: 1 } } },
    ]),
    PrMessage.aggregate<{ _id: Types.ObjectId; at: Date }>([
      { $match: { rfq: rfq._id, vendor: { $exists: true } } },
      { $group: { _id: '$vendor', at: { $max: '$createdAt' } } },
    ]),
  ]);
  const unreadOf = new Map(unread.map((u) => [u._id.toString(), u.unread]));
  const latestOf = new Map(latest.map((l) => [l._id.toString(), l.at]));
  res.json(
    vendors
      .map((v) => ({ vendorId: v._id, companyName: v.companyName, unread: unreadOf.get(v._id.toString()) ?? 0, lastMessageAt: latestOf.get(v._id.toString()) }))
      .sort((a, b) => b.unread - a.unread || a.companyName.localeCompare(b.companyName)),
  );
});

/** One vendor's conversation on an RFQ. Reading it marks the others' messages read for the reader alone. */
export const listVendorMessages = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadThreadRfq(req.params.rfqId, user);
  const thread = { rfq: rfq._id, vendor: await threadVendor(rfq, user, req.params.vendorId) };
  await markRead(thread, user);
  const messages = await PrMessage.find(thread).sort({ createdAt: 1 });
  res.json(messages.map((m) => messageView(m, user)));
});

export const postVendorMessage = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const rfq = await loadThreadRfq(req.params.rfqId, user);
  const vendor = await threadVendor(rfq, user, req.params.vendorId);
  const message = await PrMessage.create({ rfq: rfq._id, vendor, sender: user.id, senderName: user.name, senderRole: user.role, text: req.body.text });
  res.status(201).json(messageView(message, user));
});

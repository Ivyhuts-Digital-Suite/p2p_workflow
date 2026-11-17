import { FilterQuery } from 'mongoose';
import { ROLES } from '../constants/roles';
import { IPrMessage, PrMessage, PrMessageDocument } from '../models/PrMessage';
import { AuthUser } from '../types/auth';
import { oid } from '../utils/objectId';

/** Roles that talk to vendors on an RFQ. The Auditor reads these conversations but cannot write. */
export const VENDOR_THREAD_ROLES: string[] = [ROLES.PROCUREMENT, ROLES.ADMIN, ROLES.AUDITOR];

/** What a vendor sees instead of a staff member's name: the team, never the person. */
const BUYER_TEAM: Record<string, string> = {
  REQUESTER: 'Requesting department',
  HOD: 'Head of Department',
  PROCUREMENT: 'Procurement',
  STORE: 'Store',
  FINANCE: 'Finance',
  ADMIN: 'Administration',
  AUDITOR: 'Audit',
};

/**
 * One message as the viewer may see it. An auditor's reading only clears their own unread count, so it
 * never shows as a read receipt. A vendor sees the buyer's team, never a staff member's name.
 */
export function messageView(m: PrMessageDocument, viewer: AuthUser) {
  const forVendor = viewer.role === ROLES.VENDOR;
  const nameFor = (name: string, role?: string) => (forVendor && role !== ROLES.VENDOR ? BUYER_TEAM[role ?? ''] ?? 'Buyer' : name);
  return {
    _id: m._id,
    sender: m.sender,
    senderName: nameFor(m.senderName, m.senderRole),
    senderRole: m.senderRole,
    text: m.text,
    createdAt: m.createdAt,
    readBy: m.readBy.filter((r) => r.role !== ROLES.AUDITOR).map((r) => ({ user: r.user, name: nameFor(r.name, r.role), at: r.at })),
  };
}

/** Marks every message in a conversation read for this user alone: messages from others, once each. */
export async function markRead(thread: FilterQuery<IPrMessage>, user: AuthUser) {
  await PrMessage.updateMany(
    { ...thread, sender: { $ne: oid(user.id) }, 'readBy.user': { $ne: oid(user.id) } },
    { $push: { readBy: { user: oid(user.id), name: user.name, at: new Date(), role: user.role } } },
  );
}

/** Messages this user has not read: sent by someone else, with no read entry of theirs. */
export const unreadBy = (user: AuthUser): FilterQuery<IPrMessage> => ({ sender: { $ne: oid(user.id) }, 'readBy.user': { $ne: oid(user.id) } });

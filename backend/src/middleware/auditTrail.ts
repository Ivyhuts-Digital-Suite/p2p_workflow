import { RequestHandler } from 'express';
import { AuditLog } from '../models/AuditLog';

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const OBJECT_ID = /^[a-f\d]{24}$/i;
const DOC_REF_FIELDS = ['prNumber', 'rfqNumber', 'poNumber', 'grnNumber', 'internalRef', 'paymentRef', 'vendorCode'];

/** Finds the business document number in a response, including wrapped ones like { rfq, bid }. */
function findDocRef(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const doc = body as Record<string, unknown>;
  for (const field of DOC_REF_FIELDS) {
    if (typeof doc[field] === 'string') return doc[field];
  }
  return findDocRef(doc.rfq) ?? findDocRef(doc.payment) ?? findDocRef(doc.invoice);
}

/**
 * Records every state-changing API call, allowed or refused, in the audit trail.
 * Only the actor, target and written remarks are stored: never the body, so never a password.
 */
export const auditTrail: RequestHandler = (req, res, next) => {
  if (READ_METHODS.includes(req.method)) return next();

  let docRef: string | undefined;
  const json = res.json.bind(res);
  res.json = (body) => {
    docRef = findDocRef(body);
    return json(body);
  };

  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const remarks = body.justification ?? body.reason ?? body.remarks ?? body.qcRemarks;

    AuditLog.create({
      actor: req.user?.id,
      actorEmail: req.user?.email ?? (typeof body.email === 'string' ? body.email.toLowerCase() : undefined),
      actorRole: req.user?.role,
      module: segments[0] ?? 'unknown',
      action: segments.slice(1).filter((s) => !OBJECT_ID.test(s)).join('.') || (req.method === 'POST' ? 'create' : 'update'),
      method: req.method,
      path,
      entityId: segments.find((s) => OBJECT_ID.test(s)),
      docRef,
      statusCode: res.statusCode,
      success: res.statusCode < 400,
      remarks: typeof remarks === 'string' ? remarks : undefined,
    }).catch((err) => console.error('[audit] failed to record', path, err));
  });
  next();
};

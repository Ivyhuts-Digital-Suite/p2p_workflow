import { Schema, Types, model } from 'mongoose';

export interface IAuditLog {
  at: Date;
  actor?: Types.ObjectId;
  /** Kept as text so failed logins and later account changes stay readable */
  actorEmail?: string;
  actorRole?: string;
  module: string;
  action: string;
  method: string;
  path: string;
  entityId?: string;
  /** Business document number, e.g. PO-2026-00001 */
  docRef?: string;
  statusCode: number;
  success: boolean;
  /** Remarks, reason or justification entered with the action */
  remarks?: string;
}

const auditLogSchema = new Schema<IAuditLog>({
  at: { type: Date, default: Date.now, index: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  actorEmail: String,
  actorRole: String,
  module: { type: String, required: true, index: true },
  action: { type: String, required: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  entityId: String,
  docRef: String,
  statusCode: { type: Number, required: true },
  success: { type: Boolean, required: true },
  remarks: String,
});

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);

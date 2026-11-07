import bcrypt from 'bcryptjs';
import { HydratedDocument, Model, Schema, Types, model } from 'mongoose';
import { ALL_ROLES, MASTER_ROLES, ROLES, Role } from '../constants/roles';

export interface IUser {
  name: string;
  email: string;
  password: string;
  role: Role;
  /** Internal users belong to a department (drives PR scope and HOD authority) */
  department?: Types.ObjectId;
  /** Vendor portal users are linked to their vendor record */
  vendor?: Types.ObjectId;
  /** Delegation of Authority: maximum document value this user may give final approval for */
  doaLimit: number;
  isActive: boolean;
  lastLoginAt?: Date;
}

interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

type UserModel = Model<IUser, object, IUserMethods>;
export type UserDocument = HydratedDocument<IUser, IUserMethods>;

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ALL_ROLES, required: true, default: ROLES.REQUESTER },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    doaLimit: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const { password: _password, __v, ...rest } = ret;
        return rest;
      },
    },
  },
);

// Single Master Account Policy, enforced by the database so concurrent sign-ups cannot both succeed.
userSchema.index(
  { role: 1 },
  { unique: true, name: 'single_master_account', partialFilterExpression: { role: { $in: MASTER_ROLES } } },
);
userSchema.index(
  { role: 1, department: 1 },
  { unique: true, name: 'single_hod_per_department', partialFilterExpression: { role: ROLES.HOD } },
);

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (this: UserDocument, candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

export const User = model<IUser, UserModel>('User', userSchema);

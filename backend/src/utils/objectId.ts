import { Types } from 'mongoose';

export const oid = (id: string | Types.ObjectId) => new Types.ObjectId(id);

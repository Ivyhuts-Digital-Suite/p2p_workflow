import { Role } from '../constants/roles';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  department?: string;
  vendor?: string;
  doaLimit: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

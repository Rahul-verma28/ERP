import type { ConsoleRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      /** The signed-in Console person (set by requireStaff) */
      staff?: { id: string; role: ConsoleRole; partnerId: string | null; sessionId: string };
      rawBody?: Buffer;
    }
  }
}
export {};

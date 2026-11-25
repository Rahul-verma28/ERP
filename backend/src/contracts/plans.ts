// The limits a licence carries. The Console owns plans and prices; the ERP only enforces these.

export interface PlanLimits {
  users: number;
  branches: number;
  contacts: number | null; // null = unlimited
  items: number | null;
  invoicesPerMonth: number | null;
  storageMb: number;
  aiCredits: number;
}

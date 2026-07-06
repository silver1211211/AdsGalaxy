export const MIN_CAMPAIGN_BUDGET = 10;

function requiredMoney(value: unknown, field: string) {
  const raw = String(value ?? "").trim();
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount)) throw new Error(`${field} is required`);
  return amount;
}

export function validateTotalBudget(value: unknown) {
  const amount = requiredMoney(value, "Total budget");
  if (amount < MIN_CAMPAIGN_BUDGET) {
    throw new Error(`Total budget must be at least $${MIN_CAMPAIGN_BUDGET}`);
  }
  return amount;
}

export function validateOptionalDailyBudget(value: unknown, totalBudget: number) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < MIN_CAMPAIGN_BUDGET) {
    throw new Error(`Daily budget must be at least $${MIN_CAMPAIGN_BUDGET} when provided`);
  }
  if (amount > totalBudget) throw new Error("Daily budget cannot exceed total budget");
  return amount;
}

export function budgetFlags(input: { remainingBudget: unknown; todaySpend: unknown; dailyBudget: unknown }) {
  const remainingBudget = Math.max(0, Number(input.remainingBudget) || 0);
  const todaySpend = Math.max(0, Number(input.todaySpend) || 0);
  const dailyBudget = Number(input.dailyBudget) || 0;
  return {
    budget_exhausted: remainingBudget <= 0,
    daily_cap_reached: dailyBudget > 0 && todaySpend >= dailyBudget,
  };
}

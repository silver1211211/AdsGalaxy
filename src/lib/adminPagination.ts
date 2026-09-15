export type AdminPaginationOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseAdminPagination(
  searchParams: URLSearchParams,
  options: AdminPaginationOptions = {}
) {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;
  const page = positiveInteger(searchParams.get("page"), 1);
  const requestedLimit = positiveInteger(searchParams.get("limit"), defaultLimit);
  const limit = Math.min(requestedLimit, maxLimit);

  return { page, limit, offset: (page - 1) * limit };
}

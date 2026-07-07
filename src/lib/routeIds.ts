export function parsePositiveIntegerId(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return null;

  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

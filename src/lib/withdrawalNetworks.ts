import { createHash } from "node:crypto";
export const WITHDRAWAL_NETWORKS = { "TRC-20": { fee: 2, family: "tron" }, "ERC-20": { fee: 1, family: "evm" }, "BEP-20": { fee: 0, family: "evm" } } as const;
export type WithdrawalNetwork = keyof typeof WITHDRAWAL_NETWORKS;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value: string) {
  let number = BigInt(0);
  for (const char of value) { const index = BASE58.indexOf(char); if (index < 0) return null; number = number * BigInt(58) + BigInt(index); }
  const bytes: number[] = [];
  while (number > 0) { bytes.unshift(Number(number % BigInt(256))); number /= BigInt(256); }
  for (const char of value) { if (char !== "1") break; bytes.unshift(0); }
  return Buffer.from(bytes);
}
function isValidTronAddress(address: string) {
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41 || decoded.subarray(1, 21).every((b) => b === 0)) return false;
  const checksum = createHash("sha256").update(createHash("sha256").update(decoded.subarray(0, 21)).digest()).digest().subarray(0, 4);
  return checksum.equals(decoded.subarray(21));
}
function isValidEvmAddress(address: string) { return /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address); }
export function validateWithdrawalDestination(networkValue: unknown, addressValue: unknown) {
  const network = String(networkValue || "").trim() as WithdrawalNetwork;
  const address = String(addressValue || "").trim();
  const config = WITHDRAWAL_NETWORKS[network];
  if (!config) return { ok: false as const, code: "UNSUPPORTED_WITHDRAWAL_NETWORK", message: "Unsupported withdrawal network" };
  const valid = config.family === "tron" ? isValidTronAddress(address) : isValidEvmAddress(address);
  if (!valid) return { ok: false as const, code: "INVALID_WITHDRAWAL_ADDRESS", message: `Invalid ${network} wallet address` };
  return { ok: true as const, network, address, fee: config.fee };
}
export function withdrawalRequestFingerprint(input: { amount: string; network: string; address: string }) { return createHash("sha256").update(`${input.amount}|${input.network}|${input.address}`).digest("hex"); }
export function hashUserIdempotencyKey(userId: number, key: string) { return createHash("sha256").update(`${userId}:${key}`).digest("hex"); }

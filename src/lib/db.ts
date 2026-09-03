import mysql from "mysql2/promise";

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

const connectionLimit = boundedInteger(process.env.DB_CONNECTION_LIMIT, 10, 2, 50);

export const DB_CONNECT_TIMEOUT_MS = boundedInteger(process.env.DB_CONNECT_TIMEOUT_MS, 8_000, 1_000, 30_000);
export const DB_QUERY_TIMEOUT_MS = boundedInteger(process.env.DB_QUERY_TIMEOUT_MS, 6_000, 1_000, 30_000);
export const DB_RETRY_ATTEMPTS = boundedInteger(process.env.DB_RETRY_ATTEMPTS, 3, 1, 5);

const globalForDb = globalThis as typeof globalThis & {
  adsGalaxyDbPool?: mysql.Pool;
};

const pool = globalForDb.adsGalaxyDbPool ?? mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit,
  maxIdle: connectionLimit,
  idleTimeout: boundedInteger(process.env.DB_IDLE_TIMEOUT_MS, 60_000, 10_000, 300_000),
  queueLimit: boundedInteger(process.env.DB_QUEUE_LIMIT, 100, 1, 1_000),
  connectTimeout: DB_CONNECT_TIMEOUT_MS,
  charset: "utf8mb4",
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

// Route chunks can evaluate this module independently in a production server.
// Always share one pool per process so traffic cannot multiply connection pools.
globalForDb.adsGalaxyDbPool = pool;

export default pool;

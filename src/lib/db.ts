import mysql from "mysql2/promise";

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
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.adsGalaxyDbPool = pool;
}

export default pool;

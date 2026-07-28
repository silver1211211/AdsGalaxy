import mysql from "mysql2/promise";

const rawUrl = process.env.ADSGALAXY_REWARD_TEST_DATABASE_URL || "";
if (!rawUrl) throw new Error("ADSGALAXY_REWARD_TEST_DATABASE_URL is required for production-service integration tests");
const parsed = new URL(rawUrl);
const database = parsed.pathname.replace(/^\//, "");
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) || database !== "adsgalaxy_reward_test") {
  throw new Error("Unsafe reward callback test database");
}

const pool = mysql.createPool({ uri: rawUrl, connectionLimit: 12 });
export default pool;

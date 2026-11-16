import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: fs.existsSync(".env.production") ? ".env.production" : ".env", quiet: true });

const TEST_SCHEMA = "adsfusion_teaser_test_20260910";
const TRIGGERS = [
  "trg_publisher_balance_opened",
  "trg_publisher_balance_changed",
  "trg_publisher_balance_events_no_update",
  "trg_publisher_balance_events_no_delete",
];

test("ordinary balance events capture exact atomic deltas and reject edits in isolated MariaDB", async () => {
  assert.equal(process.env.FINANCIAL_EVENT_TEST_SCHEMA, TEST_SCHEMA, "explicit isolated schema opt-in required");
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: TEST_SCHEMA,
    multipleStatements: true,
  });
  let created = false;
  try {
    const [[identity]] = await db.query("SELECT DATABASE() schema_name");
    assert.equal(identity.schema_name, TEST_SCHEMA);
    const [existing] = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?,?)",
      ["users", "publisher_balance_events"]
    );
    assert.equal(existing.length, 0, "isolated schema must be empty");
    await db.query(
      "CREATE TABLE users (id INT NOT NULL PRIMARY KEY,balance_available DECIMAL(18,8) NOT NULL DEFAULT 0,balance_locked DECIMAL(18,8) NOT NULL DEFAULT 0) ENGINE=InnoDB"
    );
    created = true;
    const migration = fs.readFileSync("db/migrations/20261101_0800_publisher_balance_events.sql", "utf8");
    await db.query(migration);
    await db.query(migration);

    await db.query("INSERT INTO users (id) VALUES (1)");
    await db.query("UPDATE users SET balance_available=balance_available+? WHERE id=1", ["2.00000000"]);
    await db.query(
      "SET @adsgalaxy_financial_source_key=?,@adsgalaxy_financial_source_system=?,@adsgalaxy_financial_source_record_id=?,@adsgalaxy_financial_policy_version=?",
      ["test:transfer:1", "test", "1", "test-v1"]
    );
    await db.query(
      "UPDATE users SET balance_available=balance_available-?,balance_locked=balance_locked+? WHERE id=1",
      ["1.00000000", "1.00000000"]
    );
    await db.query(
      "SET @adsgalaxy_financial_source_key=NULL,@adsgalaxy_financial_source_system=NULL,@adsgalaxy_financial_source_record_id=NULL,@adsgalaxy_financial_policy_version=NULL"
    );
    const [events] = await db.query(
      "SELECT event_kind,source_event_key,delta_available,delta_locked,available_after,locked_after FROM publisher_balance_events ORDER BY id"
    );
    assert.equal(events.length, 3);
    assert.deepEqual(events.map((e) => [e.delta_available, e.delta_locked]), [
      ["0.00000000", "0.00000000"],
      ["2.00000000", "0.00000000"],
      ["-1.00000000", "1.00000000"],
    ]);
    assert.equal(events[0].source_event_key, "account_opened:1");
    assert.equal(events[2].source_event_key, "test:transfer:1");
    assert.equal(events[2].available_after, "1.00000000");
    assert.equal(events[2].locked_after, "1.00000000");

    await db.beginTransaction();
    await db.query("UPDATE users SET balance_available=balance_available+1 WHERE id=1");
    await db.rollback();
    const [[afterRollback]] = await db.query("SELECT COUNT(*) n FROM publisher_balance_events");
    assert.equal(afterRollback.n, 3, "rolled-back balance updates must not leave events");

    await db.query("SET @adsgalaxy_financial_source_key=?", ["test:transfer:1"]);
    await assert.rejects(
      db.query("UPDATE users SET balance_available=balance_available+1 WHERE id=1"),
      /ER_DUP_ENTRY|Duplicate entry/
    );
    await db.query("SET @adsgalaxy_financial_source_key=NULL");
    const [[balance]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=1");
    assert.equal(balance.balance_available, "1.00000000");
    assert.equal(balance.balance_locked, "1.00000000");
    await assert.rejects(db.query("UPDATE publisher_balance_events SET event_kind=? WHERE id=1", ["changed"]), /append_only/);
    await assert.rejects(db.query("DELETE FROM publisher_balance_events WHERE id=1"), /append_only/);
  } finally {
    if (created) {
      for (const trigger of TRIGGERS) await db.query("DROP TRIGGER IF EXISTS " + db.escapeId(trigger));
      await db.query("DROP TABLE IF EXISTS publisher_balance_events");
      await db.query("DROP TABLE IF EXISTS users");
    }
    await db.end();
  }
});

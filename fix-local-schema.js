require("dotenv").config();
const mysql = require("mysql2/promise");

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  const addColumn = async (sql, name) => {
    try {
      await db.query(sql);
      console.log(`Added column: ${name}`);
    } catch (error) {
      if (error.code === "ER_DUP_FIELDNAME") {
        console.log(`Column already exists: ${name}`);
      } else {
        throw error;
      }
    }
  };

  await addColumn(
    "ALTER TABLE channels ADD COLUMN channel_type ENUM('public','private') NOT NULL DEFAULT 'public'",
    "channel_type"
  );

  await addColumn(
    "ALTER TABLE channels ADD COLUMN invite_link_hash VARCHAR(64) NULL",
    "invite_link_hash"
  );

  await addColumn(
    "ALTER TABLE channels ADD COLUMN view_tracking_status VARCHAR(50) NOT NULL DEFAULT 'active'",
    "view_tracking_status"
  );

  console.log("Local private channel schema fixed.");
  await db.end();
})();
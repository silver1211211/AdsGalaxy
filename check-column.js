require("dotenv").config();
const mysql = require("mysql2/promise");

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  const [rows] = await db.query(
    "SHOW COLUMNS FROM channels LIKE 'private_invite_link_encrypted'"
  );

  console.log(rows);

  await db.end();
})();
import pool from "@/lib/db";
import { cookies } from "next/headers";

export async function checkAdminAuth() {
  const cookieStore = await cookies();
  const adminCookie = await cookieStore.get("admin_auth");

  if (!adminCookie) {
    return false;
  }

  try {
    const decoded = Buffer.from(adminCookie.value, "base64").toString("utf-8");
    const [username, password] = decoded.split(":");

    const [rows]: any = await pool.query(
      "SELECT * FROM admins WHERE username = ? AND password = ?",
      [username, password]
    );

    if (rows.length > 0) {
      return true;
    }
  } catch (err) {
    console.error("Admin auth check error:", err);
  }

  return false;
}

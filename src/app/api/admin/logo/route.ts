import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";
import { checkAdminAuth } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("logo");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload an image file" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Logo must be an image" }, { status: 400 });
    }

    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo image cannot exceed 5MB" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
    const svg = `<svg width="640" height="440" viewBox="0 0 640 440" xmlns="http://www.w3.org/2000/svg">
  <rect width="640" height="440" fill="none"/>
  <image href="${dataUrl}" x="0" y="0" width="640" height="440" preserveAspectRatio="xMidYMid meet"/>
</svg>
`;

    const logoPath = path.join(process.cwd(), "public", "logo.svg");
    await writeFile(logoPath, svg, "utf8");

    return NextResponse.json({ success: true, path: "/logo.svg", updatedAt: Date.now() });
  } catch (error) {
    console.error("Admin Logo Upload Error:", error);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}

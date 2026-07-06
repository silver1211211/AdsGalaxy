import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    void user;

    const formData = await request.formData();
    const file = formData.get("image");
    const kind = String(formData.get("kind") || "image");

    const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!(file instanceof File) || !supportedTypes.has(file.type)) {
      return NextResponse.json({ error: "Please upload a valid image file (PNG, JPG, or WEBP)" }, { status: 400 });
    }

    const maxBytes = kind === "logo" ? 500 * 1024 : 1 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json({ error: kind === "logo" ? "Logo must not exceed 500 KB" : "Image must not exceed 1 MB" }, { status: 400 });
    }

    if (!process.env.IMG_API_ENDPOINT) {
      return NextResponse.json({ error: "Image upload service is not configured" }, { status: 503 });
    }

    const imgApiFormData = new FormData();
    imgApiFormData.append("action", "upload");
    imgApiFormData.append("image", file);

    const imgRes = await fetch(process.env.IMG_API_ENDPOINT, { method: "POST", body: imgApiFormData });
    const imgData = await imgRes.json();

    if (!imgData.success) {
      return NextResponse.json({ error: imgData.message || "Image upload failed" }, { status: 400 });
    }

    return NextResponse.json({ url: imgData.data.url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to upload image" }, { status: getAuthErrorStatus(error) });
  }
}

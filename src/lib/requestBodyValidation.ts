import { NextResponse } from "next/server";
export function validateMultipartRequest(request: Request, maxBytes: number) {
  const type = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(type)) return NextResponse.json({ error: "Unsupported Content-Type" }, { status: 415 });
  const boundary = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type)?.slice(1).find(Boolean);
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) return NextResponse.json({ error: "Invalid multipart boundary" }, { status: 400 });
  const length = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > maxBytes) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  return null;
}
export function validateJsonOrMultipartRequest(request: Request, maxBytes: number) {
  const type = request.headers.get("content-type") || "";
  if (/^multipart\/form-data(?:\s*;|$)/i.test(type)) return validateMultipartRequest(request, maxBytes);
  if (!/^application\/json(?:\s*;|$)/i.test(type)) return NextResponse.json({ error: "Unsupported Content-Type" }, { status: 415 });
  const length = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(length) && length > maxBytes ? NextResponse.json({ error: "Payload too large" }, { status: 413 }) : null;
}

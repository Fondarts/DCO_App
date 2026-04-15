import { NextResponse } from "next/server";

// Auth disabled in dev mode
export function GET() {
  return NextResponse.json({ status: "auth disabled" });
}

export function POST() {
  return NextResponse.json({ status: "auth disabled" });
}

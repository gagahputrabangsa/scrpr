import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  isRequestAuthenticated,
  verifyPasscode,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    authenticated: isRequestAuthenticated(req),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { passcode?: string };
    const passcode = typeof body.passcode === "string" ? body.passcode : "";

    if (!passcode) {
      return NextResponse.json(
        { success: false, error: "Please enter the passcode." },
        { status: 400 }
      );
    }

    if (!verifyPasscode(passcode)) {
      return NextResponse.json(
        { success: false, error: "Incorrect passcode. Please try again." },
        { status: 401 }
      );
    }

    const token = createSessionToken();
    const res = NextResponse.json({ success: true });

    res.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return res;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request payload." },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}


import { NextRequest, NextResponse } from "next/server";
import Firecrawl, { type Document } from "@mendable/firecrawl-js";
import { resolvePageTitle, type CrawledPage } from "@/lib/markdown-aggregator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STATUS_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function normalizeDocument(doc: Document, index: number): CrawledPage {
  const url =
    doc.metadata?.sourceURL ||
    doc.metadata?.url ||
    doc.metadata?.ogUrl ||
    `#page-${index + 1}`;

  const rawTitle =
    doc.metadata?.title ||
    doc.metadata?.ogTitle ||
    undefined;

  const markdown = (doc.markdown || "").trim();

  const title = resolvePageTitle({
    url,
    title: rawTitle,
    markdown,
  });

  return {
    url,
    title,
    description: doc.metadata?.description || doc.metadata?.ogDescription,
    markdown,
    statusCode: doc.metadata?.statusCode,
  };
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing FIRECRAWL_API_KEY in server environment.",
          code: "MISSING_API_KEY",
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id")?.trim();

    if (!jobId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required query parameter: `id`.",
          code: "MISSING_JOB_ID",
        },
        { status: 400 }
      );
    }

    const firecrawl = new Firecrawl({
      apiKey,
      ...(process.env.FIRECRAWL_API_URL
        ? { apiUrl: process.env.FIRECRAWL_API_URL }
        : {}),
    });

    const job = await withTimeout(
      firecrawl.getCrawlStatus(jobId, { autoPaginate: true }),
      STATUS_TIMEOUT_MS,
      "Timed out while polling Firecrawl job status."
    );

    const rawDocs = Array.isArray(job.data) ? job.data : [];
    const pages: CrawledPage[] = rawDocs
      .map((doc, idx) => normalizeDocument(doc, idx))
      .filter((page) => page.markdown.length > 0);

    return NextResponse.json({
      success: true,
      id: job.id || jobId,
      status: job.status,
      total: job.total ?? 0,
      completed: job.completed ?? pages.length,
      creditsUsed: job.creditsUsed ?? 0,
      expiresAt: job.expiresAt ?? null,
      pages,
    });
  } catch (err: unknown) {
    console.error("[GET /api/status] Error:", err);

    const message =
      err instanceof Error
        ? err.message
        : "Failed to retrieve crawl job status.";

    const status = message.includes("Timed out")
      ? 504
      : message.includes("404") || message.toLowerCase().includes("not found")
      ? 404
      : message.includes("429")
      ? 429
      : 500;

    return NextResponse.json(
      {
        success: false,
        error: message,
        code: "STATUS_CHECK_FAILED",
      },
      { status }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Missing FIRECRAWL_API_KEY." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id")?.trim();

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: `id`." },
        { status: 400 }
      );
    }

    const firecrawl = new Firecrawl({
      apiKey,
      ...(process.env.FIRECRAWL_API_URL
        ? { apiUrl: process.env.FIRECRAWL_API_URL }
        : {}),
    });

    const cancelled = await withTimeout(
      firecrawl.cancelCrawl(jobId),
      15_000,
      "Timed out cancelling crawl job."
    );

    return NextResponse.json({
      success: true,
      cancelled,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to cancel crawl job.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from "next/server";
import Firecrawl, { type CrawlOptions } from "@mendable/firecrawl-js";
import { isRequestAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REQUEST_TIMEOUT_MS = 25_000;

interface CrawlRequestBody {
  url?: string;
  limit?: number;
  maxDepth?: number;
  onlyMainContent?: boolean;
  allowSubdomains?: boolean;
  ignoreQueryParameters?: boolean;
  includePaths?: string[];
  excludePaths?: string[];
}

function normalizeAndValidateUrl(rawUrl: string): {
  valid: boolean;
  url?: string;
  error?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: "Please enter a documentation URL to crawl." };
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        error: "Only HTTP and HTTPS documentation URLs are supported.",
      };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".local")
    ) {
      return {
        valid: false,
        error: "Localhost and private network URLs cannot be crawled by Firecrawl.",
      };
    }

    if (!hostname.includes(".")) {
      return {
        valid: false,
        error: "Please enter a valid domain name (e.g., https://docs.stripe.com).",
      };
    }

    return { valid: true, url: parsed.toString() };
  } catch {
    return {
      valid: false,
      error: "Invalid URL format. Example: https://docs.stripe.com",
    };
  }
}

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

export async function POST(req: NextRequest) {
  try {
    if (!isRequestAuthenticated(req)) {
      return NextResponse.json(
        {
          success: false,
          error: "Passcode required. Please unlock Smart Scraper.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing FIRECRAWL_API_KEY environment variable. Add it to .env.local and restart the server.",
          code: "MISSING_API_KEY",
        },
        { status: 500 }
      );
    }

    let body: CrawlRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON payload in request body.",
          code: "INVALID_JSON",
        },
        { status: 400 }
      );
    }

    const urlValidation = normalizeAndValidateUrl(body.url || "");
    if (!urlValidation.valid || !urlValidation.url) {
      return NextResponse.json(
        {
          success: false,
          error: urlValidation.error || "Invalid URL provided.",
          code: "INVALID_URL",
        },
        { status: 400 }
      );
    }

    const targetUrl = urlValidation.url;

    // Sanitize numeric limits
    const rawLimit = Number(body.limit ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(500, Math.max(1, Math.round(rawLimit)))
      : 50;

    const rawDepth = Number(body.maxDepth ?? 3);
    const maxDiscoveryDepth = Number.isFinite(rawDepth)
      ? Math.min(10, Math.max(1, Math.round(rawDepth)))
      : 3;

    const onlyMainContent = body.onlyMainContent ?? true;
    const allowSubdomains = body.allowSubdomains ?? false;
    const ignoreQueryParameters = body.ignoreQueryParameters ?? true;

    const includePaths = Array.isArray(body.includePaths)
      ? body.includePaths.map((p) => p.trim()).filter(Boolean)
      : undefined;

    const excludePaths = Array.isArray(body.excludePaths)
      ? body.excludePaths.map((p) => p.trim()).filter(Boolean)
      : undefined;

    const firecrawl = new Firecrawl({
      apiKey,
      ...(process.env.FIRECRAWL_API_URL
        ? { apiUrl: process.env.FIRECRAWL_API_URL }
        : {}),
    });

    const crawlOptions: CrawlOptions = {
      limit,
      maxDiscoveryDepth,
      allowSubdomains,
      ignoreQueryParameters,
      deduplicateSimilarURLs: true,
      ...(includePaths && includePaths.length > 0 ? { includePaths } : {}),
      ...(excludePaths && excludePaths.length > 0 ? { excludePaths } : {}),
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent,
        removeBase64Images: true,
      },
    };

    const crawlResponse = await withTimeout(
      firecrawl.startCrawl(targetUrl, crawlOptions),
      REQUEST_TIMEOUT_MS,
      "Timed out while initializing crawl job with Firecrawl API."
    );

    if (!crawlResponse || !crawlResponse.id) {
      return NextResponse.json(
        {
          success: false,
          error: "Firecrawl did not return a valid crawl job ID.",
          code: "NO_JOB_ID",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      id: crawlResponse.id,
      url: targetUrl,
      config: {
        limit,
        maxDepth: maxDiscoveryDepth,
        onlyMainContent,
        allowSubdomains,
      },
    });
  } catch (err: unknown) {
    console.error("[POST /api/crawl] Error:", err);

    const message =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while starting the crawl.";

    const status =
      message.includes("Timed out")
        ? 504
        : message.includes("401") || message.toLowerCase().includes("unauthorized")
        ? 401
        : message.includes("402") || message.toLowerCase().includes("credit")
        ? 402
        : message.includes("429") || message.toLowerCase().includes("rate limit")
        ? 429
        : 500;

    return NextResponse.json(
      {
        success: false,
        error: message,
        code: "CRAWL_INIT_FAILED",
      },
      { status }
    );
  }
}


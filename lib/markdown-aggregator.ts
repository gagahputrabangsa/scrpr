import { cleanDocumentationMarkdown } from "@/lib/markdown-cleaner";

export interface CrawledPage {
  url: string;
  title: string;
  description?: string;
  markdown: string;
  statusCode?: number;
}

export interface AggregatedDocsResult {
  filename: string;
  siteTitle: string;
  rootUrl: string;
  totalPages: number;
  totalWords: number;
  estimatedTokens: number;
  totalCharacters: number;
  generatedAt: string;
  consolidatedMarkdown: string;
  pages: {
    index: number;
    title: string;
    url: string;
    wordCount: number;
    estimatedTokens: number;
    anchor: string;
    markdown: string;
  }[];
}

/**
 * Generates a sanitized filename in the format `docs_<sanitized_site_title>.md`
 * Example: "Stripe API" -> "docs_stripe_api.md"
 */
export function generateDynamicFilename(rootUrl: string, rootTitle?: string): string {
  let baseCandidate = "";

  if (rootTitle && rootTitle.trim().length > 0) {
    // Take primary segment before pipe, em-dash, or colon if it's overly long
    const primarySegment = rootTitle
      .split(/\s*[|—–·•]\s*/)[0]
      .trim();
    baseCandidate = primarySegment || rootTitle.trim();
  }

  if (!baseCandidate) {
    try {
      const parsed = new URL(rootUrl);
      baseCandidate = parsed.hostname.replace(/^www\./i, "").replace(/\.(com|org|io|dev|net|ai|co|app|sh)$/i, "");
    } catch {
      baseCandidate = "site";
    }
  }

  // Sanitize to lowercase alphanumeric + underscores
  let sanitized = baseCandidate
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  // Avoid redundant "docs_docs_..." prefix
  sanitized = sanitized.replace(/^docs_+/i, "");

  if (!sanitized || sanitized === "docs") {
    try {
      const parsed = new URL(rootUrl);
      sanitized = parsed.hostname
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/^docs\./, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    } catch {
      sanitized = "documentation";
    }
  }

  // Keep filename concise (max 42 chars for the slug part)
  if (sanitized.length > 42) {
    sanitized = sanitized.slice(0, 42).replace(/_+$/, "");
  }

  return `docs_${sanitized || "documentation"}.md`;
}

/**
 * Creates a GitHub-compatible markdown anchor slug
 */
function createAnchor(index: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `section-${index}-${slug || "page"}`;
}

/**
 * Extracts a clean readable title from page metadata or markdown heading or URL
 */
export function resolvePageTitle(page: {
  url?: string;
  title?: string;
  markdown?: string;
}): string {
  if (page.title && page.title.trim().length > 0) {
    return page.title.trim();
  }

  if (page.markdown) {
    const headingMatch = page.markdown.match(/^#\s+(.+)$/m);
    if (headingMatch && headingMatch[1]) {
      return headingMatch[1].replace(/[#*`]/g, "").trim();
    }
  }

  if (page.url) {
    try {
      const u = new URL(page.url);
      const pathParts = u.pathname.split("/").filter(Boolean);
      if (pathParts.length > 0) {
        const last = pathParts[pathParts.length - 1];
        return last
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase());
      }
      return u.hostname;
    } catch {
      return page.url;
    }
  }

  return "Untitled Page";
}

/**
 * Sorts crawled pages so the root URL appears first, followed by shallowest paths in alphabetical order
 */
export function sortCrawledPages(pages: CrawledPage[], rootUrl: string): CrawledPage[] {
  const normalizedRoot = rootUrl.replace(/\/+$/, "").toLowerCase();

  return [...pages].sort((a, b) => {
    const urlA = (a.url || "").replace(/\/+$/, "").toLowerCase();
    const urlB = (b.url || "").replace(/\/+$/, "").toLowerCase();

    if (urlA === normalizedRoot && urlB !== normalizedRoot) return -1;
    if (urlB === normalizedRoot && urlA !== normalizedRoot) return 1;

    const depthA = urlA.split("/").filter(Boolean).length;
    const depthB = urlB.split("/").filter(Boolean).length;

    if (depthA !== depthB) return depthA - depthB;
    return urlA.localeCompare(urlB);
  });
}

/**
 * Aggregates crawled pages into a single LLM-optimized Markdown document with Table of Contents
 */
export function aggregateMarkdownPages(
  rawPages: CrawledPage[],
  rootUrl: string
): AggregatedDocsResult {
  // Filter out empty pages and deduplicate by normalized URL
  const seenUrls = new Set<string>();
  const validPages: CrawledPage[] = [];

  for (const page of rawPages) {
    const md = cleanDocumentationMarkdown(page.markdown || "");
    if (!md) continue;
    const normUrl = (page.url || rootUrl).replace(/\/+$/, "");
    if (seenUrls.has(normUrl)) continue;
    seenUrls.add(normUrl);
    validPages.push({
      ...page,
      url: page.url || rootUrl,
      title: resolvePageTitle({ ...page, markdown: md }),
      markdown: md,
    });
  }

  const sortedPages = sortCrawledPages(validPages, rootUrl);
  const rootPage = sortedPages[0];
  const siteTitle = rootPage ? rootPage.title : resolvePageTitle({ url: rootUrl });
  const filename = generateDynamicFilename(rootUrl, siteTitle);
  const generatedAt = new Date().toISOString();

  let totalWords = 0;

  const processedPages = sortedPages.map((page, idx) => {
    const index = idx + 1;
    const words = page.markdown
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    totalWords += words;
    // Standard LLM token approximation: ~1.33 tokens per word or ~4 chars per token
    const estimatedTokens = Math.max(1, Math.round(page.markdown.length / 4));
    const anchor = createAnchor(index, page.title);

    return {
      index,
      title: page.title,
      url: page.url,
      wordCount: words,
      estimatedTokens,
      anchor,
      markdown: page.markdown,
    };
  });

  // Build Table of Contents
  const tocLines = processedPages.map(
    (p) => `${p.index}. [${p.title}](#${p.anchor}) — \`${p.url}\` *(${p.wordCount.toLocaleString("en-US")} words / ~${p.estimatedTokens.toLocaleString("en-US")} tokens)*`
  );

  // Build Header & Table of Contents
  const headerBlock = [
    `# ${siteTitle} — Consolidated LLM Documentation`,
    ``,
    `> **Root Source:** ${rootUrl}`,
    `> **Pages Consolidated:** ${processedPages.length}`,
    `> **Total Words:** ${totalWords.toLocaleString("en-US")}`,
    `> **Generated At:** ${generatedAt}`,
    `> **Format:** Consolidated Markdown optimized for LLM context windows`,
    ``,
    `---`,
    ``,
    `## Table of Contents`,
    ``,
    ...tocLines,
    ``,
    `---`,
    ``,
  ].join("\n");

  // Build each page section with clear `# [Page Title]` and `Source: [URL]` headers
  const sectionBlocks = processedPages.map((p) => {
    return [
      `<a id="${p.anchor}"></a>`,
      `# ${p.title}`,
      `Source: ${p.url}`,
      ``,
      p.markdown,
      ``,
      `---`,
      ``,
    ].join("\n");
  });

  const consolidatedMarkdown = `${headerBlock}\n${sectionBlocks.join("\n")}`.trim() + "\n";
  const totalCharacters = consolidatedMarkdown.length;
  const estimatedTokens = Math.max(1, Math.round(totalCharacters / 4));

  return {
    filename,
    siteTitle,
    rootUrl,
    totalPages: processedPages.length,
    totalWords,
    estimatedTokens,
    totalCharacters,
    generatedAt,
    consolidatedMarkdown,
    pages: processedPages,
  };
}


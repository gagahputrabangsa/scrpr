"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Sparkles,
  Globe,
  Download,
  Copy,
  Check,
  Terminal,
  SlidersHorizontal,
  Layers,
  FileText,
  ExternalLink,
  AlertCircle,
  Loader2,
  Maximize2,
  Search,
  RotateCcw,
  StopCircle,
  ChevronRight,
  ChevronDown,
  Cpu,
  BookOpen,
  Hash,
  Clock,
  Zap,
  CheckCircle2,
  FolderGit2,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  aggregateMarkdownPages,
  type AggregatedDocsResult,
  type CrawledPage,
} from "@/lib/markdown-aggregator";
import { LightVeilBackground } from "@/components/light-veil-background";

type CrawlPhase = "idle" | "starting" | "crawling" | "completed" | "error" | "cancelled";

interface RecentCrawlItem {
  id: string;
  url: string;
  filename: string;
  totalPages: number;
  estimatedTokens: number;
  timestamp: string;
}

const PRESET_DOCS = [
  {
    label: "Stripe Docs",
    url: "https://docs.stripe.com/keys",
    badge: "Payments API",
  },
  {
    label: "Firecrawl Docs",
    url: "https://docs.firecrawl.dev/introduction",
    badge: "Crawler SDK",
  },
  {
    label: "shadcn/ui",
    url: "https://ui.shadcn.com/docs",
    badge: "UI Primitives",
  },
  {
    label: "Next.js App Router",
    url: "https://nextjs.org/docs/app",
    badge: "Framework",
  },
];

const PAGE_LIMIT_PRESETS = [10, 25, 50, 100, 200];
const DEPTH_PRESETS = [1, 2, 3, 5, 8];

export default function SmartScraperPage() {
  // Input & Configuration State
  const [url, setUrl] = useState<string>("https://docs.firecrawl.dev/introduction");
  const [maxPages, setMaxPages] = useState<number>(50);
  const [crawlDepth, setCrawlDepth] = useState<number>(3);
  const [onlyMainContent, setOnlyMainContent] = useState<boolean>(true);
  const [allowSubdomains, setAllowSubdomains] = useState<boolean>(false);
  const [includePathsInput, setIncludePathsInput] = useState<string>("");
  const [excludePathsInput, setExcludePathsInput] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Crawl Execution & Polling State
  const [phase, setPhase] = useState<CrawlPhase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeTargetUrl, setActiveTargetUrl] = useState<string>("");
  const [discoveredCount, setDiscoveredCount] = useState<number>(0);
  const [totalEstimated, setTotalEstimated] = useState<number>(0);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [livePages, setLivePages] = useState<CrawledPage[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Aggregated Result & UI State
  const [result, setResult] = useState<AggregatedDocsResult | null>(null);
  const [customFilename, setCustomFilename] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedPageIdx, setCopiedPageIdx] = useState<number | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState<boolean>(false);
  const [selectedPageIdx, setSelectedPageIdx] = useState<number>(0);
  const [pageSearchQuery, setPageSearchQuery] = useState<string>("");
  const [recentCrawls, setRecentCrawls] = useState<RecentCrawlItem[]>([]);

  // Refs for intervals & focus
  const urlInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load recent crawls from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("smart_scraper_recent");
      if (saved) {
        setRecentCrawls(JSON.parse(saved));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const saveRecentCrawl = useCallback((item: RecentCrawlItem) => {
    setRecentCrawls((prev) => {
      const filtered = prev.filter((r) => r.url !== item.url);
      const updated = [item, ...filtered].slice(0, 5);
      try {
        localStorage.setItem("smart_scraper_recent", JSON.stringify(updated));
      } catch {
        // ignore storage errors
      }
      return updated;
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  // Download Markdown file handler
  const handleDownloadMarkdown = useCallback(() => {
    if (!result) return;
    const targetName = (customFilename || result.filename).trim();
    const finalFilename = targetName.endsWith(".md")
      ? targetName
      : `${targetName}.md`;

    const blob = new Blob([result.consolidatedMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = finalFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }, [result, customFilename]);

  // Copy consolidated Markdown to clipboard
  const handleCopyMarkdown = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.consolidatedMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback textarea copy
      const textarea = document.createElement("textarea");
      textarea.value = result.consolidatedMarkdown;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }, [result]);

  // Copy single page markdown
  const handleCopySinglePage = useCallback(
    async (idx: number, markdown: string) => {
      try {
        await navigator.clipboard.writeText(markdown);
        setCopiedPageIdx(idx);
        setTimeout(() => setCopiedPageIdx(null), 1800);
      } catch {
        // ignore
      }
    },
    []
  );

  // Poll /api/status?id=...
  const pollCrawlStatus = useCallback(
    async (currentJobId: string, rootTargetUrl: string) => {
      try {
        const res = await fetch(
          `/api/status?id=${encodeURIComponent(currentJobId)}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || `Status check failed (HTTP ${res.status})`);
        }

        const pages: CrawledPage[] = Array.isArray(data.pages) ? data.pages : [];
        const completedCount =
          typeof data.completed === "number" ? data.completed : pages.length;
        const totalCount =
          typeof data.total === "number" ? data.total : completedCount;

        setDiscoveredCount(completedCount);
        setTotalEstimated(totalCount);
        if (typeof data.creditsUsed === "number") {
          setCreditsUsed(data.creditsUsed);
        }
        if (pages.length > 0) {
          setLivePages(pages);
        }

        if (data.status === "completed") {
          clearTimers();

          if (pages.length === 0) {
            setPhase("error");
            setErrorMessage(
              "Crawl finished, but no extractable Markdown content was found on the target URL. Try disabling path filters or checking if the site blocks automated crawlers."
            );
            return;
          }

          const aggregated = aggregateMarkdownPages(pages, rootTargetUrl);
          setResult(aggregated);
          setCustomFilename(aggregated.filename);
          setSelectedPageIdx(0);
          setPhase("completed");

          saveRecentCrawl({
            id: currentJobId,
            url: rootTargetUrl,
            filename: aggregated.filename,
            totalPages: aggregated.totalPages,
            estimatedTokens: aggregated.estimatedTokens,
            timestamp: new Date().toISOString(),
          });
        } else if (data.status === "failed" || data.status === "cancelled") {
          clearTimers();
          // If partial pages were already scraped before cancellation/failure, allow partial consolidation
          if (data.status === "cancelled" && pages.length > 0) {
            const aggregated = aggregateMarkdownPages(pages, rootTargetUrl);
            setResult(aggregated);
            setCustomFilename(aggregated.filename);
            setSelectedPageIdx(0);
            setPhase("completed");
          } else {
            setPhase(data.status === "cancelled" ? "cancelled" : "error");
            setErrorMessage(
              data.status === "cancelled"
                ? "Crawl job was cancelled."
                : "Firecrawl reported that the crawl job failed."
            );
          }
        }
      } catch (err: unknown) {
        console.error("Polling error:", err);
        clearTimers();
        setPhase("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Lost connection while polling crawl progress."
        );
      }
    },
    [clearTimers, saveRecentCrawl]
  );

  // Trigger POST /api/crawl
  const handleStartCrawl = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (phase === "starting" || phase === "crawling") return;

      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setPhase("error");
        setErrorMessage("Please enter a valid documentation root URL.");
        urlInputRef.current?.focus();
        return;
      }

      clearTimers();
      setErrorMessage(null);
      setResult(null);
      setLivePages([]);
      setDiscoveredCount(0);
      setTotalEstimated(0);
      setCreditsUsed(0);
      setElapsedSeconds(0);
      setPhase("starting");

      const includePaths = includePathsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const excludePaths = excludePathsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      try {
        const res = await fetch("/api/crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: trimmedUrl,
            limit: maxPages,
            maxDepth: crawlDepth,
            onlyMainContent,
            allowSubdomains,
            includePaths: includePaths.length > 0 ? includePaths : undefined,
            excludePaths: excludePaths.length > 0 ? excludePaths : undefined,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success || !data.id) {
          throw new Error(
            data.error || `Failed to initiate crawl (HTTP ${res.status})`
          );
        }

        const newJobId: string = data.id;
        const normalizedTarget: string = data.url || trimmedUrl;

        setJobId(newJobId);
        setActiveTargetUrl(normalizedTarget);
        setUrl(normalizedTarget);
        setPhase("crawling");

        // Start elapsed time counter
        timerIntervalRef.current = setInterval(() => {
          setElapsedSeconds((prev) => prev + 1);
        }, 1000);

        // Immediately perform first status check after 1.2s, then poll every 2.5s
        setTimeout(() => {
          pollCrawlStatus(newJobId, normalizedTarget);
        }, 1200);

        pollIntervalRef.current = setInterval(() => {
          pollCrawlStatus(newJobId, normalizedTarget);
        }, 2500);
      } catch (err: unknown) {
        clearTimers();
        setPhase("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Unable to start crawl job. Check your network and FIRECRAWL_API_KEY."
        );
      }
    },
    [
      phase,
      url,
      maxPages,
      crawlDepth,
      onlyMainContent,
      allowSubdomains,
      includePathsInput,
      excludePathsInput,
      clearTimers,
      pollCrawlStatus,
    ]
  );

  // Cancel active crawl
  const handleCancelCrawl = useCallback(async () => {
    if (!jobId) return;
    clearTimers();

    try {
      await fetch(`/api/status?id=${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
    } catch {
      // ignore network error on cancel
    }

    if (livePages.length > 0) {
      const aggregated = aggregateMarkdownPages(
        livePages,
        activeTargetUrl || url
      );
      setResult(aggregated);
      setCustomFilename(aggregated.filename);
      setSelectedPageIdx(0);
      setPhase("completed");
    } else {
      setPhase("cancelled");
      setErrorMessage("Crawl cancelled by user.");
    }
  }, [jobId, clearTimers, livePages, activeTargetUrl, url]);

  // Global Keyboard Shortcuts (Linear / Raycast style)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K or "/" (when not in an input) focuses URL bar
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      } else if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        urlInputRef.current?.focus();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "Enter" &&
        phase !== "starting" &&
        phase !== "crawling"
      ) {
        e.preventDefault();
        handleStartCrawl();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "d" &&
        result
      ) {
        e.preventDefault();
        handleDownloadMarkdown();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, result, handleStartCrawl, handleDownloadMarkdown]);

  // Calculate progress percentage
  const progressPercentage = useMemo(() => {
    if (phase === "completed") return 100;
    if (phase === "starting") return 8;
    if (phase === "crawling") {
      if (totalEstimated > 0 && discoveredCount > 0) {
        return Math.min(95, Math.max(12, Math.round((discoveredCount / totalEstimated) * 100)));
      }
      // Smooth asymptotic progress when total isn't known yet
      return Math.min(85, 15 + elapsedSeconds * 4);
    }
    return 0;
  }, [phase, totalEstimated, discoveredCount, elapsedSeconds]);

  // Filtered pages in the inspector
  const filteredPages = useMemo(() => {
    if (!result) return [];
    const q = pageSearchQuery.trim().toLowerCase();
    if (!q) return result.pages;
    return result.pages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q) ||
        p.markdown.toLowerCase().includes(q)
    );
  }, [result, pageSearchQuery]);

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return mins > 0
      ? `${mins}m ${rem.toString().padStart(2, "0")}s`
      : `${rem}s`;
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative min-h-screen flex flex-col bg-[#020307] text-zinc-100 selection:bg-cyan-500/30 selection:text-cyan-200 overflow-x-hidden">
        {/* Animated WebGL2 Light Veil Background (Slightly Darker Polar Veil) */}
        <LightVeilBackground />

        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#03050c]/70 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <Terminal className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-semibold tracking-tight text-zinc-100 text-sm sm:text-base">
                  Smart Scraper
                </span>
                <Badge
                  variant="emerald"
                  className="hidden sm:inline-flex text-[10px] px-2 py-0 font-mono uppercase tracking-wider"
                >
                  Firecrawl v2
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden md:flex items-center gap-1.5 rounded-md border border-zinc-800/90 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>LLM Context Compiler</span>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      urlInputRef.current?.focus();
                      urlInputRef.current?.select();
                    }}
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
                  >
                    <span>Focus URL</span>
                    <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                      ⌘K
                    </kbd>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Press ⌘K or / anywhere to focus the URL input</TooltipContent>
              </Tooltip>

              <a
                href="https://docs.firecrawl.dev"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
              >
                <span>Firecrawl API</span>
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </header>

        {/* Main Workspace Container */}
        <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
          {/* Hero Section */}
          <section className="mx-auto max-w-3xl text-center mb-8 sm:mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300 mb-4 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>Recursive Documentation Crawler → Single Consolidated Markdown</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-50 leading-[1.15]">
              Compile entire docs into{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-teal-200 to-sky-400 bg-clip-text text-transparent">
                LLM-ready Markdown
              </span>
            </h1>

            <p className="mt-3.5 text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Enter any documentation root URL. Smart Scraper recursively discovers subpages,
              strips boilerplate HTML, and merges everything into a clean, token-optimized{" "}
              <code className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 font-mono text-xs text-emerald-300">
                docs_&lt;site&gt;.md
              </code>{" "}
              context file.
            </p>
          </section>

          {/* Command Center Input Card */}
          <Card className="mx-auto w-full max-w-4xl border-white/10 bg-[#050811]/75 backdrop-blur-xl shadow-[0_24px_80px_-15px_rgba(0,0,0,0.85)]">
            <CardContent className="p-4 sm:p-6">
              <form onSubmit={handleStartCrawl} className="space-y-4">
                {/* Primary URL Input Row */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-500">
                      <Globe className="h-4 w-4 text-zinc-400" />
                    </div>
                    <Input
                      ref={urlInputRef}
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      disabled={phase === "starting" || phase === "crawling"}
                      placeholder="https://docs.stripe.com or https://docs.firecrawl.dev"
                      aria-label="Documentation root URL"
                      className="h-12 pl-10 pr-16 font-mono text-sm bg-zinc-950/90 border-zinc-800 focus-visible:ring-emerald-500/60 focus-visible:border-emerald-500/60 placeholder:text-zinc-600"
                    />
                    <div className="pointer-events-none absolute inset-y-0 right-0 hidden sm:flex items-center pr-3">
                      <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                        /
                      </kbd>
                    </div>
                  </div>

                  {phase === "starting" || phase === "crawling" ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="xl"
                      onClick={handleCancelCrawl}
                      className="h-12 px-6 font-medium shrink-0"
                    >
                      <StopCircle className="h-4 w-4" />
                      <span>Stop Crawl</span>
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      variant="emerald"
                      size="xl"
                      className="h-12 px-6 shrink-0"
                    >
                      <Zap className="h-4 w-4 fill-zinc-950" />
                      <span>Crawl &amp; Compile</span>
                      <kbd className="hidden md:inline-block ml-1 rounded bg-zinc-950/20 px-1.5 py-0.5 font-mono text-[10px] text-zinc-950">
                        ⌘↵
                      </kbd>
                    </Button>
                  )}
                </div>

                {/* Preset Documentation Pills */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-zinc-500 mr-1">Presets:</span>
                    {PRESET_DOCS.map((preset) => {
                      const isActive = url.trim() === preset.url;
                      return (
                        <button
                          key={preset.url}
                          type="button"
                          disabled={phase === "starting" || phase === "crawling"}
                          onClick={() => setUrl(preset.url)}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-all ${
                            isActive
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-zinc-800/80 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                          } disabled:opacity-50`}
                        >
                          <span>{preset.label}</span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {preset.badge}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAdvanced((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Crawl Parameters</span>
                    {showAdvanced ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {/* Configurable Controls: Max Page Limit & Crawl Depth (Always Accessible) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/70">
                  {/* Max Page Limit Control */}
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label
                        htmlFor="max-pages-input"
                        className="flex items-center gap-1.5 text-xs font-medium text-zinc-300"
                      >
                        <FileText className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Max Page Limit</span>
                      </label>
                      <span className="font-mono text-xs text-emerald-400 font-semibold">
                        {maxPages} {maxPages === 1 ? "page" : "pages"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex flex-1 gap-1">
                        {PAGE_LIMIT_PRESETS.map((val) => (
                          <button
                            key={val}
                            type="button"
                            disabled={phase === "starting" || phase === "crawling"}
                            onClick={() => setMaxPages(val)}
                            className={`flex-1 rounded py-1 text-xs font-mono transition-colors border ${
                              maxPages === val
                                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 font-semibold"
                                : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                      <Input
                        id="max-pages-input"
                        type="number"
                        min={1}
                        max={500}
                        value={maxPages}
                        disabled={phase === "starting" || phase === "crawling"}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v)) setMaxPages(Math.min(500, Math.max(1, v)));
                        }}
                        className="h-7 w-16 px-2 text-center font-mono text-xs bg-zinc-900 border-zinc-800"
                      />
                    </div>
                  </div>

                  {/* Max Crawl Depth Control */}
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label
                        htmlFor="crawl-depth-input"
                        className="flex items-center gap-1.5 text-xs font-medium text-zinc-300"
                      >
                        <Layers className="h-3.5 w-3.5 text-sky-400" />
                        <span>Max Crawl Depth</span>
                      </label>
                      <span className="font-mono text-xs text-sky-400 font-semibold">
                        Depth {crawlDepth}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex flex-1 gap-1">
                        {DEPTH_PRESETS.map((val) => (
                          <button
                            key={val}
                            type="button"
                            disabled={phase === "starting" || phase === "crawling"}
                            onClick={() => setCrawlDepth(val)}
                            className={`flex-1 rounded py-1 text-xs font-mono transition-colors border ${
                              crawlDepth === val
                                ? "border-sky-500/50 bg-sky-500/15 text-sky-300 font-semibold"
                                : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                            }`}
                          >
                            {val}x
                          </button>
                        ))}
                      </div>
                      <Input
                        id="crawl-depth-input"
                        type="number"
                        min={1}
                        max={10}
                        value={crawlDepth}
                        disabled={phase === "starting" || phase === "crawling"}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v)) setCrawlDepth(Math.min(10, Math.max(1, v)));
                        }}
                        className="h-7 w-16 px-2 text-center font-mono text-xs bg-zinc-900 border-zinc-800"
                      />
                    </div>
                  </div>
                </div>

                {/* Expandable Advanced Parameters */}
                {showAdvanced && (
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/80 p-4 space-y-3 animate-in fade-in-0 slide-in-from-top-1 duration-150">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">
                          Include Subpaths (optional, comma-separated)
                        </label>
                        <Input
                          type="text"
                          value={includePathsInput}
                          onChange={(e) => setIncludePathsInput(e.target.value)}
                          placeholder="/docs/*, /api/*"
                          className="h-8 font-mono text-xs bg-zinc-900 border-zinc-800"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">
                          Exclude Subpaths (optional, comma-separated)
                        </label>
                        <Input
                          type="text"
                          value={excludePathsInput}
                          onChange={(e) => setExcludePathsInput(e.target.value)}
                          placeholder="/blog/*, /changelog/*"
                          className="h-8 font-mono text-xs bg-zinc-900 border-zinc-800"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={onlyMainContent}
                          onChange={(e) => setOnlyMainContent(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span>
                          Extract Main Content Only{" "}
                          <span className="text-zinc-500">
                            (strips navbars, footers &amp; sidebars)
                          </span>
                        </span>
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allowSubdomains}
                          onChange={(e) => setAllowSubdomains(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span>Include Subdomains</span>
                      </label>
                    </div>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Error or Cancelled Alert Banner */}
          {(phase === "error" || phase === "cancelled") && errorMessage && (
            <div className="mx-auto mt-6 w-full max-w-4xl animate-in fade-in-0 slide-in-from-top-2">
              <Alert variant={phase === "cancelled" ? "warning" : "destructive"}>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="flex items-center justify-between">
                  <span>
                    {phase === "cancelled"
                      ? "Crawl Job Cancelled"
                      : "Crawl Execution Error"}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartCrawl()}
                    className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900/90 hover:bg-zinc-800"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Retry Crawl
                  </Button>
                </AlertTitle>
                <AlertDescription className="mt-1 font-mono text-xs">
                  {errorMessage}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Live Status & Polling Telemetry Card */}
          {(phase === "starting" || phase === "crawling") && (
            <Card className="mx-auto mt-6 w-full max-w-4xl border-emerald-500/30 bg-zinc-900/75 shadow-[0_0_50px_-12px_rgba(16,185,129,0.18)] animate-in fade-in-0 slide-in-from-bottom-2">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                    </div>
                    <CardTitle className="text-base font-semibold text-zinc-100">
                      {phase === "starting"
                        ? "Initializing Firecrawl Job..."
                        : `Crawling: ${discoveredCount} ${
                            discoveredCount === 1 ? "page" : "pages"
                          } discovered${
                            totalEstimated > 0 ? ` of ${totalEstimated}` : "..."
                          }`}
                    </CardTitle>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="emerald" className="font-mono text-xs">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      {phase === "starting" ? "STARTING" : "POLLING 2.5s"}
                    </Badge>
                    {jobId && (
                      <Badge variant="secondary" className="font-mono text-[11px] text-zinc-400">
                        ID: {jobId.slice(0, 8)}…
                      </Badge>
                    )}
                  </div>
                </div>
                <CardDescription className="font-mono text-xs text-zinc-400 truncate">
                  Target: {activeTargetUrl || url}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                {/* Dynamic Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                    <span>
                      {totalEstimated > 0
                        ? `Extracting clean Markdown (${discoveredCount}/${totalEstimated} pages)`
                        : "Recursively mapping & scraping subpages..."}
                    </span>
                    <span className="text-emerald-400 font-semibold">
                      {progressPercentage}%
                    </span>
                  </div>
                  <Progress
                    value={progressPercentage}
                    indeterminate={totalEstimated === 0}
                    indicatorClassName="bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400"
                    className="h-2.5 bg-zinc-950 border border-zinc-800"
                  />
                </div>

                {/* Live Telemetry Metrics Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3">
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <FileText className="h-3 w-3 text-emerald-400" />
                      <span>Pages Scraped</span>
                    </div>
                    <div className="mt-1 font-mono text-lg font-bold text-zinc-100">
                      {discoveredCount}
                      {totalEstimated > 0 && (
                        <span className="text-xs font-normal text-zinc-500">
                          {" "}
                          / {totalEstimated}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3">
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-sky-400" />
                      <span>Elapsed Time</span>
                    </div>
                    <div className="mt-1 font-mono text-lg font-bold text-zinc-100">
                      {formatDuration(elapsedSeconds)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3">
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <Layers className="h-3 w-3 text-purple-400" />
                      <span>Config Bounds</span>
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-200">
                      {maxPages} max · {crawlDepth}x depth
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3">
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <Cpu className="h-3 w-3 text-amber-400" />
                      <span>API Credits</span>
                    </div>
                    <div className="mt-1 font-mono text-lg font-bold text-zinc-100">
                      {creditsUsed > 0 ? creditsUsed : "—"}
                    </div>
                  </div>
                </div>

                {/* Live Discovered Pages Stream or Skeleton Loader */}
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/90 p-3.5">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Live Crawl Stream</span>
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {livePages.length > 0
                        ? `${livePages.length} pages buffered`
                        : "Awaiting first page batch..."}
                    </span>
                  </div>

                  {livePages.length > 0 ? (
                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                      {livePages.slice(-8).map((p, idx) => (
                        <div
                          key={`${p.url}-${idx}`}
                          className="flex items-center justify-between gap-3 rounded border border-zinc-800/60 bg-zinc-900/60 px-2.5 py-1.5 text-xs font-mono"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            <span className="text-zinc-200 truncate font-sans font-medium">
                              {p.title}
                            </span>
                            <span className="text-zinc-500 truncate hidden sm:inline">
                              {p.url}
                            </span>
                          </div>
                          <span className="text-[11px] text-emerald-400/90 shrink-0">
                            {Math.max(1, Math.round(p.markdown.length / 4)).toLocaleString()} tok
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {[1, 2, 3].map((n) => (
                        <div
                          key={n}
                          className="flex items-center justify-between rounded border border-zinc-800/50 bg-zinc-900/40 px-3 py-2 animate-pulse"
                        >
                          <div className="flex items-center gap-2.5 w-2/3">
                            <div className="h-3 w-3 rounded-full bg-emerald-500/30" />
                            <div className="h-3 w-40 rounded bg-zinc-800" />
                            <div className="h-2.5 w-56 rounded bg-zinc-800/60 hidden sm:block" />
                          </div>
                          <div className="h-2.5 w-14 rounded bg-zinc-800" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completed State: Consolidated Markdown Export & Inspector */}
          {phase === "completed" && result && (
            <section className="mx-auto mt-6 w-full max-w-6xl space-y-6 animate-in fade-in-0 slide-in-from-bottom-3 duration-300">
              {/* Primary Export & Dynamic Filename Card */}
              <Card className="border-emerald-500/30 bg-zinc-900/80 shadow-[0_10px_50px_-12px_rgba(16,185,129,0.18)]">
                <CardContent className="p-5 sm:p-6">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                    {/* Left: Summary & Dynamic Filename */}
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="emerald" className="font-mono text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          CONSOLIDATED &amp; READY
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {result.totalPages}{" "}
                          {result.totalPages === 1 ? "Page" : "Pages"} Merged
                        </Badge>
                        <Badge variant="blue" className="font-mono text-xs">
                          ~{result.estimatedTokens.toLocaleString()} LLM Tokens
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs text-zinc-400">
                          {result.totalWords.toLocaleString()} Words
                        </Badge>
                      </div>

                      <div className="pt-1 flex flex-col sm:flex-row sm:items-center gap-2">
                        <label
                          htmlFor="dynamic-filename-input"
                          className="text-xs font-medium text-zinc-400 shrink-0"
                        >
                          Output Filename:
                        </label>
                        <div className="flex items-center gap-2 max-w-md w-full">
                          <Input
                            id="dynamic-filename-input"
                            type="text"
                            value={customFilename}
                            onChange={(e) => setCustomFilename(e.target.value)}
                            className="h-8 font-mono text-xs bg-zinc-950 border-zinc-800 text-emerald-300 font-semibold"
                          />
                          {customFilename !== result.filename && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setCustomFilename(result.filename)}
                              className="h-8 px-2 text-xs text-zinc-400"
                            >
                              Reset
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: 1-Click Download, Copy to Clipboard, and Full-Screen Preview Modal */}
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      <Button
                        type="button"
                        variant="emerald"
                        size="lg"
                        onClick={handleDownloadMarkdown}
                        className="shadow-lg"
                      >
                        <Download className="h-4 w-4" />
                        <span>Download Markdown</span>
                        <kbd className="hidden sm:inline-block ml-1 rounded bg-zinc-950/20 px-1.5 py-0.5 font-mono text-[10px] text-zinc-950">
                          ⌘D
                        </kbd>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        onClick={handleCopyMarkdown}
                        className="border-zinc-700 bg-zinc-950/80 hover:bg-zinc-900"
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            <span>Copy Markdown</span>
                          </>
                        )}
                      </Button>

                      <Dialog
                        open={previewModalOpen}
                        onOpenChange={setPreviewModalOpen}
                      >
                        <DialogTrigger asChild>
                          <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            className="border border-zinc-800"
                          >
                            <Maximize2 className="h-4 w-4" />
                            <span>Expand Preview</span>
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 overflow-hidden border-zinc-800 bg-zinc-950">
                          <DialogHeader className="p-5 pb-3 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
                            <div className="flex flex-wrap items-center justify-between gap-3 pr-6">
                              <div>
                                <DialogTitle className="font-mono text-base text-emerald-400 flex items-center gap-2">
                                  <FileText className="h-4 w-4" />
                                  <span>{customFilename || result.filename}</span>
                                </DialogTitle>
                                <DialogDescription className="text-xs text-zinc-400 mt-1">
                                  Consolidated from {result.totalPages} pages ·{" "}
                                  {result.totalWords.toLocaleString()} words · ~
                                  {result.estimatedTokens.toLocaleString()} tokens
                                </DialogDescription>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleCopyMarkdown}
                                >
                                  {copied ? (
                                    <>
                                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                                      <span>Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3.5 w-3.5" />
                                      <span>Copy All</span>
                                    </>
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="emerald"
                                  size="sm"
                                  onClick={handleDownloadMarkdown}
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  <span>Download .md</span>
                                </Button>
                              </div>
                            </div>
                          </DialogHeader>
                          <div className="flex-1 overflow-y-auto p-5 bg-zinc-950">
                            <pre className="font-mono text-xs text-zinc-200 whitespace-pre-wrap break-words leading-relaxed">
                              {result.consolidatedMarkdown}
                            </pre>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>

                  {/* LLM Context Window Fit Bar */}
                  <div className="mt-5 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Cpu className="h-3.5 w-3.5 text-emerald-400" />
                      <span>LLM Context Compatibility:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                      {[
                        { name: "GPT-4o (128K)", limit: 128_000 },
                        { name: "Claude 3.7 Sonnet (200K)", limit: 200_000 },
                        { name: "Gemini 2.5 Pro (1M)", limit: 1_000_000 },
                      ].map((model) => {
                        const fits = result.estimatedTokens <= model.limit;
                        const pct = Math.min(
                          100,
                          Math.max(1, Math.round((result.estimatedTokens / model.limit) * 100))
                        );
                        return (
                          <div
                            key={model.name}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
                              fits
                                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                                : "border-amber-500/30 bg-amber-500/5 text-amber-300"
                            }`}
                          >
                            <span>{model.name}:</span>
                            <span className="font-bold">{pct}% used</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Interactive Document & Section Inspector */}
              <Tabs defaultValue="consolidated" className="w-full">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <TabsList>
                    <TabsTrigger value="consolidated" className="gap-1.5">
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>Consolidated Markdown</span>
                    </TabsTrigger>
                    <TabsTrigger value="sections" className="gap-1.5">
                      <Hash className="h-3.5 w-3.5" />
                      <span>Crawled Pages ({result.totalPages})</span>
                    </TabsTrigger>
                  </TabsList>

                  <div className="text-xs font-mono text-zinc-500">
                    {(result.totalCharacters / 1024).toFixed(1)} KB consolidated `.md`
                  </div>
                </div>

                {/* Tab 1: Full Consolidated Markdown Preview */}
                <TabsContent value="consolidated">
                  <Card className="border-zinc-800 bg-zinc-900/50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/80">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                        <span className="ml-2 font-mono text-xs text-zinc-300">
                          {customFilename || result.filename}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyMarkdown}
                          className="h-7 px-2.5 text-xs text-zinc-300"
                        >
                          {copied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copy Raw</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="max-h-[540px] overflow-y-auto p-4 sm:p-6 bg-zinc-950/90">
                      <pre className="font-mono text-xs text-zinc-200 whitespace-pre-wrap break-words leading-relaxed">
                        {result.consolidatedMarkdown}
                      </pre>
                    </div>
                  </Card>
                </TabsContent>

                {/* Tab 2: Split-View Page-by-Page Explorer */}
                <TabsContent value="sections">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left Column: Searchable Table of Contents */}
                    <Card className="lg:col-span-5 border-zinc-800 bg-zinc-900/50 flex flex-col h-[540px]">
                      <div className="p-3 border-b border-zinc-800">
                        <div className="relative">
                          <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                          <Input
                            type="text"
                            value={pageSearchQuery}
                            onChange={(e) => setPageSearchQuery(e.target.value)}
                            placeholder="Filter crawled pages by title or URL..."
                            className="h-8 pl-8 text-xs bg-zinc-950 border-zinc-800"
                          />
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {filteredPages.length === 0 ? (
                          <div className="p-6 text-center text-xs text-zinc-500">
                            No crawled pages match &ldquo;{pageSearchQuery}&rdquo;.
                          </div>
                        ) : (
                          filteredPages.map((p) => {
                            const active =
                              result.pages[selectedPageIdx]?.index === p.index;
                            return (
                              <button
                                key={p.url}
                                type="button"
                                onClick={() => setSelectedPageIdx(p.index - 1)}
                                className={`w-full text-left rounded-lg p-2.5 transition-colors border ${
                                  active
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-zinc-100"
                                    : "border-transparent hover:bg-zinc-800/60 text-zinc-300"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium truncate">
                                    <span className="font-mono text-zinc-500 mr-1.5">
                                      #{p.index}
                                    </span>
                                    {p.title}
                                  </span>
                                  <Badge
                                    variant="secondary"
                                    className="font-mono text-[10px] px-1.5 py-0 shrink-0"
                                  >
                                    ~{p.estimatedTokens.toLocaleString()} tok
                                  </Badge>
                                </div>
                                <div className="mt-1 font-mono text-[11px] text-zinc-500 truncate">
                                  {p.url}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </Card>

                    {/* Right Column: Selected Page Markdown Inspector */}
                    <Card className="lg:col-span-7 border-zinc-800 bg-zinc-900/50 flex flex-col h-[540px] overflow-hidden">
                      {result.pages[selectedPageIdx] ? (
                        <>
                          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950/70">
                            <div className="min-w-0">
                              <h3 className="text-xs font-semibold text-zinc-100 truncate">
                                {result.pages[selectedPageIdx].title}
                              </h3>
                              <a
                                href={result.pages[selectedPageIdx].url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400 hover:underline truncate max-w-full"
                              >
                                <span className="truncate">
                                  {result.pages[selectedPageIdx].url}
                                </span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleCopySinglePage(
                                  selectedPageIdx,
                                  result.pages[selectedPageIdx].markdown
                                )
                              }
                              className="h-7 px-2.5 text-xs shrink-0"
                            >
                              {copiedPageIdx === selectedPageIdx ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                  <span>Copied Page</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>Copy Page</span>
                                </>
                              )}
                            </Button>
                          </div>

                          <div className="flex-1 overflow-y-auto p-4 bg-zinc-950/90">
                            <pre className="font-mono text-xs text-zinc-200 whitespace-pre-wrap break-words leading-relaxed">
                              {`# ${result.pages[selectedPageIdx].title}\nSource: ${result.pages[selectedPageIdx].url}\n\n${result.pages[selectedPageIdx].markdown}`}
                            </pre>
                          </div>
                        </>
                      ) : null}
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            </section>
          )}

          {/* Idle State Feature Highlights & Recent Crawls */}
          {phase === "idle" && !result && (
            <section className="mx-auto mt-10 w-full max-w-4xl space-y-8">
              {/* Feature Bento Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-zinc-800/80 bg-zinc-900/40">
                  <CardHeader className="pb-2">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      <Layers className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-sm text-zinc-100">
                      Recursive Subpage Discovery
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-zinc-400 leading-relaxed">
                    Automatically traverses sitemaps and internal documentation links up to your
                    configured depth and page limit.
                  </CardContent>
                </Card>

                <Card className="border-zinc-800/80 bg-zinc-900/40">
                  <CardHeader className="pb-2">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-sm text-zinc-100">
                      Indexed Table of Contents
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-zinc-400 leading-relaxed">
                    Prepends a structured Table of Contents with anchor links, `# [Page Title]`
                    headers, `Source: [URL]` citations, and token counts.
                  </CardContent>
                </Card>

                <Card className="border-zinc-800/80 bg-zinc-900/40">
                  <CardHeader className="pb-2">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md border border-purple-500/30 bg-purple-500/10 text-purple-400">
                      <Download className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-sm text-zinc-100">
                      Dynamic Naming &amp; Export
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-zinc-400 leading-relaxed">
                    Automatically sanitizes site titles into{" "}
                    <code className="font-mono text-zinc-300">docs_&lt;site&gt;.md</code> for
                    instant 1-click download into Claude, Cursor, or ChatGPT.
                  </CardContent>
                </Card>
              </div>

              {/* Recent Crawls History (if any) */}
              {recentCrawls.length > 0 && (
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                      <FolderGit2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Recent Crawls in this Browser</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRecentCrawls([]);
                        localStorage.removeItem("smart_scraper_recent");
                      }}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      Clear History
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {recentCrawls.map((item) => (
                      <div
                        key={item.id + item.url}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Badge variant="emerald" className="font-mono text-[10px]">
                            {item.filename}
                          </Badge>
                          <span className="font-mono text-zinc-400 truncate">
                            {item.url}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-[11px] text-zinc-500">
                            {item.totalPages} pages · ~{item.estimatedTokens.toLocaleString()} tok
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setUrl(item.url);
                              urlInputRef.current?.focus();
                            }}
                            className="h-6 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            Load URL
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>

        {/* Minimalist Footer */}
        <footer className="relative z-10 border-t border-white/10 bg-[#03050c]/70 backdrop-blur-md py-4 px-4 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-400">Smart Scraper</span>
              <span>·</span>
              <span>Built with Next.js App Router, Tailwind CSS, shadcn/ui &amp; Firecrawl SDK</span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span>⌘K Focus</span>
              <span>·</span>
              <span>⌘↵ Crawl</span>
              <span>·</span>
              <span>⌘D Download</span>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}


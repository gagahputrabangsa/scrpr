/**
 * Preprocesses and sanitizes raw scraped Markdown from documentation sites
 * (Mintlify, Docusaurus, Nextra, GitBook, ReadMe, VitePress, etc.) into clean,
 * readable, token-efficient Markdown without losing any technical content.
 */

const LANGUAGE_TABS = new Set([
  "python",
  "node",
  "node.js",
  "javascript",
  "typescript",
  "js",
  "ts",
  "curl",
  "cli",
  "bash",
  "shell",
  "sh",
  "json",
  "go",
  "rust",
  "java",
  "ruby",
  "php",
  "csharp",
  "c#",
  ".net",
]);

/**
 * Infers a syntax-highlighting language identifier for an unlabeled code block.
 */
function inferCodeLanguage(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return "";

  // JSON object or array
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    if (/"[^"]+"\s*:/.test(trimmed)) {
      return "json";
    }
  }

  // Python
  if (
    /^(from\s+[\w.]+\s+import\s+|import\s+\w+)/m.test(trimmed) &&
    (/\bprint\s*\(/.test(trimmed) ||
      /\bdef\s+\w+/.test(trimmed) ||
      /\w+_\w+\s*=/.test(trimmed) ||
      /#\s*api_key=/.test(trimmed))
  ) {
    return "python";
  }

  // TypeScript / JavaScript
  if (
    /\b(const|let|var)\s+\w+\s*=/.test(trimmed) ||
    /\bawait\s+\w+/.test(trimmed) ||
    /\bconsole\.(log|error|warn)\s*\(/.test(trimmed) ||
    /^import\s+\{.*\}\s+from\s+['"]/m.test(trimmed)
  ) {
    return "typescript";
  }

  // Bash / Shell / CLI / cURL
  if (
    /^(curl|npx|npm|pnpm|yarn|bun|pip|brew|docker|git|firecrawl|codex|claude|droid)\b/m.test(
      trimmed
    ) ||
    /^[A-Z_]+=\$\(/m.test(trimmed)
  ) {
    return "bash";
  }

  return "";
}

/**
 * Cleans trailing backslash artifacts inside a code block while preserving
 * legitimate shell line continuations (` \`).
 */
function cleanCodeBlockContent(code: string, lang: string): string {
  const lines = code.split("\n");
  const isShell = lang === "bash" || lang === "sh" || lang === "shell";

  const cleanedLines = lines.map((line) => {
    // Convert double trailing backslash ` \\` on shell commands into a single continuation ` \`
    if (isShell && /\s\\\\\s*$/.test(line)) {
      return line.replace(/\s\\\\\s*$/, " \\");
    }

    // Strip single trailing backslash that was added as a line-break escape by HTML-to-MD
    if (/\\+$/.test(line)) {
      // In shell blocks, keep ` \` only if it's a command continuation (preceded by space, not a comment)
      if (
        isShell &&
        /\s\\\s*$/.test(line) &&
        !/^\s*#/.test(line) &&
        !/['")}\]]\\\s*$/.test(line)
      ) {
        return line.replace(/\s+$/, "");
      }
      return line.replace(/\\+$/, "");
    }

    return line;
  });

  // Unescape markdown-escaped characters that leaked into code blocks (e.g. `\[`, `\]`, `\_`)
  return cleanedLines
    .join("\n")
    .replace(/\\([[\]_])/g, "$1")
    .trim();
}

/**
 * Main preprocessing pipeline to clean raw scraped Markdown from a single page.
 */
export function cleanDocumentationMarkdown(rawMarkdown: string): string {
  if (!rawMarkdown) return "";

  let text = rawMarkdown
    // 1. Normalize line endings & strip invisible zero-width characters
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");

  // 2. Fix line-level trailing backslash escapes outside/around blocks
  // e.g. lines that are just `\` or `\\`, or ` ```\ `, or headings/prose ending in `\`
  text = text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      // Line that is only backslashes -> empty line
      if (/^\\+$/.test(trimmed)) return "";
      // Code fence with trailing backslash ` ```\ ` -> ` ``` `
      if (/^```[\w-]*\\+$/.test(trimmed)) {
        return trimmed.replace(/\\+$/, "");
      }
      return line;
    })
    .join("\n");

  // 3. Convert multiline card links into clean bullet points before stripping remaining trailing `\`
  // Matches: [**Title** \\\n\\\nDescription](url)
  text = text.replace(
    /\[\*\*([^*\n]+)\*\*\s*(?:\\+\s*\n+|\n+)(?:\\+\s*\n+)*([\s\S]*?)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g,
    (_match, title: string, desc: string, url: string) => {
      const cleanTitle = title.replace(/\\+/g, "").trim();
      const cleanDesc = desc
        .replace(/\\+\s*\n/g, " ")
        .replace(/\\+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const cleanUrl = url.replace(/\\#/g, "#").trim();
      return cleanDesc
        ? `- **[${cleanTitle}](${cleanUrl})** — ${cleanDesc}`
        : `- **[${cleanTitle}](${cleanUrl})**`;
    }
  );

  // 4. Now process fenced code blocks vs non-code segments
  const segments = text.split(/(^```[\w-]*\n[\s\S]*?^```)/gm);

  const processedSegments = segments.map((segment) => {
    if (segment.startsWith("```")) {
      const firstNewline = segment.indexOf("\n");
      const openFence = segment.slice(0, firstNewline).trim();
      const existingLang = openFence.slice(3).trim();
      const bodyWithClose = segment.slice(firstNewline + 1);
      const body = bodyWithClose.replace(/\n```\s*$/, "");

      const detectedLang =
        existingLang ||
        inferCodeLanguage(body.replace(/\\+$/gm, "").trim());
      const cleanedBody = cleanCodeBlockContent(body, detectedLang);
      return `\`\`\`${detectedLang}\n${cleanedBody}\n\`\`\``;
    }

    // Process non-code prose segment
    let prose = segment;

    // Remove Mintlify `> ## Documentation Index` llms.txt boilerplate block
    prose = prose.replace(
      /^>\s*##\s*Documentation Index\s*\n(?:>\s*.*\n)*/gim,
      ""
    );

    // Convert dollar-prefixed inline shell commands: $`command` -> fenced bash block
    prose = prose.replace(/^\s*\$`([^`\n]+)`\s*$/gm, (_m, cmd: string) => {
      return `\`\`\`bash\n${cmd.trim()}\n\`\`\``;
    });

    // Clean concatenated tab bar with inline SVG icons:
    // e.g. ![](https://...svg)**ChatGPT & Codex** Install plugin![](https://...svg)...
    prose = prose.replace(
      /^(?:!\[[^\]]*\]\([^)]+\)\*\*[^*]+\*\*[^!\n]*){2,}$/gm,
      ""
    );

    // Strip decorative inline images inside links: [![](url)Label](href) -> [Label](href)
    prose = prose.replace(
      /\[\s*!\[[^\]]*\]\([^)]+\)\s*([^\]]+)\]\(([^)]+)\)/g,
      "[$1]($2)"
    );

    // Clean empty/zero-width anchor links inside headings:
    // e.g. `## [](url) Get started` or `## [#](url) Get started` -> `## Get started`
    prose = prose.replace(
      /^(#{1,6})\s+\[(?:#|\s*)\]\([^)]*\)\s*/gm,
      "$1 "
    );

    // Unescape `\#` and `\_` in markdown links
    prose = prose.replace(/\\#/g, "#");

    // Clean `filename.jsonCopy` or `Copy` button text artifacts
    prose = prose.replace(/^([\w.-]+\.(?:json|ya?ml|ts|js|py|sh|toml|md))Copy\s*$/gim, "**`$1`**");

    // Process line-by-line to remove hydration JSON blobs, UI chrome, and trailing backslashes
    const lines = prose.split("\n");
    const filteredLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      // Strip trailing backslash escape on prose lines
      let line = lines[i].replace(/\\+$/, "").trimEnd();
      const trimmed = line.trim();

      // Skip massive SSR hydration / Mintlify config JSON dumps
      if (
        (trimmed.startsWith('{"docsConfig":') ||
          trimmed.startsWith('{"props":') ||
          trimmed.startsWith('{"pageProps":') ||
          trimmed.includes('"compiledSource":') ||
          trimmed.includes('"mdxSource":') ||
          trimmed.includes('"headHtml":') ||
          trimmed.includes("self.__next_f.push")) &&
        trimmed.length > 300
      ) {
        continue;
      }

      // Skip any single-line raw JSON/CSS/JS dump over 2,000 chars outside code blocks
      if (
        trimmed.length > 2000 &&
        (trimmed.startsWith("{") || trimmed.startsWith("["))
      ) {
        continue;
      }

      // Skip Skip-to-content links
      if (/^\[skip to (?:main )?content\]\([^)]*\)$/i.test(trimmed)) {
        continue;
      }

      // Skip standalone Copy / Copied button labels
      if (/^(copy|copied!?|setup for agents)$/i.test(trimmed)) {
        continue;
      }

      // Skip Suggest edits / Raise issue footer links
      if (
        /^\[suggest edits\]\([^)]*\)(?:\s*\[raise issue\]\([^)]*\))?$/i.test(
          trimmed
        ) ||
        /^\[raise issue\]\([^)]*\)$/i.test(trimmed)
      ) {
        continue;
      }

      // Skip floating chat widget artifacts
      if (
        trimmed === "✕" ||
        trimmed === "×" ||
        /^-\s*👋\s*Hi!\s*Power AI agents/i.test(trimmed) ||
        /^-\s*I can help with search, scrape, MCP setup/i.test(trimmed) ||
        /^Ask AI$/i.test(trimmed) ||
        /^Was this page helpful\??$/i.test(trimmed)
      ) {
        continue;
      }

      // Convert standalone "Response" labels before code blocks into a clean bold label
      if (/^Response$/i.test(trimmed)) {
        // Avoid duplicate consecutive "**Response:**"
        const prevNonEmpty = [...filteredLines]
          .reverse()
          .find((l) => l.trim().length > 0);
        if (prevNonEmpty?.trim() === "**Response:**") {
          continue;
        }
        filteredLines.push("**Response:**");
        continue;
      }

      // Skip floating single-word language tab labels (e.g., "Python", "Node", "cURL", "CLI", "JSON")
      if (LANGUAGE_TABS.has(trimmed.toLowerCase())) {
        continue;
      }

      filteredLines.push(line);
    }

    return filteredLines.join("\n");
  });

  return (
    processedSegments
      .join("\n")
      // Replace `* * *` with standard `---`
      .replace(/^\*\s+\*\s+\*\s*$/gm, "---")
      // Ensure a blank line after `---` before a heading
      .replace(/^---\n(#{1,6}\s)/gm, "---\n\n$1")
      // Collapse blank lines between consecutive card bullet items (`- **[Title](url)**`)
      .replace(/(^- \*\*\[[^\]]+\]\([^)]+\)\*\*[^\n]*)\n\n+(?=- \*\*\[)/gm, "$1\n")
      // Collapse 3+ consecutive newlines into 2 newlines
      .replace(/\n{3,}/g, "\n\n")
      // Remove duplicate consecutive `---` dividers
      .replace(/(?:^---\s*\n+){2,}/gm, "---\n\n")
      .trim()
  );
}

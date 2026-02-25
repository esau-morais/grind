// Placeholder tokens — control chars that survive HTML escaping (&, <, > untouched)
const CB = "\x02CB"; // fenced code block
const IC = "\x02IC"; // inline code
const PE = "\x02"; // placeholder end

export function markdownToTelegramHtml(text: string): string {
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // 1. Extract fenced code blocks — escape content, wrap in <pre><code>
  let out = text.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, lang: string, code: string) => {
    const escaped = escapeHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return `${CB}${codeBlocks.length - 1}${PE}`;
  });

  // 2. Extract inline code — escape content, wrap in <code>
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${IC}${inlineCodes.length - 1}${PE}`;
  });

  // 3. Convert markdown tables → readable text lines (before HTML escaping)
  out = convertTables(out);

  // 4. HTML-escape all remaining plain text (&, <, >)
  //    Placeholders contain only \x02, digits, letters — none are escaped
  out = escapeHtml(out);

  // 5. Apply inline markdown patterns (operate on already-escaped text)

  // Blockquotes — &gt; is the escaped > from step 4
  out = out.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");

  // ATX headings: # / ## / ###
  out = out.replace(/^#{1,3}\s+(.+)$/gm, "<b>$1</b>");

  // Bold: **text** or __text__ (no s-flag: don't span newlines)
  out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  out = out.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* — must not be adjacent to another * (avoids matching bold remnants)
  out = out.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Italic: _text_ — word-boundary guard to avoid `some_var_name`
  out = out.replace(/(?<![a-zA-Z0-9_])_([^_\n]+?)_(?![a-zA-Z0-9_])/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  out = out.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url) — text is already HTML-safe from step 4
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Horizontal rules
  out = out.replace(/^[-*]{3,}$/gm, "──────────");

  // 6. Restore placeholders
  out = out.replace(
    new RegExp(`${CB}(\\d+)${PE}`, "g"),
    (_, i: string) => codeBlocks[Number(i)] ?? "",
  );
  out = out.replace(
    new RegExp(`${IC}(\\d+)${PE}`, "g"),
    (_, i: string) => inlineCodes[Number(i)] ?? "",
  );

  return out;
}

function convertTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? "")) {
      const headerCells = parseTableRow(line);
      i += 2; // skip header + separator

      const dataRows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        dataRows.push(parseTableRow(lines[i] ?? ""));
        i++;
      }

      // Header row — cells joined with │ (bold pass in step 5 will style any **cell** content)
      if (headerCells.some((c) => c.length > 0)) {
        out.push(headerCells.join(" │ "));
      }
      for (const row of dataRows) {
        out.push(row.join(" │ "));
      }
      out.push("");
    } else {
      out.push(line);
      i++;
    }
  }

  return out.join("\n");
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

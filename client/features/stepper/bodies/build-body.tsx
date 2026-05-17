// Build step body: the actual DSL string sent to Arkiv, colorised so kw/str/num
// tokens stand out. Comes straight from the search:built event.

export interface BuildBodyProps {
  dsl?: string;
  termCount?: number;
}

export function BuildBody({ dsl, termCount }: BuildBodyProps) {
  if (!dsl) {
    return <span className="italic text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-foreground/80">
        {termCount ?? 0} OR terms + scope/creator filters
      </p>
      <pre
        className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-muted/30 p-2.5 font-mono text-[11.5px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: colorise(dsl) }}
      />
    </div>
  );
}

const KEYWORDS = /\b(cell_id_\d+|kind|model_id|centroid_set_id|chunk_index|lang|parent_doc_id|project|protocol_version|\$creator)\b/g;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// Tiny syntax highlighter for the Arkiv DSL. Uses a VSCode Light-style
// palette (purple keywords / red strings / green numbers) rather than the
// Arkiv brand tokens — code is universally easier to scan when the colours
// follow the conventions every developer already knows.
function colorise(dsl: string): string {
  return escapeHtml(dsl)
    .replace(
      /(&quot;[^&]*?&quot;)/g,
      '<span class="text-red-700 dark:text-red-400">$1</span>',
    )
    .replace(
      KEYWORDS,
      '<span class="text-purple-700 dark:text-purple-400">$1</span>',
    )
    .replace(
      /(?<=[=<>!~]\s)(\d+)\b/g,
      '<span class="text-emerald-700 dark:text-emerald-400">$1</span>',
    );
}

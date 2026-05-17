// Pill row of pre-canned queries. Clicking one fills the search input via
// the parent-supplied callback.

const EXAMPLES = [
  "Who composed the four seasons",
  "Animals that hibernate in winter",
  "Ancient civilizations",
  "Incurable diseases",
  "Languages spoken by only a handful of people",
  "Animals that change color to hide from predators",
  "How does a computer work",
  "Mathematical problems unsolved for centuries",
] as const

export function ExampleQueries({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mt-5 flex flex-wrap gap-1.5">
      {EXAMPLES.map((ex) => (
        <button
          key={ex}
          type="button"
          onClick={() => onPick(ex)}
          className="rounded-sm border border-border bg-transparent px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-foreground"
        >
          {ex}
        </button>
      ))}
    </div>
  )
}

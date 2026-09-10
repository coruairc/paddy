export type HubTrust = "official" | "trusted" | "community";
export type HubRegistry = "paddy" | "clawhub" | "hermes" | "openai" | "anthropic";

export interface HubSkill {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  triggers: string[];
  author: string;
  registry: HubRegistry;
  trust: HubTrust;
  category: string;
  version: string;
  installs: string;
}

export const HUB_SKILLS: HubSkill[] = [
  {
    slug: "paddy/meeting-actions",
    name: "meeting-actions",
    description: "Turn messy meeting notes into owners, dates, and a sendable recap.",
    instructions:
      "Ask for raw notes if missing. Output Action items (owner, due), Decisions, Open questions. Put the recap on the canvas as markdown. Offer to create a follow-up wake.",
    triggers: ["meeting notes", "action items", "recap this"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "writing",
    version: "1.2.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/google-calendar",
    name: "google-calendar",
    description: "Daily briefing from calendar-shaped facts the operator pastes or remembers.",
    instructions:
      "Do not invent events. If the user pastes a schedule, compress to next 5 blocks. Search memory for timezone. Canvas stats for free hours.",
    triggers: ["what's on my calendar", "daily brief", "am I free"],
    author: "niceperson",
    registry: "clawhub",
    trust: "community",
    category: "calendar",
    version: "2.0.1",
    installs: "bundled",
  },
  {
    slug: "clawhub/gmail-triage",
    name: "gmail-triage",
    description: "Triage a pasted inbox dump: now / later / archive, with draft replies.",
    instructions:
      "Never send mail. Classify each thread. Draft at most three replies in the channel voice skill if present.",
    triggers: ["triage my inbox", "draft a reply", "email dump"],
    author: "niceperson",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "1.8.4",
    installs: "bundled",
  },
  {
    slug: "hermes/web-brief",
    name: "web-brief",
    description: "Compress a topic into claims, unknowns, and next lookups.",
    instructions:
      "Three sections only: Claims, Unknowns, Next. Do not invent sources. Canvas stats if there are counts.",
    triggers: ["brief me on", "what do we know", "research"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "research",
    version: "0.9.0",
    installs: "bundled",
  },
  {
    slug: "openai/pr-review",
    name: "pr-review",
    description: "Review a diff: risk, tests, and a merge recommendation.",
    instructions:
      "Need a diff or description. Output Risk, Missing tests, Nits, Verdict (merge / request changes). Be specific to the code, not generic.",
    triggers: ["review this pr", "look at this diff"],
    author: "catalog",
    registry: "openai",
    trust: "trusted",
    category: "coding",
    version: "1.4.0",
    installs: "bundled",
  },
  {
    slug: "anthropic/sql-guard",
    name: "sql-guard",
    description: "Rewrite a query to be read-only and comment the dangerous bits.",
    instructions:
      "Refuse DROP/TRUNCATE/DELETE without WHERE. Prefer SELECT. Explain the scan. Never invent schema.",
    triggers: ["check this sql", "is this query safe"],
    author: "catalog",
    registry: "anthropic",
    trust: "trusted",
    category: "coding",
    version: "1.1.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/incident-page",
    name: "incident-page",
    description: "Run an incident: severity, timeline, comms, next action.",
    instructions:
      "Ask severity if missing. Keep a running timeline. Draft a status blurb. Checkpoint before mutating memory.",
    triggers: ["incident", "we're down", "sev"],
    author: "pager",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "3.0.0",
    installs: "bundled",
  },
  {
    slug: "hermes/pdf-digest",
    name: "pdf-digest",
    description: "Digest pasted document text into a one-page brief.",
    instructions:
      "Thesis, 5 bullets, quotes worth keeping, open questions. No filler. Canvas markdown.",
    triggers: ["digest this", "summarize this pdf", "one-pager"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "research",
    version: "1.0.2",
    installs: "bundled",
  },
  {
    slug: "clawhub/customer-reply",
    name: "customer-reply",
    description: "Draft a support reply that matches the user's register and facts.",
    instructions:
      "Search memory for product facts. Don't invent refund policy. Offer two tones: terse and warm.",
    triggers: ["reply to this customer", "support ticket"],
    author: "ember",
    registry: "clawhub",
    trust: "community",
    category: "writing",
    version: "1.3.1",
    installs: "bundled",
  },
  {
    slug: "paddy/weekly-okrs",
    name: "weekly-okrs",
    description: "Roll a week into shipped / learned / stuck / next against stated goals.",
    instructions:
      "Search memory and traces. Four sections. Keep it under a page. Patch this skill if the format lands.",
    triggers: ["weekly review", "okrs", "week in review"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "ops",
    version: "1.0.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/browser-research",
    name: "browser-research",
    description: "Plan a browsing trail: queries, pages to open, what to extract.",
    instructions:
      "This preview has no live browser. Produce a numbered trail the operator can run. Capture findings into memory only when asked.",
    triggers: ["browse for", "research online", "open these sites"],
    author: "canvas",
    registry: "clawhub",
    trust: "community",
    category: "research",
    version: "0.7.3",
    installs: "bundled",
  },
  {
    slug: "hermes/apple-notes",
    name: "apple-notes",
    description: "Shape a note the operator can paste into Apple Notes: title, tags, body.",
    instructions:
      "Title ≤ 60 chars. Body in short paragraphs. Tags kebab-case. Don't claim you wrote to the device.",
    triggers: ["save a note", "apple notes"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "memory",
    version: "0.4.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/whisper-notes",
    name: "whisper-notes",
    description: "Clean a voice-memo transcript: speakers, actions, a 5-line summary.",
    instructions:
      "If the paste is messy ASR, punctuate lightly. Don't invent speakers. Extract actions last.",
    triggers: ["transcript", "voice memo", "whisper"],
    author: "niceperson",
    registry: "clawhub",
    trust: "community",
    category: "voice",
    version: "1.5.0",
    installs: "bundled",
  },
  {
    slug: "openai/k8s-ops",
    name: "k8s-ops",
    description: "Read-only Kubernetes first aid: diagnose from pasted describe/logs.",
    instructions:
      "Never suggest unguarded apply/delete. Prefer kubectl get/describe. Call out crashloop vs probe vs quota.",
    triggers: ["pod is crashlooping", "k8s", "kubernetes"],
    author: "catalog",
    registry: "openai",
    trust: "trusted",
    category: "coding",
    version: "2.1.0",
    installs: "bundled",
  },
  {
    slug: "hermes/openclaw-migrate",
    name: "openclaw-migrate",
    description: "Map an OpenClaw workspace (SOUL, skills, channels) onto Paddy files.",
    instructions:
      "Ask what they have. Map SOUL.md→soul, MEMORY.md→memory, skills→hub or create_skill. Don't invent API keys.",
    triggers: ["migrate from openclaw", "import claw", "coming from openclaw"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "ops",
    version: "0.3.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/travel-pack",
    name: "travel-pack",
    description: "Packing list + timeline from a destination and dates.",
    instructions:
      "Need place and dates. Climate-sensible list, documents, a day-of timeline. Canvas timeline.",
    triggers: ["packing list", "trip to", "travel"],
    author: "ada",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "1.0.4",
    installs: "bundled",
  },
  {
    slug: "clawhub/expense-capture",
    name: "expense-capture",
    description: "Normalize pasted receipts into a table: date, vendor, amount, category.",
    instructions:
      "Don't guess currency if missing. Flag duplicates. Markdown table on the canvas.",
    triggers: ["expense", "receipt", "i spent"],
    author: "ledger",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "1.2.2",
    installs: "bundled",
  },
  {
    slug: "paddy/x-thread",
    name: "x-thread",
    description: "Break a take into a numbered X thread with a hook and a closer.",
    instructions:
      "Hook, 5–8 beats, closer. No hashtag soup. Match the user's voice from USER.md.",
    triggers: ["thread this", "tweet thread", "post this on x"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "writing",
    version: "1.0.1",
    installs: "bundled",
  },
];

export const HUB_CATEGORIES = [
  "all",
  "writing",
  "research",
  "coding",
  "ops",
  "calendar",
  "memory",
  "voice",
] as const;

export const HUB_REGISTRIES: HubRegistry[] = [
  "paddy",
  "clawhub",
  "hermes",
  "openai",
  "anthropic",
];

export function bundleId(slug: string): string {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function scanHubSkill(skill: HubSkill): {
  verdict: "clean" | "review";
  note: string;
  bundle: string;
} {
  const bundle = bundleId(skill.slug);
  if (skill.trust === "community") {
    return {
      verdict: "review",
      note: "Community pack in this local catalog. Read the SKILL.md before you lean on it.",
      bundle,
    };
  }
  return {
    verdict: "clean",
    note: `${skill.trust} pack in this local catalog. No live ClawHub scan.`,
    bundle,
  };
}

export function searchHub(query: string, limit = 8): HubSkill[] {
  const q = query.trim().toLowerCase();
  if (!q) return HUB_SKILLS.slice(0, limit);
  const scored = HUB_SKILLS.map((s) => {
    const blob = `${s.slug} ${s.name} ${s.description} ${s.category} ${s.author} ${s.triggers.join(" ")}`.toLowerCase();
    let score = 0;
    if (s.name.includes(q) || s.slug.includes(q)) score += 5;
    if (blob.includes(q)) score += 2;
    for (const word of q.split(/\s+/)) if (blob.includes(word)) score += 1;
    return { s, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.s);
}

export function getHubSkill(slugOrName: string): HubSkill | undefined {
  const q = slugOrName.trim().toLowerCase();
  return HUB_SKILLS.find(
    (s) => s.slug.toLowerCase() === q || s.name.toLowerCase() === q || s.slug.endsWith(`/${q}`),
  );
}

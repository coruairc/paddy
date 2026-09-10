import { HUB_SKILLS as CATALOG } from "./hub-catalog.mjs";

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

export const HUB_SKILLS: HubSkill[] = CATALOG as HubSkill[];

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

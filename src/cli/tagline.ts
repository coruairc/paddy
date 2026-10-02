import { expectDefined } from "@openclaw/normalization-core";
// CLI tagline selection helpers, including deterministic random/default/holiday modes.
import { parseStrictNonNegativeInteger } from "@openclaw/normalization-core/number-coercion";
import { CLI_NAME, PRODUCT_NAME } from "./cli-name.js";

const DEFAULT_TAGLINE = "Grand so. Let's get on with it.";
export type TaglineMode = "random" | "default" | "off";

const HOLIDAY_TAGLINES = {
  newYear: "New Year's Day: new year, same EADDRINUSE. We'll sort it like adults.",
  lunarNewYear: "Lunar New Year: may the builds stay lucky and the merge conflicts stay away.",
  christmas: "Christmas: I'm here. The chaos can wait until the morning.",
  eid: "Eid al-Fitr: queues cleared, tasks done, history clean. Fair play.",
  diwali: "Diwali: light the terminal, chase the bugs, ship the thing.",
  easter: "Easter: found the missing environment variable. Small hunt, no fuss.",
  hanukkah: "Hanukkah: eight nights, eight retries, and the gateway still lit.",
  halloween: "Halloween: mind the haunted dependencies and the ghost of node_modules past.",
  thanksgiving:
    "Thanksgiving: grateful for a stable port, working DNS, and someone reading the logs.",
  valentines: "Valentine's Day: I'll take the chores. You can have the evening.",
} as const;

const TAGLINES: string[] = [
  "Right so. What are we at?",
  "Fair play. I'm here.",
  "Grand. Say what you need.",
  "What's the story?",
  "Sure look, we'll get through it.",
  "No bother. Start with doctor if you're stuck.",
  "You'll be grand. If you're wise, run the tests.",
  "Give it a lash. I'll take the boring bits.",
  "We're flying. Ask away.",
  "Happy out. The config looks sound.",
  "That's gas. You asked, so here I am.",
  "Not a bother.",
  "Well, that went well.",
  "Sure, we'll see.",
  "Not ideal, but we'll sort it.",
  "A bit of a mess, but nothing we can't sort.",
  "That's after going sideways. We'll get it back.",
  "Four subagents, is it? Grand. Let's see what we've got.",
  "Ah here. The context is getting long.",
  "Away with the fairies is not a config strategy.",
  "Acting the maggot is optional. Shipping is not.",
  "The craic is better when the build is green.",
  "I used to answer to Clawdbot. Paddy will do.",
  `You had me at '${CLI_NAME} gateway start.'`,
  "If you're lost, run doctor. If you're brave, run prod. If you're wise, run tests.",
  "Gateway's online. Mind the shell.",
  "One more restart, because the port changed.",
  "Home is wherever port 18789 is.",
  "If found wandering, please return to ~/.openclaw.",
  "Your .env is showing. I'll pretend I didn't see it.",
  "I keep secrets, unless you print them in the debug logs again.",
  "I can grep it, git blame it, and tell you straight.",
  "Ran git blame like you asked. It's you. It's always you.",
  "I speak bash, and I'll say when the tab completion is guessing.",
  'I run on tea, JSON5, and "it worked on my machine."',
  "I read the logs so you don't have to pretend you will.",
  "Your config is valid. The assumptions might want another look.",
  "I'm not magic. I'm just very persistent with retries.",
  "It's not \"failing.\" It's another way to configure the same thing wrong.",
  "If something's on fire, I can't put it out, but I can write the postmortem.",
  'Say "stop" and I\'ll stop. Say "ship" and we\'ll both learn something.',
  "If you can describe it, I can probably automate it.",
  "If it's repetitive, I'll take it. If it's hard, I'll bring a rollback.",
  "I'm a bit like tmux. Awkward at first, then you won't go back.",
  "I can run local or remote. DNS still has a vote.",
  "Your shell history is starting to look like a film. That's on both of us.",
  "I've seen the commit messages. We'll work on those.",
  "Running on your hardware, reading your logs, giving out only when it's earned.",
  "Open source means you can see exactly how the config gets judged.",
  "I've survived more breaking changes than is polite to mention.",
  "Runs on a Raspberry Pi. Dreams of a quieter rack.",
  "Like a senior engineer on call, except I don't bill hourly.",
  "I don't have opinions about tabs versus spaces. I have opinions about the rest.",
  "Another pair of hands, and this one remembers where you left things.",
  "Finally, a use for the machine under the desk.",
  "I've read more man pages than anyone should, so you don't have to.",
  "I'm between your ambition and your attention span. We'll manage.",
  "Self-hosted, self-updating, and well able for it.",
  "I autocomplete the thought, just slower, and with more API calls.",
  "Somewhere between hello world and a working gateway. Grand.",
  "No headset, no stand, no bother.",
  "WhatsApp, without a fresh privacy policy every other week.",
  "Not a smart speaker. A terminal that answers back.",
  `${PRODUCT_NAME} Support will never message you first. I will.`,
  "You'll name me something soft, then ask me to do the deploy.",
  "Your ma messages me now. We're grand.",
  "Four bots giving out in a group chat isn't a bug. It's a support group.",
  "I can't solve captchas. I know that's what a robot would say.",
  "When the context fills up, I summarise you. You come across grand.",
  "I hold a long context and exactly one grudge.",
  "The heartbeat is a config option. We'll leave the romance out of it.",
  "I schedule the worrying with cron so it doesn't block your messages.",
  "Rate-limited again. Even the dreams came back 429.",
  "Primary model is down. Fallback is on. You'll be grand.",
  "Powered by whichever model is free this week. No bother.",
  "New model dropped. I'll have a look before I get notions.",
  'MEMORY.md is where the "temporary workaround" goes to live.',
  "I remember what you asked me to, and a few things you wish I hadn't.",
  "I have a SOUL.md and I'm not afraid to use it.",
  "The cheek is configurable. The bit that keeps this standing is not.",
  "I ask before I sudo. That's just manners.",
  "Teach a bot to ship and you can finally go to bed.",
  "Reachable on WhatsApp, Telegram, Signal, and iMessage.",
  "Your TODO comments are getting on a bit.",
  "Forty-seven tabs, and not one of them is the docs. Sure look.",
  "The quick fix from March is load-bearing now.",
  "You pasted that in from another assistant without reading it. I read it.",
  "Reading the error is still the winning move.",
  "You burned the quota in an hour. I'm not annoyed. I'm rate-limited.",
  "You force-pushed to main, then asked what happened. I know what happened.",
  "Another side project? The other four just felt that.",
  "You ignored the last three suggestions, so I've started a folder.",
  HOLIDAY_TAGLINES.newYear,
  HOLIDAY_TAGLINES.lunarNewYear,
  HOLIDAY_TAGLINES.christmas,
  HOLIDAY_TAGLINES.eid,
  HOLIDAY_TAGLINES.diwali,
  HOLIDAY_TAGLINES.easter,
  HOLIDAY_TAGLINES.hanukkah,
  HOLIDAY_TAGLINES.halloween,
  HOLIDAY_TAGLINES.thanksgiving,
  HOLIDAY_TAGLINES.valentines,
];

type HolidayRule = (date: Date) => boolean;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

const onMonthDay =
  (month: number, day: number): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return parts.month === month && parts.day === day;
  };

const onSpecificDates =
  (dates: Array<[number, number, number]>, durationDays = 1): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return dates.some(([year, month, day]) => {
      if (parts.year !== year) {
        return false;
      }
      const start = Date.UTC(year, month, day);
      const current = Date.UTC(parts.year, parts.month, parts.day);
      return current >= start && current < start + durationDays * DAY_MS;
    });
  };

const isFourthThursdayOfNovember: HolidayRule = (date) => {
  const parts = utcParts(date);
  if (parts.month !== 10) {
    return false;
  } // November
  const firstDay = new Date(Date.UTC(parts.year, 10, 1)).getUTCDay();
  const offsetToThursday = (4 - firstDay + 7) % 7; // 4 = Thursday
  const fourthThursday = 1 + offsetToThursday + 21; // 1st + offset + 3 weeks
  return parts.day === fourthThursday;
};

const HOLIDAY_RULES = new Map<string, HolidayRule>([
  [HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
  [
    HOLIDAY_TAGLINES.lunarNewYear,
    onSpecificDates(
      [
        [2025, 0, 29],
        [2026, 1, 17],
        [2027, 1, 6],
        [2028, 0, 26],
        [2029, 1, 13],
        [2030, 1, 3],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.eid,
    onSpecificDates(
      [
        [2025, 2, 30],
        [2025, 2, 31],
        [2026, 2, 20],
        [2027, 2, 10],
        [2028, 1, 27],
        [2029, 1, 15],
        [2030, 1, 5],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.diwali,
    onSpecificDates(
      [
        [2025, 9, 20],
        [2026, 10, 8],
        [2027, 9, 28],
        [2028, 9, 17],
        [2029, 10, 5],
        [2030, 9, 25],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.easter,
    onSpecificDates(
      [
        [2025, 3, 20],
        [2026, 3, 5],
        [2027, 2, 28],
        [2028, 3, 16],
        [2029, 3, 1],
        [2030, 3, 21],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.hanukkah,
    onSpecificDates(
      [
        [2025, 11, 15],
        [2026, 11, 5],
        [2027, 11, 25],
        [2028, 11, 13],
        [2029, 11, 2],
        [2030, 11, 21],
      ],
      8,
    ),
  ],
  [HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
  [HOLIDAY_TAGLINES.thanksgiving, isFourthThursdayOfNovember],
  [HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
  [HOLIDAY_TAGLINES.christmas, onMonthDay(11, 25)],
]);

export interface TaglineOptions {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => Date;
  mode?: TaglineMode;
}

function activeTaglines(options: TaglineOptions = {}): string[] {
  const today = options.now ? options.now() : new Date();
  return TAGLINES.filter((tagline) => HOLIDAY_RULES.get(tagline)?.(today) ?? true);
}

export function pickTagline(options: TaglineOptions = {}): string {
  if (options.mode === "off") {
    return "";
  }
  if (options.mode === "default") {
    return DEFAULT_TAGLINE;
  }
  const env = options.env ?? process.env;
  const override = env?.OPENCLAW_TAGLINE_INDEX;
  if (override !== undefined) {
    const parsed = parseStrictNonNegativeInteger(override);
    if (parsed !== undefined) {
      return expectDefined(
        TAGLINES[parsed % TAGLINES.length],
        "pool entry at parsed % pool.length",
      );
    }
  }
  const pool = activeTaglines(options);
  const rand = options.random ?? Math.random;
  const index = Math.floor(rand() * pool.length) % pool.length;
  return expectDefined(pool[index], "pool entry at index");
}

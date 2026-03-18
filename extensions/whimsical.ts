import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const messages = [
  // Yiddish & borrowed charm
  "Schlepping...",
  "Kibbitzing...",
  "Schmoozing...",
  "Schmalzing...",
  "Kerfuffling...",
  "Noodging...",

  // Delightfully archaic
  "Woolgathering...",
  "Perambulating...",
  "Confabulating...",
  "Cogitating...",
  "Pontificating...",
  "Absquatulating...",
  "Extemporizing...",
  "Fossicking...",

  // Kitchen verbs
  "Percolating...",
  "Simmering...",
  "Marinating...",
  "Fermenting...",
  "Steeping...",
  "Brewing...",
  "Concocting...",
  "Effervescing...",

  // Whimsical motion
  "Galumphing...",
  "Sashaying...",
  "Pirouetting...",
  "Somersaulting...",
  "Shimmying...",
  "Moseying...",
  "Traipsing...",
  "Sauntering...",
  "Meandering...",
  "Scampering...",
  "Frolicking...",
  "Gamboling...",

  // Playful procrastination
  "Dillydallying...",
  "Lollygagging...",
  "Dawdling...",
  "Puttering...",
  "Pottering...",
  "Faffing...",
  "Futzing...",
  "Dithering...",

  // Sound words
  "Kerplunking...",
  "Squelching...",
  "Swooshing...",
  "Burbling...",
  "Fizzing...",
  "Bubbling...",
  "Honking...",

  // Sparky
  "Scintillating...",
  "Bedazzling...",
  "Coruscating...",
  "Phosphorescing...",

  // Invented nonsense
  "Blorping...",
  "Flonking...",
  "Snurfling...",
  "Zorping...",
  "Splunging...",
  "Gonkulating...",
  "Splorfing...",
  "Combobulating...",
  "Recombobulating...",
  "Unbefuddling...",

  // Mischief
  "Bamboozling...",
  "Flummoxing...",
  "Befuddling...",
  "Discombobulating...",
  "Finagling...",
  "Swashbuckling...",
  "Defenestrating...",

  // Creative process
  "Noodling...",
  "Tinkering...",
  "Doodling...",
  "Improvising...",
  "Freestyling...",
  "Hatching...",
  "Transmuting...",
  "Synthesizing...",

  // Gentle vibes
  "Vibing...",
  "Daydreaming...",
  "Musing...",
  "Ruminating...",
  "Mulling...",
  "Contemplating...",

  // Sneaky
  "Skulking...",
  "Lurking...",
  "Sleuthing...",
  "Rummaging...",
  "Foraging...",

  // Flibbertigibbet deserves its own category
  "Flibbertigibbeting...",
];

const easterEggs = [
  "Asking the rubber duck...",
  "Consulting the oracle...",
  "Reading the tea leaves...",
  "Checking the crystal ball...",
  "Phoning a friend...",
  "Petting the code cat...",
  "Feeding the server hamsters...",
  "Reticulating splines...",
  "Herding cats...",
  "Counting backwards from infinity...",
  "Aligning the chakras...",
  "Untangling the spaghetti...",
  "Polishing the pixels...",
  "Waking the gremlins...",
  "Bribing the compiler...",
];

// --- Rarity colors (ANSI) ---
// Inner ANSI codes override the Loader's outer "muted" color
const RARITY_COLOR = {
  common: "",
  uncommon: "",
  rare: "",
  legendary: "\x1b[38;5;220m",  // gold
};

function colorize(text: string, rarity: keyof typeof RARITY_COLOR): string {
  const code = RARITY_COLOR[rarity];
  return code ? `${code}${text}` : text;
}

// --- Timing ---

const MIN_INTERVAL_MS = 2500;
const MAX_INTERVAL_MS = 10_000;

function randomInterval(): number {
  return MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

function pickFrom<T>(arr: T[]): T {
  const value = arr[Math.floor(Math.random() * arr.length)];
  if (value === undefined) {
    throw new Error("Cannot pick from an empty array");
  }
  return value;
}

type Rarity = keyof typeof RARITY_COLOR;

function rollRarity(): Rarity {
  const roll = Math.random();
  if (roll < 0.03) return "legendary"; // 3%
  if (roll < 0.19) return "rare";      // 16%
  if (roll < 0.45) return "uncommon";  // 26%
  return "common";                      // 55%
}

// --- Scheduler ---

type Ctx = { ui: { setWorkingMessage(msg?: string): void } };
let timeout: ReturnType<typeof setTimeout> | undefined;
let ctx: Ctx | undefined;

function clearTimer() {
  if (timeout) { clearTimeout(timeout); timeout = undefined; }
}

function schedule(fn: () => void, ms: number) {
  clearTimer();
  timeout = setTimeout(fn, ms);
}

function scheduleNext() {
  if (!ctx) return;
  const rarity = rollRarity();
  const pool = rarity === "legendary" ? easterEggs : messages;

  ctx.ui.setWorkingMessage(colorize(pickFrom(pool), rarity));
  schedule(scheduleNext, randomInterval());
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, c) => {
    ctx = c;
    ctx.ui.setWorkingMessage(pickFrom(messages));
    schedule(scheduleNext, randomInterval());
  });

  pi.on("turn_end", async () => {
    clearTimer();
    ctx = undefined;
  });
}

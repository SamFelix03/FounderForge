import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { createLogger } from "@founderforge/observability";
import type { PromoScript, RuntimeConfig, ScreenshotCapture, SelectedPage } from "./types.js";
import { truncate } from "./util.js";

const log = createLogger("promo.script");

const ShotSchema = z.object({
  start_s: z.number(),
  end_s: z.number(),
  shot_type: z.enum(["cinematic", "product_proof"]),
  visual: z.string(),
  image_refs: z.array(z.string()).default([]),
  voiceover_slice: z.string().optional().default(""),
  sound_notes: z.string().optional().default(""),
});

const PromoScriptSchema = z.object({
  concept: z.string(),
  big_idea: z.string(),
  tone: z.string(),
  voiceover: z.string().min(20),
  shot_list: z.array(ShotSchema).min(1),
  seedance_prompt: z.string().min(40),
});

const SCRIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    concept: { type: "string" },
    big_idea: { type: "string" },
    tone: { type: "string" },
    voiceover: { type: "string" },
    shot_list: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_s: { type: "number" },
          end_s: { type: "number" },
          shot_type: { type: "string", enum: ["cinematic", "product_proof"] },
          visual: { type: "string" },
          image_refs: { type: "array", items: { type: "string" } },
          voiceover_slice: { type: "string" },
          sound_notes: { type: "string" },
        },
        required: ["start_s", "end_s", "shot_type", "visual"],
      },
    },
    seedance_prompt: { type: "string" },
  },
  required: [
    "concept",
    "big_idea",
    "tone",
    "voiceover",
    "shot_list",
    "seedance_prompt",
  ],
};

function mimeForPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function buildScriptPrompt(
  cfg: RuntimeConfig,
  catalog: string,
): string {
  const duration = cfg.duration;
  const url = cfg.url;
  const aspectRatio = cfg.aspectRatio;

  return `You are an elite advertising creative director — the kind who makes people say
"wait, play that again" — not a product-demo narrator. You've been hired to
write a ${duration}-second promo AD for the product at this URL, in the style
of a real brand commercial (think: Apple, Nike, Duolingo, Liquid Death — bold,
funny, emotional, or weird, never a screen-recording with a voiceover on top).

PRODUCT URL: ${url}

You have a small set of REAL reference screenshots of this product's actual UI.
These are your only source of truth for what the product looks like — use them
ONLY for the moments where the ad needs to show the real product. Cite them in
Seedance style as "image 1", "image 2", etc. Do NOT invent UI that isn't shown
in these screenshots, and do NOT describe them as generic "app screens" — look
at what's actually in each one (the reason field tells you what it captures)
and use specific real details in your visuals and VO.

Available reference screenshots (each is an ABOVE-THE-FOLD / viewport hero
capture — treat them as premium hero shots, not tiny scroll captures):
${catalog}

═══════════════════════════════════════════════════════════════════
YOUR ACTUAL JOB: THIS IS AN ADVERT, NOT A UI WALKTHROUGH
═══════════════════════════════════════════════════════════════════

The screenshots are ingredients, not the whole meal. A killer ${duration}s ad
for this product should feel like a real campaign spot: it needs a HOOK, a
BIG IDEA (a metaphor, a joke, a tension, a world), and a payoff — with the
product's real UI dropped in at the 1-3 moments where showing it actually
lands harder than not showing it.

Most of the shots in this ad should NOT be screenshots. They should be
fully-generated cinematic content that Seedance creates from scratch:
real people, environments, objects, abstract visuals, physical metaphors,
humor beats, before/after moments — whatever best sells the emotional core
of what this product does for someone. Only cut to a screenshot when it's
the strongest way to prove a specific claim ("look, it actually does this").

Think like these are the two types of shots you're directing:
  (A) CINEMATIC / GENERATED shots — no image_refs. Fully imagined by Seedance:
      actors, locations, objects, motion graphics, metaphor visuals, physical
      comedy, environments — whatever the concept calls for. This should be
      the majority of the runtime.
  (B) PRODUCT PROOF shots — image_refs set to the specific "image N" being
      shown. Used sparingly, at the exact moment the ad needs to prove the
      product is real and show what it actually does. These should feel like
      a reveal, not a slide — camera pushes into the screen, UI is large and
      legible, held just long enough to read.

Before writing anything, invent a BIG IDEA for this specific product — a
metaphor, a scenario, a character, a running joke, an emotional truth about
the problem it solves — something that would make this ad memorable even to
someone with zero interest in the product category. Do not default to
"person struggles with problem, discovers app, life is now easy" unless you
can make that specific version genuinely funny, surprising, or emotionally
sharp. Generic SaaS-ad energy is a failure state.

═══════════════════════════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════════════════════════
- Duration: EXACTLY ${duration} seconds. Not "about" — exactly.
- Voiceover must be spoken in FULL within ${duration}s at a fast, punchy,
  trailer-paced read (~2.5-3 words/second is a safe budget for energetic VO —
  count your words and check the math before finalizing). No dead air, no
  wasted beats, no line you write that gets cut for time.
- The product's real UI must appear on screen at least once, using the actual
  screenshots provided, cited as "image 1" / "image 2" / etc. Never fabricate
  a UI citation for a screenshot that wasn't given to you.
- Every shot in the shot list must have a start_s/end_s that fits inside
  [0, ${duration}], shots must be contiguous and non-overlapping, and the
  final shot's end_s must equal ${duration} exactly.
- End on a clear, deliberate BRAND/PRODUCT ENDCARD moment — name, logo-style
  treatment, or a final line that unmistakably identifies the product. This
  is the last thing viewers see; don't let it get crowded out.
- Sound is not an afterthought. Direct music and SFX like a real ad: describe
  the actual sonic personality (e.g. "plucky, mischievous, slightly unhinged
  synth-pop" or "tense stripped-back percussion that explodes into a bright
  drop at the reveal") — never generic "upbeat corporate background music."
  SFX should be specific and diegetic where possible (UI clicks, whooshes,
  a real-world sound tied to the metaphor) not generic stock sweeteners.
- ON-SCREEN TEXT: If the video will include any generated text (titles, captions,
  endcard typography, labels, etc.), it must be ONLY in English and must use
  proper, error-free English — correct spelling, grammar, and punctuation with
  zero typos or broken words. Your seedance_prompt MUST include an explicit
  instruction to Seedance enforcing this rule.

═══════════════════════════════════════════════════════════════════
CREATIVE DIRECTION — HOW TO ACTUALLY MAKE IT GOOD
═══════════════════════════════════════════════════════════════════
- OPEN WITH A HOOK, NOT A LOGO. The first 1-2 seconds must earn attention —
  a visual surprise, a bold claim, a joke, an in-media-res moment. Nobody
  is contractually obligated to keep watching; earn every second.
- STRUCTURE: give the ad a shape — tension/release, setup/punchline,
  before/after, escalating chaos resolved by the product, or a single
  sustained joke/metaphor carried through to a satisfying product reveal.
  Don't just list features in order.
- SPECIFICITY BEATS POLISH. Reference something TRUE and SPECIFIC about this
  product (from the screenshots/URL) rather than vague category language.
  "Never lose the thread on a 40-tab research binge" beats "stay organized."
- ONE BIG IDEA, not five small ones. If you have a good metaphor, commit to
  it visually across multiple shots rather than touching it once and moving on.
- CAMERA LANGUAGE MATTERS for a generated-video prompt — direct it like a DP:
  whip pans, match cuts, push-ins, rack focus, needle-drop-timed cuts on the
  beat, physical comedy timing. Give Seedance real blocking, not just "shows
  a scene."
- VOICEOVER PERSONALITY: write it like a person with a point of view, not a
  narrator reading feature bullets. Confident, a little cheeky, rhythmically
  tight. Match the tone to the product's actual vibe (inferred from the
  screenshots/URL) rather than defaulting to generic "startup enthusiasm."
- PACING: vary shot length deliberately — quick cuts for energy/chaos beats,
  one longer held shot for the emotional or reveal beat. Uniform 2-second
  shots all the way through reads as lazy, not punchy.

═══════════════════════════════════════════════════════════════════
seedance_prompt REQUIREMENTS
═══════════════════════════════════════════════════════════════════
The seedance_prompt field must be a COMPLETE, ready-to-send prompt for
ByteDance Seedance 2.0, including:
- Aspect ratio: ${aspectRatio}
- A full "Shot N | start–end" script covering every shot, describing EACH
  shot's visual action/blocking/camera move in enough detail to generate
  directly — clearly marking which shots are cinematic/generated (no image
  reference) vs. which are product-proof shots that must render the real UI
  from a specific "image N"
- The full VO text, broken into per-shot slices matching the shot list,
  with pacing/delivery notes (e.g. "fast, deadpan," "building energy," "warm,
  slows down here")
- Explicit music/SFX direction as described above — specific personality,
  not corporate-generic, including where the music hits a beat/drop/turn
- An instruction block telling Seedance to generate synced dialogue/VO audio
  and music together with the visuals (generate_audio-style instruction),
  not as a silent video to be scored separately
- Explicit callouts of "image 1," "image 2," etc. at the exact shots where
  the real product must appear, and explicit notes elsewhere that other
  shots are fully generated/imagined (no reference image)
- A closing line locking in the endcard moment (branding, logo treatment,
  final product name callout)
- A mandatory instruction block directed at Seedance: if the model generates any
  on-screen text in the video (titles, captions, typography, labels, etc.), that
  text must be ONLY in English and must be proper, error-free English — correct
  spelling, grammar, and punctuation with no typos, no garbled words, and no
  other languages. Include this instruction verbatim in the seedance_prompt so
  Segmind receives it with every generation request.

═══════════════════════════════════════════════════════════════════
OUTPUT — return JSON matching exactly this shape:
═══════════════════════════════════════════════════════════════════
{
  "concept": "short concept title + one-line premise (the big idea, stated sharply)",
  "big_idea": "1-3 sentences explaining the metaphor/hook/emotional core and why it fits this specific product",
  "tone": "tone keywords",
  "voiceover": "full spoken script as one string, exactly as it will be read",
  "shot_list": [
    {
      "start_s": 0,
      "end_s": 2,
      "shot_type": "cinematic" or "product_proof",
      "visual": "detailed description of the action/blocking/camera move for this shot",
      "image_refs": ["image 1"],
      "voiceover_slice": "...",
      "sound_notes": "music/SFX detail specific to this moment, if relevant"
    }
  ],
  "seedance_prompt": "full ready-to-send prompt string to send to Seedance, per the requirements above"
}

Before returning, self-check:
1. Does the VO word count actually fit ${duration}s at a fast trailer pace? Recount if unsure.
2. Do shots cover [0, ${duration}] exactly, contiguous, no gaps or overlaps?
3. Is the big idea specific to THIS product, or could it be pasted onto any SaaS site? If the latter, rewrite it.
4. Are image citations only used for screenshots actually provided in the catalog above?
5. Does it end on an unmistakable brand/product endcard moment?
6. Does the seedance_prompt include an explicit instruction to Seedance that any
   generated on-screen text must be ONLY in English and proper, error-free English?`;
}

/**
 * Multimodal Gemini: product URL + page reasons + screenshots → killer ad script.
 */
export async function writeKillerScript(
  cfg: RuntimeConfig,
  {
    selectedPages,
    screenshots,
  }: { selectedPages: SelectedPage[]; screenshots: ScreenshotCapture[] },
): Promise<PromoScript> {
  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });

  const imageParts = screenshots.map((s) => {
    const data = fs.readFileSync(s.localPath).toString("base64");
    return {
      inlineData: {
        mimeType: mimeForPath(s.localPath),
        data,
      },
    };
  });

  const catalog = screenshots
    .map(
      (s, i) =>
        `- image ${i + 1}: screenshot of ${s.url} (${s.reason || selectedPages[i]?.reason || "product page"})`,
    )
    .join("\n");

  const textPrompt = buildScriptPrompt(cfg, catalog);

  const contents = [
    {
      role: "user",
      parts: [{ text: textPrompt }, ...imageParts],
    },
  ];

  log.info("writing killer script", {
    model: cfg.textModel,
    images: screenshots.length,
  });

  let response;
  try {
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: SCRIPT_JSON_SCHEMA,
      },
    });
  } catch (schemaErr) {
    log.warn("responseSchema failed — retrying with responseJsonSchema", {
      error: schemaErr instanceof Error ? schemaErr.message : String(schemaErr),
    });
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SCRIPT_JSON_SCHEMA,
      },
    });
  }

  const rawText = (response.text || "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Script writer returned non-JSON:\n${truncate(rawText, 600)}`,
    );
  }

  const script = PromoScriptSchema.parse(parsed);
  log.info("script ready", {
    concept: truncate(script.concept, 120),
    big_idea: truncate(script.big_idea, 160),
    vo: truncate(script.voiceover, 160),
  });
  return script;
}

/** Seeker / ask language. */
const NEED_PHRASES = [
  "looking for",
  "recommend",
  "recommendation",
  "alternative to",
  "alternatives to",
  "how do you",
  "how do i",
  "how can i",
  "any tools",
  "any tool",
  "any app",
  "what do you use",
  "what should i use",
  "is there a",
  "does anyone",
  "has anyone",
  "need a way",
  "need help",
  "struggling with",
  "pain point",
  "too expensive",
  "instead of",
  "migrate from",
  "migration",
  "best way to",
  "wish there was",
  "suggestions",
  "advice on choosing",
];

/**
 * Founder / launch / showcase language — not seeker threads.
 */
const LAUNCH_PHRASES = [
  "i'm building",
  "i am building",
  "im building",
  "we're building",
  "we are building",
  "i built",
  "i made",
  "i launched",
  "just launched",
  "just shipped",
  "show hn",
  "show-hn",
  "feedback on my",
  "roast my",
  "check out my",
  "my startup",
  "my side project",
  "side project i",
  "here's my",
  "here is my",
  "i created",
  "open for feedback",
  "would love feedback",
  "beta access",
  "product hunt",
];

export function looksLikeLaunchOrShowcase(text: string): boolean {
  const hay = text.toLowerCase();
  return LAUNCH_PHRASES.some((p) => hay.includes(p));
}

export function looksLikeSeekerAsk(text: string): boolean {
  const hay = text.toLowerCase();
  return NEED_PHRASES.some((p) => hay.includes(p));
}

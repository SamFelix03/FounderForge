import { createLogger as ffCreateLogger } from "@founderforge/observability";

export function createLogger(name: string) {
  return ffCreateLogger(`social-listening.${name}`);
}

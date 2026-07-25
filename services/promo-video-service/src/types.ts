export type PromoResolution = "480p" | "720p" | "1080p" | "4k";

export interface RuntimeConfig {
  url: string;
  maxPages: number;
  duration: number;
  resolution: PromoResolution;
  aspectRatio: "16:9";
  bitrateMode: "standard";
  generateAudio: true;
  seed: number;
  workDir: string;
  resumeRequestId: string | null;
  firecrawlApiKey: string;
  firecrawlApiUrl: string | null;
  geminiApiKey: string;
  textModel: string;
  segmindApiKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseBucket: string;
  supabaseObjectPrefix: string;
  supabaseSignedUrlExpiresIn: number;
}

export interface SelectedPage {
  url: string;
  reason: string;
}

export interface ScreenshotCapture {
  url: string;
  reason: string;
  localPath: string;
  bytes: number;
}

export interface PromoScript {
  concept: string;
  big_idea: string;
  tone: string;
  voiceover: string;
  shot_list: Array<{
    start_s: number;
    end_s: number;
    shot_type: "cinematic" | "product_proof";
    visual: string;
    image_refs: string[];
    voiceover_slice?: string;
    sound_notes?: string;
  }>;
  seedance_prompt: string;
}

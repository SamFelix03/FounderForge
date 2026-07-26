import { GoogleGenAI } from "@google/genai";

export type VertexClient = {
  ai: GoogleGenAI;
  project: string;
  location: string;
};

export function createVertexClient(): VertexClient {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawCredentials) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON in .env");
  }

  let credentials: {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  try {
    credentials = JSON.parse(rawCredentials) as typeof credentials;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be valid single-line JSON");
  }

  if (!credentials.project_id || !credentials.client_email || !credentials.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON must include project_id, client_email, and private_key",
    );
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT || credentials.project_id;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";

  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: {
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    },
  });

  return { ai, project, location };
}

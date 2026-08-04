import { MasterResume } from "./api";

const BASE = "/api/playground";

export type RawSuggestion = {
  id: string;
  kind: "bullet-rewrite" | "skill-addition";
  targetId: string;
  keyword: string;
  originalText?: string;
  suggestedText: string;
  rationale: string;
};

export type PlaygroundSuggestion = RawSuggestion & {
  groundedness: "grounded" | "extrapolated";
  accepted: boolean | null;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function postForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const playgroundApi = {
  parseResumeText: (text: string, apiKey: string) =>
    post<MasterResume>("/parse-resume", { text, apiKey }),

  parseResumeFile: (file: File, apiKey: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("apiKey", apiKey);
    return postForm<MasterResume>("/parse-resume", fd);
  },

  fetchJd: (url: string) =>
    post<{ text: string; method: string; title?: string; company?: string; location?: string }>(
      "/fetch-jd",
      { url }
    ),

  suggest: (masterResume: MasterResume, jd: string, apiKey: string) =>
    post<{ suggestions: PlaygroundSuggestion[] }>("/suggest", { masterResume, jd, apiKey }),

  apply: (masterResume: MasterResume, accepted: PlaygroundSuggestion[], apiKey: string) =>
    post<{ markdown: string; pdfBase64: string | null }>("/apply", {
      masterResume,
      accepted,
      apiKey,
    }),
};

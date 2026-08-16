// Browser code always goes through the same-origin proxy, which forwards the
// session cookie and attaches the shared secret server-side. Server Components
// render before any browser exists, so they call the agent directly with the
// shared secret themselves — a relative URL isn't resolvable from Node's fetch,
// and the proxy wouldn't see a session cookie for a server-originated request anyway.
const PROXY_BASE = "/api/proxy";
const isServer = typeof window === "undefined";
const API = isServer ? (process.env.AGENT_API_URL ?? "http://localhost:3001/api") : PROXY_BASE;

function extraHeaders(): Record<string, string> {
  return isServer ? { "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "" } : {};
}

export type Suggestion = {
  id: string;
  kind: "bullet-rewrite" | "skill-addition";
  targetId: string;
  keyword: string;
  originalText?: string;
  suggestedText: string;
  groundedness: "grounded" | "extrapolated";
  rationale: string;
  accepted: boolean | null;
};

export type ResumeListItem = {
  id: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  job_url: string | null;
  critic_score: number | null;
  /** Error from the most recent PDF render attempt; null if the last attempt succeeded. */
  pdf_error: string | null;
  /** 'pending' while the generate->critique->revise pipeline is still running in the background. */
  status: "pending" | "awaiting_review" | "ready" | "failed" | "cancelled";
  /** Error from the tailoring pipeline itself, set when status = 'failed'. */
  error: string | null;
  stage: string | null;
  /** When the current `stage` began (ISO string); null whenever `stage` is null. Used to estimate pending-screen progress. */
  stage_started_at: string | null;
  suggestions: Suggestion[] | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationAnswer = {
  id: string;
  question: string;
  answer: string;
};

export type ApplicationAnswersState = {
  status: "generating" | "ready" | "failed";
  prompt: string;
  items: ApplicationAnswer[];
  error: string | null;
  generated_at: string | null;
};

export type Resume = ResumeListItem & {
  jd_text: string | null;
  markdown: string;
  application_answers: ApplicationAnswersState | null;
};

export type AppliedJob = {
  id: string;
  company: string;
  job_title: string;
  location: string | null;
  job_url: string | null;
  status: string | null;
  applied_at: string;
  created_at: string;
  resume_id: string | null;
  sheets_row: number | null;
  status_events?: StatusEvent[];
};

export type StatusEvent = {
  id: string;
  application_id: string;
  status: string;
  source: "manual" | "email";
  deadline_at: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  occurred_at: string;
};

export type ReviewItem = {
  id: string;
  email_message_id: string;
  email_from: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  detected_status: string | null;
  detected_deadline_at: string | null;
  suggested_application_id: string | null;
  match_score: number | null;
  created_at: string;
};

export type Bullet = {
  id: string;
  text: string;
  tech: string[];
  metrics: string[];
  tags: string[];
};

export type ExperienceEntry = {
  id: string;
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  bullets: Bullet[];
};

export type ProjectEntry = {
  id: string;
  name: string;
  tech: string[];
  start: string;
  end: string;
  link: string;
  repo: string;
  bullets: Bullet[];
};

export type EducationEntry = {
  school: string;
  degrees: string[];
  location: string;
  gpa?: string;
  graduation: string;
  coursework: string[];
  notes: string[];
};

export type Preferences = {
  titleKeywords: string[];
  requiredKeywords: string[];
  termFilter: string | null;
  targetLocations: string[];
  maxPerEmail: number;
  priorityCompanies: string[];
  watchedRepos: string[];
};

export type MasterResume = {
  basics: {
    name: string;
    location: string;
    email: string;
    phone: string;
    github: string;
    linkedin: string;
    portfolio: string;
    summary: string;
  };
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  extracurriculars: ExperienceEntry[];
  skills: {
    languages: string[];
    frameworks: string[];
    tools: string[];
    interests: string[];
  };
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extraHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function requestBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extraHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.blob();
}

function filenameFromContentDisposition(res: Response): string | null {
  const header = res.headers.get("Content-Disposition");
  const match = header?.match(/filename="?([^"]+)"?/);
  return match ? match[1] : null;
}

function pageCountFromHeaders(res: Response): number | null {
  const header = res.headers.get("X-Page-Count");
  const n = header ? parseInt(header, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function requestBlobWithFilename(
  method: string,
  path: string,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`${API}${path}`, { method, headers: extraHeaders() });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return { blob: await res.blob(), filename: filenameFromContentDisposition(res) };
}

async function requestFormData<T>(method: string, path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listResumes: () => request<ResumeListItem[]>("GET", "/resumes"),
  getResume: (id: string) => request<Resume>("GET", `/resume/${id}`),
  patchResume: (id: string, fields: { markdown?: string; jobTitle?: string; company?: string }) =>
    request<{ updatedAt: string; pdfError: string | null; jobTitle: string | null; company: string | null }>(
      "PATCH",
      `/resume/${id}`,
      fields
    ),
  emailResume: (id: string) => request<{ sent: boolean }>("POST", `/resume/${id}/email`),
  deleteResume: (id: string) => request<void>("DELETE", `/resume/${id}`),
  fetchJd: (url: string) =>
    request<{ text: string; method: string; title?: string; company?: string; location?: string }>(
      "POST",
      "/tailor/fetch-jd",
      { url }
    ),
  tailorResume: (body: {
    jdText?: string;
    jobUrl?: string;
    jobTitle?: string;
    company?: string;
    location?: string;
  }) =>
    request<{ id: string; status: "pending" }>("POST", "/tailor", body),
  applySuggestions: (id: string, accepted: Suggestion[]) =>
    request<{ id: string; status: "pending" }>("POST", `/resume/${id}/apply-suggestions`, { accepted }),
  /** Stops an in-flight generation. Resolves with where the row landed: back to
   *  the review checklist if the apply pass was running, 'cancelled' otherwise. */
  cancelResume: (id: string) =>
    request<{ id: string; status: "cancelled" | "awaiting_review" }>("POST", `/resume/${id}/cancel`),
  /** Re-runs the suggestion pass on a cancelled/failed row using its stored JD. */
  retryResume: (id: string) =>
    request<{ id: string; status: "pending" }>("POST", `/resume/${id}/retry`),
  generateAnswers: (id: string, text: string) =>
    request<{ id: string; status: "generating" }>("POST", `/resume/${id}/generate-answers`, { text }),
  startAnswers: (body: {
    text: string;
    jdText?: string;
    jobUrl?: string;
    jobTitle?: string;
    company?: string;
    location?: string;
  }) => request<{ id: string; status: "generating" }>("POST", "/tailor/answers", body),
  patchApplicationAnswers: (id: string, items: ApplicationAnswer[]) =>
    request<ApplicationAnswersState>("PATCH", `/resume/${id}/application-answers`, { items }),
  getMasterResume: () => request<MasterResume>("GET", "/master-resume"),
  putMasterResume: (data: MasterResume) =>
    request<{ updated: boolean }>("PUT", "/master-resume", data),
  importMasterResumeText: (text: string) =>
    request<MasterResume>("POST", "/master-resume/import", { text }),
  importMasterResumePdf: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return requestFormData<MasterResume>("POST", "/master-resume/import", fd);
  },
  listApplied: () => request<AppliedJob[]>("GET", "/applied"),
  postApplied: (body: {
    company: string;
    jobTitle: string;
    location?: string;
    jobUrl?: string;
    status?: string;
    resumeId?: string;
    appliedAt?: string;
  }) => request<AppliedJob>("POST", "/applied", body),
  patchApplied: (id: string, status: string) =>
    request<AppliedJob>("PATCH", `/applied/${id}`, { status }),
  listReviews: () => request<ReviewItem[]>("GET", "/review"),
  confirmReview: (id: string, applicationId: string) =>
    request<{ ok: true }>("POST", `/review/${id}/confirm`, { applicationId }),
  dismissReview: (id: string) => request<{ ok: true }>("POST", `/review/${id}/dismiss`),
  getPlaces: (q: string) =>
    request<{ name: string }[]>("GET", `/places?q=${encodeURIComponent(q)}`),
  getPreferences: () => request<Preferences>("GET", "/preferences"),
  putPreferences: (data: Preferences) => request<{ updated: boolean }>("PUT", "/preferences", data),
  pdfUrl: (id: string) => `${PROXY_BASE}/resume/${id}/pdf`,
  getPdfBlob: (id: string) => requestBlob("GET", `/resume/${id}/pdf`),
  getPdfBlobWithFilename: (id: string) => requestBlobWithFilename("GET", `/resume/${id}/pdf`),
  previewMasterResumePdf: async (data: MasterResume): Promise<{ blob: Blob; pageCount: number | null }> => {
    const res = await fetch(`${API}/master-resume/preview-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    return { blob: await res.blob(), pageCount: pageCountFromHeaders(res) };
  },
};

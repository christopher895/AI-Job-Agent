const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export type ResumeListItem = {
  id: string;
  job_title: string | null;
  company: string | null;
  job_url: string | null;
  critic_score: number | null;
  /** Error from the most recent PDF render attempt; null if the last attempt succeeded. */
  pdf_error: string | null;
  created_at: string;
  updated_at: string;
};

export type Resume = ResumeListItem & {
  jd_text: string | null;
  markdown: string;
};

export type AppliedJob = {
  id: string;
  company: string;
  job_title: string;
  location: string | null;
  job_url: string | null;
  status: string;
  applied_at: string;
  resume_id: string | null;
  sheets_row: number | null;
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
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function requestBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.blob();
}

export const api = {
  listResumes: () => request<ResumeListItem[]>("GET", "/resumes"),
  getResume: (id: string) => request<Resume>("GET", `/resume/${id}`),
  patchResume: (id: string, markdown: string) =>
    request<{ updatedAt: string; pdfError: string | null }>("PATCH", `/resume/${id}`, { markdown }),
  emailResume: (id: string) => request<{ sent: boolean }>("POST", `/resume/${id}/email`),
  fetchJd: (url: string) =>
    request<{ text: string; method: string; title?: string; company?: string }>(
      "POST",
      "/tailor/fetch-jd",
      { url }
    ),
  tailorResume: (body: {
    jdText?: string;
    jobUrl?: string;
    jobTitle?: string;
    company?: string;
  }) =>
    request<{ id: string; markdown: string; criticScore: number; fetchMethod?: string }>(
      "POST",
      "/tailor",
      body
    ),
  getMasterResume: () => request<MasterResume>("GET", "/master-resume"),
  putMasterResume: (data: MasterResume) =>
    request<{ updated: boolean }>("PUT", "/master-resume", data),
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
  getPlaces: (q: string) =>
    request<{ name: string }[]>("GET", `/places?q=${encodeURIComponent(q)}`),
  getPreferences: () => request<Preferences>("GET", "/preferences"),
  putPreferences: (data: Preferences) => request<{ updated: boolean }>("PUT", "/preferences", data),
  pdfUrl: (id: string) => `${API}/resume/${id}/pdf`,
  getPdfBlob: (id: string) => requestBlob("GET", `/resume/${id}/pdf`),
  previewMasterResumePdf: (data: MasterResume) =>
    requestBlob("POST", "/master-resume/preview-pdf", data),
};

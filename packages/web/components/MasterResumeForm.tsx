"use client";
import { useState, useRef, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, MasterResume, ExperienceEntry, ProjectEntry, EducationEntry } from "../lib/api";
import { SortableSection, DragHandle } from "./SortableSection";

const SECTIONS = ["Basics", "Experience", "Projects", "Skills", "Education", "Extracurriculars"] as const;
type Section = (typeof SECTIONS)[number];
type ViewMode = "edit" | "split" | "preview";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-paper-muted mb-1">{children}</label>;
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-paper-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-paper"
    />
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold text-paper-ink uppercase tracking-widest mb-4 mt-8 first:mt-0">
      {title}
    </h2>
  );
}

/** A textarea that grows to fit its content instead of scrolling internally — bullet text should always be fully visible. */
function AutoGrowTextarea({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={className}
    />
  );
}

function BulletList<B extends { id: string; text: string }>({
  bullets,
  onUpdate,
  onAdd,
  onRemove,
  onReorder,
}: {
  bullets: B[];
  onUpdate: (i: number, text: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onReorder: (newBullets: B[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 mt-2">
      <SortableSection items={bullets} onReorder={onReorder}>
        {(b, _idx, drag) => {
          const i = bullets.findIndex((x) => x.id === b.id);
          return (
            <div className="flex gap-2">
              <DragHandle {...drag} />
              <AutoGrowTextarea
                value={b.text}
                onChange={(text) => onUpdate(i, text)}
                className="flex-1 border border-paper-border rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none overflow-hidden"
              />
              <button
                onClick={() => onRemove(i)}
                className="text-paper-muted/60 hover:text-red-400 text-lg leading-none self-start pt-1.5 transition-colors"
                title="Remove bullet"
              >
                ×
              </button>
            </div>
          );
        }}
      </SortableSection>
      <button
        onClick={onAdd}
        className="text-xs text-paper-muted hover:text-violet-600 text-left mt-1 transition-colors"
      >
        + Add bullet
      </button>
    </div>
  );
}

/**
 * Plain readable rendition of the master resume for Text edit mode. Doesn't
 * need to be losslessly parseable — "Apply text" re-parses it via the same
 * LLM import path as the Import panel, not a bespoke deterministic parser.
 */
function masterResumeToText(mr: MasterResume): string {
  // "Start - End", or whichever end exists — never a dangling " - " for an
  // entry with no dates at all (projects, typically).
  const dates = (start: string, end: string) =>
    [start?.trim(), end?.trim()].filter(Boolean).join(" - ");
  // Header segments joined with " · ", empties dropped.
  const seg = (...parts: string[]) => parts.filter((p) => p && p.trim()).join(" · ");
  const b = mr.basics;
  const lines: string[] = [];
  lines.push(b.name);
  lines.push([b.location, b.email, b.phone, b.github, b.linkedin, b.portfolio].filter(Boolean).join(" · "));
  if (b.summary) lines.push("", b.summary);

  if (mr.education.length) {
    lines.push("", "EDUCATION");
    for (const ed of mr.education) {
      lines.push(`${ed.school} — ${ed.degrees.join(", ")} · ${ed.location} · ${ed.graduation}`);
      if (ed.gpa) lines.push(`GPA: ${ed.gpa}`);
      if (ed.coursework.length) lines.push(`Coursework: ${ed.coursework.join(", ")}`);
      if (ed.notes.length) lines.push(`Notes: ${ed.notes.join(", ")}`);
    }
  }

  if (mr.experience.length) {
    lines.push("", "EXPERIENCE");
    for (const exp of mr.experience) {
      lines.push("", `${exp.company} — ${seg(exp.title, exp.location, dates(exp.start, exp.end))}`);
      for (const bullet of exp.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  if (mr.projects.length) {
    lines.push("", "PROJECTS");
    for (const p of mr.projects) {
      lines.push("", `${p.name} · ${seg(p.tech.join(", "), dates(p.start, p.end))}`);
      if (p.link) lines.push(p.link);
      for (const bullet of p.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  if (mr.extracurriculars.length) {
    lines.push("", "EXTRACURRICULARS");
    for (const ex of mr.extracurriculars) {
      lines.push("", `${ex.company} — ${seg(ex.title, ex.location, dates(ex.start, ex.end))}`);
      for (const bullet of ex.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  const skillLines: string[] = [];
  if (mr.skills.languages.length) skillLines.push(`Languages: ${mr.skills.languages.join(", ")}`);
  if (mr.skills.frameworks.length) skillLines.push(`Frameworks: ${mr.skills.frameworks.join(", ")}`);
  if (mr.skills.tools.length) skillLines.push(`Tools: ${mr.skills.tools.join(", ")}`);
  if (mr.skills.interests.length) skillLines.push(`Interests: ${mr.skills.interests.join(", ")}`);
  if (skillLines.length) lines.push("", "SKILLS", ...skillLines);

  return lines.join("\n").trim();
}

function PdfPreviewPane({
  blobUrl,
  loading,
  error,
  pageCount,
  onRefresh,
  className = "",
}: {
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
  pageCount: number | null;
  onRefresh: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col border-l border-paper-border bg-black/[0.03] min-w-0 ${className}`}>
      <div className="px-4 py-2 border-b border-paper-border bg-paper flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-paper-muted">PDF Preview</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-paper-muted hover:text-paper-ink disabled:opacity-50 transition-colors"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={loading ? "animate-spin" : ""}
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {pageCount != null && pageCount > 1 && (
        <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100 flex-shrink-0">
          This master resume is {pageCount} pages — trim a bullet or shorten wording before saving.
        </div>
      )}

      <div className="flex-1 min-h-0">
        {error && (
          <div className="p-4 text-sm text-red-600 bg-red-50 border-b border-red-100">
            {error}
          </div>
        )}
        {blobUrl ? (
          <iframe src={blobUrl} className="w-full h-full border-0" title="Master resume PDF preview" />
        ) : !loading && !error ? (
          <div className="h-full flex items-center justify-center text-sm text-paper-muted">
            Click Refresh to load the PDF preview.
          </div>
        ) : null}
        {loading && !blobUrl && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-paper-muted">
            <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            <span className="text-sm">Compiling LaTeX with Tectonic…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MasterResumeForm({ initial }: { initial: MasterResume }) {
  const [resume, setResume] = useState<MasterResume>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Basics");
  const [editMode, setEditMode] = useState<"structured" | "text">("structured");
  const [textDraft, setTextDraft] = useState("");
  const [textApplying, setTextApplying] = useState(false);
  const [textApplyError, setTextApplyError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const prevBlobRef = useRef<string | null>(null);
  const hasAttemptedPreviewRef = useRef(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.putMasterResume(resume);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function importFromText() {
    if (!importText.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const parsed = await api.importMasterResumeText(importText);
      setResume(parsed);
      setShowImport(false);
      setImportText("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function importFromPdf(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      const parsed = await api.importMasterResumePdf(file);
      setResume(parsed);
      setShowImport(false);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function switchToTextMode() {
    setTextDraft(masterResumeToText(resume));
    setTextApplyError(null);
    setEditMode("text");
  }

  async function applyText() {
    setTextApplying(true);
    setTextApplyError(null);
    try {
      const parsed = await api.importMasterResumeText(textDraft);
      setResume(parsed);
    } catch (e) {
      setTextApplyError(e instanceof Error ? e.message : "Failed to parse text");
    } finally {
      setTextApplying(false);
    }
  }

  async function generatePreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const { blob, pageCount: pages } = await api.previewMasterResumePdf(resume);
      const url = URL.createObjectURL(blob);
      if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
      prevBlobRef.current = url;
      setPreviewBlobUrl(url);
      setPageCount(pages);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "PDF generation failed.");
    } finally {
      setPreviewLoading(false);
    }
  }

  // Lazy-load the PDF only when the user switches into a mode that shows it —
  // matches ResumeEditor's behavior; avoids compiling a PDF on every page load.
  useEffect(() => {
    if (viewMode !== "edit" && !previewBlobUrl && !previewLoading && !hasAttemptedPreviewRef.current) {
      hasAttemptedPreviewRef.current = true;
      generatePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // ── Basics ──────────────────────────────────────────────────────
  function setBasics(field: keyof MasterResume["basics"], value: string) {
    setResume((prev) => ({ ...prev, basics: { ...prev.basics, [field]: value } }));
  }

  // ── Experience ──────────────────────────────────────────────────
  function setExpField(ei: number, field: keyof ExperienceEntry, value: string) {
    setResume((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i !== ei ? exp : { ...exp, [field]: value }
      ),
    }));
  }
  function setExpBullet(ei: number, bi: number, text: string) {
    setResume((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i !== ei
          ? exp
          : { ...exp, bullets: exp.bullets.map((b, j) => (j !== bi ? b : { ...b, text })) }
      ),
    }));
  }
  function addExpBullet(ei: number) {
    setResume((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i !== ei
          ? exp
          : {
              ...exp,
              bullets: [
                ...exp.bullets,
                { id: crypto.randomUUID(), text: "", tech: [], metrics: [], tags: [] },
              ],
            }
      ),
    }));
  }
  function removeExpBullet(ei: number, bi: number) {
    setResume((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i !== ei ? exp : { ...exp, bullets: exp.bullets.filter((_, j) => j !== bi) }
      ),
    }));
  }
  function reorderExpBullets(ei: number, newBullets: ExperienceEntry["bullets"]) {
    setResume((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) => (i !== ei ? exp : { ...exp, bullets: newBullets })),
    }));
  }
  function addExperience() {
    setResume((prev) => ({
      ...prev,
      experience: [
        ...prev.experience,
        {
          id: `new-${Date.now()}-${Math.random()}`,
          company: "",
          title: "",
          location: "",
          start: "",
          end: "",
          bullets: [],
        },
      ],
    }));
  }
  function removeExperience(ei: number) {
    setResume((prev) => ({
      ...prev,
      experience: prev.experience.filter((_, i) => i !== ei),
    }));
  }
  function reorderExperience(newOrder: ExperienceEntry[]) {
    setResume((prev) => ({ ...prev, experience: newOrder }));
  }

  // ── Projects ─────────────────────────────────────────────────────
  function setProjField(pi: number, field: keyof ProjectEntry, value: string | string[]) {
    setResume((prev) => ({
      ...prev,
      projects: prev.projects.map((p, i) =>
        i !== pi ? p : { ...p, [field]: value }
      ),
    }));
  }
  function setProjBullet(pi: number, bi: number, text: string) {
    setResume((prev) => ({
      ...prev,
      projects: prev.projects.map((p, i) =>
        i !== pi
          ? p
          : { ...p, bullets: p.bullets.map((b, j) => (j !== bi ? b : { ...b, text })) }
      ),
    }));
  }
  function addProjBullet(pi: number) {
    setResume((prev) => ({
      ...prev,
      projects: prev.projects.map((p, i) =>
        i !== pi
          ? p
          : {
              ...p,
              bullets: [
                ...p.bullets,
                { id: crypto.randomUUID(), text: "", tech: [], metrics: [], tags: [] },
              ],
            }
      ),
    }));
  }
  function removeProjBullet(pi: number, bi: number) {
    setResume((prev) => ({
      ...prev,
      projects: prev.projects.map((p, i) =>
        i !== pi ? p : { ...p, bullets: p.bullets.filter((_, j) => j !== bi) }
      ),
    }));
  }
  function reorderProjBullets(pi: number, newBullets: ProjectEntry["bullets"]) {
    setResume((prev) => ({
      ...prev,
      projects: prev.projects.map((p, i) => (i !== pi ? p : { ...p, bullets: newBullets })),
    }));
  }
  function addProject() {
    setResume((prev) => ({
      ...prev,
      projects: [
        ...prev.projects,
        {
          id: `new-${Date.now()}-${Math.random()}`,
          name: "",
          tech: [],
          start: "",
          end: "",
          link: "",
          repo: "",
          bullets: [],
        },
      ],
    }));
  }
  function removeProject(pi: number) {
    setResume((prev) => ({
      ...prev,
      projects: prev.projects.filter((_, i) => i !== pi),
    }));
  }
  function reorderProjects(newOrder: ProjectEntry[]) {
    setResume((prev) => ({ ...prev, projects: newOrder }));
  }

  // ── Extracurriculars ─────────────────────────────────────────────
  function setExtraField(ei: number, field: keyof ExperienceEntry, value: string) {
    setResume((prev) => ({
      ...prev,
      extracurriculars: prev.extracurriculars.map((e, i) =>
        i !== ei ? e : { ...e, [field]: value }
      ),
    }));
  }
  function setExtraBullet(ei: number, bi: number, text: string) {
    setResume((prev) => ({
      ...prev,
      extracurriculars: prev.extracurriculars.map((e, i) =>
        i !== ei
          ? e
          : { ...e, bullets: e.bullets.map((b, j) => (j !== bi ? b : { ...b, text })) }
      ),
    }));
  }
  function addExtraBullet(ei: number) {
    setResume((prev) => ({
      ...prev,
      extracurriculars: prev.extracurriculars.map((e, i) =>
        i !== ei
          ? e
          : {
              ...e,
              bullets: [
                ...e.bullets,
                { id: crypto.randomUUID(), text: "", tech: [], metrics: [], tags: [] },
              ],
            }
      ),
    }));
  }
  function removeExtraBullet(ei: number, bi: number) {
    setResume((prev) => ({
      ...prev,
      extracurriculars: prev.extracurriculars.map((e, i) =>
        i !== ei ? e : { ...e, bullets: e.bullets.filter((_, j) => j !== bi) }
      ),
    }));
  }
  function reorderExtraBullets(ei: number, newBullets: ExperienceEntry["bullets"]) {
    setResume((prev) => ({
      ...prev,
      extracurriculars: prev.extracurriculars.map((e, i) => (i !== ei ? e : { ...e, bullets: newBullets })),
    }));
  }
  function reorderExtracurriculars(newOrder: ExperienceEntry[]) {
    setResume((prev) => ({ ...prev, extracurriculars: newOrder }));
  }

  // ── Education ────────────────────────────────────────────────────
  function setEduField(idx: number, field: keyof EducationEntry, value: string | string[]) {
    setResume((prev) => ({
      ...prev,
      education: prev.education.map((e, i) =>
        i !== idx ? e : { ...e, [field]: value }
      ),
    }));
  }

  // ── Skills ───────────────────────────────────────────────────────
  function setSkills(field: keyof MasterResume["skills"], csv: string) {
    setResume((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [field]: csv.split(",").map((s) => s.trim()).filter(Boolean),
      },
    }));
  }

  const basics = resume.basics;

  const sectionContent = (
    <div className="px-8 pb-8">
      {editMode === "text" ? (
        <div>
          <SectionHeader title="Edit as text" />
          <p className="text-sm text-paper-muted mb-3">
            Edit your resume as plain text, then click Apply to re-parse it into the structured
            fields. Nothing is saved until you click Save Changes.
          </p>
          <textarea
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            rows={28}
            className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500 bg-paper resize-none"
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={applyText}
              disabled={textApplying}
              className="text-sm px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {textApplying ? "Applying…" : "Apply text"}
            </button>
            {textApplyError && <span className="text-xs text-red-600">{textApplyError}</span>}
          </div>
        </div>
      ) : (
        <>
          {/* ── Basics ── */}
          {activeSection === "Basics" && (
            <div>
              <SectionHeader title="Basics" />
              <div className="grid grid-cols-2 gap-4">
                {(["name", "location", "email", "phone", "github", "linkedin", "portfolio"] as const).map(
                  (field) => (
                    <div key={field}>
                      <Label>{field.charAt(0).toUpperCase() + field.slice(1)}</Label>
                      <TextInput value={basics[field]} onChange={(v) => setBasics(field, v)} />
                    </div>
                  )
                )}
              </div>
              <div className="mt-4">
                <Label>Summary</Label>
                <textarea
                  value={basics.summary}
                  onChange={(e) => setBasics("summary", e.target.value)}
                  rows={4}
                  className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-paper resize-none"
                />
              </div>
              {saved && <p className="text-xs text-green-600 mt-4">&#x2022; Saved</p>}
              {saving && <p className="text-xs text-paper-muted mt-4">&#x2022; Saving…</p>}
            </div>
          )}

          {/* ── Experience ── */}
          {activeSection === "Experience" && (
            <div>
              <SectionHeader title="Experience" />
              {resume.experience.length === 0 && (
                <p className="text-sm text-paper-muted">No experience entries yet.</p>
              )}
              <SortableSection items={resume.experience} onReorder={reorderExperience}>
                {(exp, _idx, drag) => {
                  const ei = resume.experience.findIndex((e) => e.id === exp.id);
                  return (
                    <div className="mb-6 border border-paper-border rounded-xl p-4 bg-paper">
                      <div className="flex justify-between items-start -mt-1 -mr-1 mb-1">
                        <DragHandle {...drag} />
                        <button
                          onClick={() => removeExperience(ei)}
                          className="text-xs text-paper-muted/60 hover:text-red-500 transition-colors"
                          title="Remove experience"
                        >
                          Remove experience ×
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div><Label>Company</Label><TextInput value={exp.company} onChange={(v) => setExpField(ei, "company", v)} /></div>
                        <div><Label>Title</Label><TextInput value={exp.title} onChange={(v) => setExpField(ei, "title", v)} /></div>
                        <div><Label>Location</Label><TextInput value={exp.location} onChange={(v) => setExpField(ei, "location", v)} /></div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><Label>Start</Label><TextInput value={exp.start} onChange={(v) => setExpField(ei, "start", v)} /></div>
                          <div><Label>End</Label><TextInput value={exp.end} onChange={(v) => setExpField(ei, "end", v)} /></div>
                        </div>
                      </div>
                      <Label>Bullets</Label>
                      <BulletList
                        bullets={exp.bullets}
                        onUpdate={(bi, text) => setExpBullet(ei, bi, text)}
                        onAdd={() => addExpBullet(ei)}
                        onRemove={(bi) => removeExpBullet(ei, bi)}
                        onReorder={(newBullets) => reorderExpBullets(ei, newBullets)}
                      />
                    </div>
                  );
                }}
              </SortableSection>
              <button
                onClick={addExperience}
                className="w-full border border-dashed border-paper-border rounded-xl py-3 text-sm text-paper-muted hover:border-violet-400 hover:text-violet-600 transition-colors"
              >
                + Add experience
              </button>
            </div>
          )}

          {/* ── Projects ── */}
          {activeSection === "Projects" && (
            <div>
              <SectionHeader title="Projects" />
              {resume.projects.length === 0 && (
                <p className="text-sm text-paper-muted">No projects yet.</p>
              )}
              <SortableSection items={resume.projects} onReorder={reorderProjects}>
                {(proj, _idx, drag) => {
                  const pi = resume.projects.findIndex((p) => p.id === proj.id);
                  return (
                    <div className="mb-6 border border-paper-border rounded-xl p-4 bg-paper">
                      <div className="flex justify-between items-start -mt-1 -mr-1 mb-1">
                        <DragHandle {...drag} />
                        <button
                          onClick={() => removeProject(pi)}
                          className="text-xs text-paper-muted/60 hover:text-red-500 transition-colors"
                          title="Remove project"
                        >
                          Remove project ×
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div><Label>Name</Label><TextInput value={proj.name} onChange={(v) => setProjField(pi, "name", v)} /></div>
                        <div>
                          <Label>Tech (comma-separated)</Label>
                          <TextInput
                            value={proj.tech.join(", ")}
                            onChange={(v) => setProjField(pi, "tech", v.split(",").map((s) => s.trim()).filter(Boolean))}
                          />
                        </div>
                        <div><Label>Link</Label><TextInput value={proj.link} onChange={(v) => setProjField(pi, "link", v)} /></div>
                        <div><Label>Repo</Label><TextInput value={proj.repo} onChange={(v) => setProjField(pi, "repo", v)} /></div>
                        <div><Label>Start</Label><TextInput value={proj.start} onChange={(v) => setProjField(pi, "start", v)} /></div>
                        <div><Label>End</Label><TextInput value={proj.end} onChange={(v) => setProjField(pi, "end", v)} /></div>
                      </div>
                      <Label>Bullets</Label>
                      <BulletList
                        bullets={proj.bullets}
                        onUpdate={(bi, text) => setProjBullet(pi, bi, text)}
                        onAdd={() => addProjBullet(pi)}
                        onRemove={(bi) => removeProjBullet(pi, bi)}
                        onReorder={(newBullets) => reorderProjBullets(pi, newBullets)}
                      />
                    </div>
                  );
                }}
              </SortableSection>
              <button
                onClick={addProject}
                className="w-full border border-dashed border-paper-border rounded-xl py-3 text-sm text-paper-muted hover:border-violet-400 hover:text-violet-600 transition-colors"
              >
                + Add project
              </button>
            </div>
          )}

          {/* ── Skills ── */}
          {activeSection === "Skills" && (
            <div>
              <SectionHeader title="Skills" />
              <div className="border border-paper-border rounded-xl p-4 bg-paper grid grid-cols-2 gap-4">
                {(["languages", "frameworks", "tools", "interests"] as const).map((field) => (
                  <div key={field}>
                    <Label>{field.charAt(0).toUpperCase() + field.slice(1)}</Label>
                    <TextInput
                      value={resume.skills[field].join(", ")}
                      onChange={(v) => setSkills(field, v)}
                      placeholder="TypeScript, Python, Go, ..."
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Education ── */}
          {activeSection === "Education" && (
            <div>
              <SectionHeader title="Education" />
              {resume.education.map((edu, idx) => (
                <div key={idx} className="mb-6 border border-paper-border rounded-xl p-4 bg-paper">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>School</Label><TextInput value={edu.school} onChange={(v) => setEduField(idx, "school", v)} /></div>
                    <div><Label>Location</Label><TextInput value={edu.location} onChange={(v) => setEduField(idx, "location", v)} /></div>
                    <div><Label>Graduation</Label><TextInput value={edu.graduation} onChange={(v) => setEduField(idx, "graduation", v)} /></div>
                    <div><Label>GPA</Label><TextInput value={edu.gpa ?? ""} onChange={(v) => setEduField(idx, "gpa", v)} placeholder="3.9" /></div>
                  </div>
                  <div className="mt-3">
                    <Label>Degrees (comma-separated)</Label>
                    <TextInput
                      value={edu.degrees.join(", ")}
                      onChange={(v) => setEduField(idx, "degrees", v.split(",").map((s) => s.trim()).filter(Boolean))}
                    />
                  </div>
                  <div className="mt-3">
                    <Label>Coursework (comma-separated)</Label>
                    <TextInput
                      value={edu.coursework.join(", ")}
                      onChange={(v) => setEduField(idx, "coursework", v.split(",").map((s) => s.trim()).filter(Boolean))}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Extracurriculars ── */}
          {activeSection === "Extracurriculars" && (
            <div>
              <SectionHeader title="Extracurriculars" />
              {resume.extracurriculars.length === 0 && (
                <p className="text-sm text-paper-muted">No extracurricular entries.</p>
              )}
              <SortableSection items={resume.extracurriculars} onReorder={reorderExtracurriculars}>
                {(e, _idx, drag) => {
                  const ei = resume.extracurriculars.findIndex((x) => x.id === e.id);
                  return (
                    <div className="mb-6 border border-paper-border rounded-xl p-4 bg-paper">
                      <div className="flex justify-between items-start -mt-1 -mr-1 mb-1">
                        <DragHandle {...drag} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div><Label>Organization</Label><TextInput value={e.company} onChange={(v) => setExtraField(ei, "company", v)} /></div>
                        <div><Label>Role</Label><TextInput value={e.title} onChange={(v) => setExtraField(ei, "title", v)} /></div>
                        <div><Label>Start</Label><TextInput value={e.start} onChange={(v) => setExtraField(ei, "start", v)} /></div>
                        <div><Label>End</Label><TextInput value={e.end} onChange={(v) => setExtraField(ei, "end", v)} /></div>
                      </div>
                      <Label>Bullets</Label>
                      <BulletList
                        bullets={e.bullets}
                        onUpdate={(bi, text) => setExtraBullet(ei, bi, text)}
                        onAdd={() => addExtraBullet(ei)}
                        onRemove={(bi) => removeExtraBullet(ei, bi)}
                        onReorder={(newBullets) => reorderExtraBullets(ei, newBullets)}
                      />
                    </div>
                  );
                }}
              </SortableSection>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-44 flex-shrink-0 border-r border-paper-border bg-paper px-3 py-6">
        <p className="text-xs font-semibold text-paper-muted uppercase tracking-wider px-3 mb-2">Edit as</p>
        <div className="flex gap-1 px-3 mb-6">
          <button
            onClick={() => setEditMode("structured")}
            className={`flex-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-colors ${
              editMode === "structured" ? "bg-violet-50 text-violet-700" : "text-paper-muted hover:bg-black/5"
            }`}
          >
            Structured
          </button>
          <button
            onClick={switchToTextMode}
            className={`flex-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-colors ${
              editMode === "text" ? "bg-violet-50 text-violet-700" : "text-paper-muted hover:bg-black/5"
            }`}
          >
            Text
          </button>
        </div>

        {editMode === "structured" && (
          <>
            <p className="text-xs font-semibold text-paper-muted uppercase tracking-wider px-3 mb-2">Sections</p>
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
                  activeSection === s
                    ? "bg-violet-50 text-violet-700 font-medium"
                    : "text-paper-muted hover:bg-black/5 hover:text-paper-ink"
                }`}
              >
                {s}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Header + content */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <div className="flex items-start justify-between px-8 pt-8 pb-4 flex-shrink-0">
          <div>
            <h1 className="font-serif text-2xl text-paper-ink">Master Resume</h1>
            <p className="text-sm text-paper-muted mt-1">
              This is the source of truth used to generate all tailored resumes.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button
              onClick={() => setShowImport((v) => !v)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-paper-border bg-paper text-paper-ink hover:bg-black/5 transition-colors font-medium"
            >
              Import…
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
            </button>
            <div className="flex items-center border border-paper-border rounded-lg overflow-hidden">
              {(["edit", "split", "preview"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === mode
                      ? "bg-paper-ink text-paper"
                      : "text-paper-muted hover:bg-black/5 hover:text-paper-ink"
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {showImport && (
          <div className="mx-8 mb-6 border border-paper-border rounded-xl p-4 bg-black/[0.03] flex-shrink-0">
            <p className="text-sm text-paper-muted mb-3">
              Paste your resume text below, or upload a PDF. This pre-fills the form for you to
              review — nothing is saved until you click Save Changes.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              placeholder="Paste resume text here…"
              className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 bg-paper resize-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={importFromText}
                disabled={importing || !importText.trim()}
                className="text-sm px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {importing ? "Parsing…" : "Parse pasted text"}
              </button>
              <span className="text-xs text-paper-muted">or</span>
              <label className="text-sm px-3 py-1.5 border border-paper-border rounded-lg text-paper-ink hover:bg-black/5 cursor-pointer transition-colors">
                Upload PDF
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importFromPdf(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {importError && <span className="text-xs text-red-600">{importError}</span>}
            </div>
          </div>
        )}

        {viewMode === "split" ? (
          <PanelGroup direction="horizontal" className="flex-1 min-h-0">
            <Panel id="form-content" order={1} defaultSize={50} minSize={20}>
              <div className="h-full overflow-y-auto">{sectionContent}</div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-paper-border hover:bg-violet-400 active:bg-violet-500 transition-colors cursor-col-resize" />
            <Panel id="pdf-preview" order={2} defaultSize={50} minSize={20}>
              <PdfPreviewPane
                blobUrl={previewBlobUrl}
                loading={previewLoading}
                error={previewError}
                pageCount={pageCount}
                onRefresh={generatePreview}
                className="h-full"
              />
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex flex-1 min-h-0">
            {viewMode === "edit" && <div className="flex-1 overflow-y-auto">{sectionContent}</div>}
            {viewMode === "preview" && (
              <PdfPreviewPane
                blobUrl={previewBlobUrl}
                loading={previewLoading}
                error={previewError}
                pageCount={pageCount}
                onRefresh={generatePreview}
                className="flex-1"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

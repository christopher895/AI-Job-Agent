"use client";
import { useState, useRef, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, MasterResume, ExperienceEntry, ProjectEntry, EducationEntry } from "../lib/api";
import { SortableSection, DragHandle } from "./SortableSection";

const SECTIONS = ["Basics", "Experience", "Projects", "Skills", "Education", "Extracurriculars"] as const;
type Section = (typeof SECTIONS)[number];

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-600 mb-1">{children}</label>;
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
      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
    />
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-widest mb-4 mt-8 first:mt-0">
      {title}
    </h2>
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
              <textarea
                value={b.text}
                onChange={(e) => onUpdate(i, e.target.value)}
                rows={2}
                className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              />
              <button
                onClick={() => onRemove(i)}
                className="text-gray-300 hover:text-red-400 text-lg leading-none self-start pt-1.5 transition-colors"
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
        className="text-xs text-gray-400 hover:text-violet-600 text-left mt-1 transition-colors"
      >
        + Add bullet
      </button>
    </div>
  );
}

export default function MasterResumeForm({ initial }: { initial: MasterResume }) {
  const [resume, setResume] = useState<MasterResume>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Basics");
  const [showPreview, setShowPreview] = useState(true);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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

  async function generatePreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    setShowPreview(true);
    try {
      const blob = await api.previewMasterResumePdf(resume);
      const url = URL.createObjectURL(blob);
      if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
      prevBlobRef.current = url;
      setPreviewBlobUrl(url);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "PDF generation failed.");
    } finally {
      setPreviewLoading(false);
    }
  }

  // Load the PDF preview once on mount since split view is the default.
  useEffect(() => {
    if (!hasAttemptedPreviewRef.current) {
      hasAttemptedPreviewRef.current = true;
      generatePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="flex h-full">
      {/* Section tabs */}
      <div className="w-44 flex-shrink-0 border-r border-gray-200 bg-white px-3 py-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Sections</p>
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
              activeSection === s
                ? "bg-violet-50 text-violet-700 font-medium"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Content + optional preview panel */}
      <PanelGroup direction="horizontal" className="flex-1 min-w-0">
        <Panel id="form-content" order={1} defaultSize={50} minSize={20}>
        {/* Form content */}
        <div className="h-full px-8 py-8 overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Master Resume</h1>
            <p className="text-sm text-gray-500 mt-1">
              This is the source of truth used to generate all tailored resumes.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button
              onClick={generatePreview}
              disabled={previewLoading}
              className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors font-medium ${
                showPreview
                  ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              } disabled:opacity-50`}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={previewLoading ? "animate-spin" : ""}
              >
                {previewLoading ? (
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                ) : (
                  <>
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
              {previewLoading ? "Rendering…" : showPreview ? "Refresh PDF" : "Preview PDF"}
            </button>
            {showPreview && (
              <button
                onClick={() => setShowPreview(false)}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 transition-colors"
                title="Close preview"
              >
                ✕
              </button>
            )}
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
          </div>
        </div>

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
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-none"
              />
            </div>
            {saved && <p className="text-xs text-green-600 mt-4">&#x2022; Saved</p>}
            {saving && <p className="text-xs text-gray-400 mt-4">&#x2022; Saving…</p>}
          </div>
        )}

        {/* ── Experience ── */}
        {activeSection === "Experience" && (
          <div>
            <SectionHeader title="Experience" />
            {resume.experience.length === 0 && (
              <p className="text-sm text-gray-400">No experience entries yet.</p>
            )}
            <SortableSection items={resume.experience} onReorder={reorderExperience}>
              {(exp, _idx, drag) => {
                const ei = resume.experience.findIndex((e) => e.id === exp.id);
                return (
                  <div className="mb-6 border border-gray-100 rounded-xl p-4 bg-white">
                    <div className="flex justify-between items-start -mt-1 -mr-1 mb-1">
                      <DragHandle {...drag} />
                      <button
                        onClick={() => removeExperience(ei)}
                        className="text-xs text-gray-300 hover:text-red-500 transition-colors"
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
              className="w-full border border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:border-violet-400 hover:text-violet-600 transition-colors"
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
              <p className="text-sm text-gray-400">No projects yet.</p>
            )}
            <SortableSection items={resume.projects} onReorder={reorderProjects}>
              {(proj, _idx, drag) => {
                const pi = resume.projects.findIndex((p) => p.id === proj.id);
                return (
                  <div className="mb-6 border border-gray-100 rounded-xl p-4 bg-white">
                    <div className="flex justify-between items-start -mt-1 -mr-1 mb-1">
                      <DragHandle {...drag} />
                      <button
                        onClick={() => removeProject(pi)}
                        className="text-xs text-gray-300 hover:text-red-500 transition-colors"
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
              className="w-full border border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:border-violet-400 hover:text-violet-600 transition-colors"
            >
              + Add project
            </button>
          </div>
        )}

        {/* ── Skills ── */}
        {activeSection === "Skills" && (
          <div>
            <SectionHeader title="Skills" />
            <div className="border border-gray-100 rounded-xl p-4 bg-white grid grid-cols-2 gap-4">
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
              <div key={idx} className="mb-6 border border-gray-100 rounded-xl p-4 bg-white">
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
              <p className="text-sm text-gray-400">No extracurricular entries.</p>
            )}
            <SortableSection items={resume.extracurriculars} onReorder={reorderExtracurriculars}>
              {(e, _idx, drag) => {
                const ei = resume.extracurriculars.findIndex((x) => x.id === e.id);
                return (
                  <div className="mb-6 border border-gray-100 rounded-xl p-4 bg-white">
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
        </div>
        </Panel>

        {showPreview && (
          <>
            <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-violet-400 active:bg-violet-500 transition-colors cursor-col-resize" />
            <Panel id="pdf-preview" order={2} defaultSize={50} minSize={20}>
            <div className="h-full flex flex-col bg-gray-50">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-medium text-gray-600">PDF Preview</span>
              <span className="text-xs text-gray-400">
                {previewLoading
                  ? "Compiling LaTeX…"
                  : previewBlobUrl
                  ? "Showing current form state"
                  : ""}
              </span>
            </div>

            <div className="flex-1 min-h-0">
              {previewError && (
                <div className="p-4 text-sm text-red-600 bg-red-50 border-b border-red-100">
                  {previewError}
                </div>
              )}
              {previewLoading && !previewBlobUrl && (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400">
                  <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  <span className="text-sm">Compiling LaTeX with Tectonic…</span>
                  <span className="text-xs">This takes about 3–5 seconds</span>
                </div>
              )}
              {previewBlobUrl && (
                <iframe
                  src={previewBlobUrl}
                  className="w-full h-full border-0"
                  title="Master resume PDF preview"
                />
              )}
            </div>
            </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}

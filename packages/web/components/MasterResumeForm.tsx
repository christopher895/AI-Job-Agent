"use client";
import { useState } from "react";
import { api, MasterResume, ExperienceEntry, ProjectEntry, EducationEntry } from "../lib/api";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-zinc-600 mb-1">{children}</label>;
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
      className="w-full border border-zinc-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
    />
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4 mt-8">
      <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-widest">{title}</h2>
      <div className="flex-1 border-t border-zinc-200" />
    </div>
  );
}

function BulletList({
  bullets,
  onUpdate,
  onAdd,
  onRemove,
}: {
  bullets: Array<{ id: string; text: string }>;
  onUpdate: (i: number, text: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {bullets.map((b, i) => (
        <div key={b.id} className="flex gap-2">
          <textarea
            value={b.text}
            onChange={(e) => onUpdate(i, e.target.value)}
            rows={2}
            className="flex-1 border border-zinc-200 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none"
          />
          <button
            onClick={() => onRemove(i)}
            className="text-zinc-300 hover:text-red-400 text-lg leading-none self-start pt-1.5 transition-colors"
            title="Remove bullet"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={onAdd}
        className="text-xs text-zinc-400 hover:text-zinc-600 text-left mt-1 transition-colors"
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
                { id: `new-${Date.now()}-${Math.random()}`, text: "", tech: [], metrics: [], tags: [] },
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
                { id: `new-${Date.now()}-${Math.random()}`, text: "", tech: [], metrics: [], tags: [] },
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
                { id: `new-${Date.now()}-${Math.random()}`, text: "", tech: [], metrics: [], tags: [] },
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

  // ── Education ────────────────────────────────────────────────────
  function setEduField(
    idx: number,
    field: keyof EducationEntry,
    value: string | string[]
  ) {
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
        [field]: csv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    }));
  }

  const basics = resume.basics;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold text-zinc-900">Master Resume</h1>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="bg-zinc-900 text-white text-sm px-4 py-2 rounded-md hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>

      {/* ── Basics ── */}
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
          rows={3}
          className="w-full border border-zinc-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white resize-none"
        />
      </div>

      {/* ── Education ── */}
      <SectionHeader title="Education" />
      {resume.education.map((edu, idx) => (
        <div key={idx} className="mb-6 border border-zinc-100 rounded-lg p-4 bg-white">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>School</Label>
              <TextInput value={edu.school} onChange={(v) => setEduField(idx, "school", v)} />
            </div>
            <div>
              <Label>Location</Label>
              <TextInput value={edu.location} onChange={(v) => setEduField(idx, "location", v)} />
            </div>
            <div>
              <Label>Graduation</Label>
              <TextInput
                value={edu.graduation}
                onChange={(v) => setEduField(idx, "graduation", v)}
              />
            </div>
            <div>
              <Label>GPA</Label>
              <TextInput
                value={edu.gpa ?? ""}
                onChange={(v) => setEduField(idx, "gpa", v)}
                placeholder="3.9"
              />
            </div>
          </div>
          <div className="mt-3">
            <Label>Degrees (comma-separated)</Label>
            <TextInput
              value={edu.degrees.join(", ")}
              onChange={(v) =>
                setEduField(
                  idx,
                  "degrees",
                  v.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
            />
          </div>
          <div className="mt-3">
            <Label>Coursework (comma-separated)</Label>
            <TextInput
              value={edu.coursework.join(", ")}
              onChange={(v) =>
                setEduField(
                  idx,
                  "coursework",
                  v.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
            />
          </div>
        </div>
      ))}

      {/* ── Experience ── */}
      <SectionHeader title="Experience" />
      {resume.experience.map((exp, ei) => (
        <div key={exp.id} className="mb-6 border border-zinc-100 rounded-lg p-4 bg-white">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label>Company</Label>
              <TextInput value={exp.company} onChange={(v) => setExpField(ei, "company", v)} />
            </div>
            <div>
              <Label>Title</Label>
              <TextInput value={exp.title} onChange={(v) => setExpField(ei, "title", v)} />
            </div>
            <div>
              <Label>Location</Label>
              <TextInput value={exp.location} onChange={(v) => setExpField(ei, "location", v)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Start</Label>
                <TextInput value={exp.start} onChange={(v) => setExpField(ei, "start", v)} />
              </div>
              <div>
                <Label>End</Label>
                <TextInput value={exp.end} onChange={(v) => setExpField(ei, "end", v)} />
              </div>
            </div>
          </div>
          <Label>Bullets</Label>
          <BulletList
            bullets={exp.bullets}
            onUpdate={(bi, text) => setExpBullet(ei, bi, text)}
            onAdd={() => addExpBullet(ei)}
            onRemove={(bi) => removeExpBullet(ei, bi)}
          />
        </div>
      ))}

      {/* ── Projects ── */}
      <SectionHeader title="Projects" />
      {resume.projects.map((proj, pi) => (
        <div key={proj.id} className="mb-6 border border-zinc-100 rounded-lg p-4 bg-white">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label>Name</Label>
              <TextInput value={proj.name} onChange={(v) => setProjField(pi, "name", v)} />
            </div>
            <div>
              <Label>Tech (comma-separated)</Label>
              <TextInput
                value={proj.tech.join(", ")}
                onChange={(v) =>
                  setProjField(
                    pi,
                    "tech",
                    v.split(",").map((s) => s.trim()).filter(Boolean)
                  )
                }
              />
            </div>
            <div>
              <Label>Link</Label>
              <TextInput value={proj.link} onChange={(v) => setProjField(pi, "link", v)} />
            </div>
            <div>
              <Label>Repo</Label>
              <TextInput value={proj.repo} onChange={(v) => setProjField(pi, "repo", v)} />
            </div>
            <div>
              <Label>Start</Label>
              <TextInput value={proj.start} onChange={(v) => setProjField(pi, "start", v)} />
            </div>
            <div>
              <Label>End</Label>
              <TextInput value={proj.end} onChange={(v) => setProjField(pi, "end", v)} />
            </div>
          </div>
          <Label>Bullets</Label>
          <BulletList
            bullets={proj.bullets}
            onUpdate={(bi, text) => setProjBullet(pi, bi, text)}
            onAdd={() => addProjBullet(pi)}
            onRemove={(bi) => removeProjBullet(pi, bi)}
          />
        </div>
      ))}

      {/* ── Skills ── */}
      <SectionHeader title="Skills" />
      <div className="border border-zinc-100 rounded-lg p-4 bg-white grid grid-cols-2 gap-4">
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

      {/* ── Extracurriculars ── */}
      {resume.extracurriculars.length > 0 && (
        <>
          <SectionHeader title="Extracurriculars" />
          {resume.extracurriculars.map((e, ei) => (
            <div key={e.id} className="mb-6 border border-zinc-100 rounded-lg p-4 bg-white">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <Label>Organization</Label>
                  <TextInput value={e.company} onChange={(v) => setExtraField(ei, "company", v)} />
                </div>
                <div>
                  <Label>Role</Label>
                  <TextInput value={e.title} onChange={(v) => setExtraField(ei, "title", v)} />
                </div>
                <div>
                  <Label>Start</Label>
                  <TextInput value={e.start} onChange={(v) => setExtraField(ei, "start", v)} />
                </div>
                <div>
                  <Label>End</Label>
                  <TextInput value={e.end} onChange={(v) => setExtraField(ei, "end", v)} />
                </div>
              </div>
              <Label>Bullets</Label>
              <BulletList
                bullets={e.bullets}
                onUpdate={(bi, text) => setExtraBullet(ei, bi, text)}
                onAdd={() => addExtraBullet(ei)}
                onRemove={(bi) => removeExtraBullet(ei, bi)}
              />
            </div>
          ))}
        </>
      )}

      {/* Bottom save */}
      <div className="mt-8 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="bg-zinc-900 text-white text-sm px-5 py-2.5 rounded-md hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

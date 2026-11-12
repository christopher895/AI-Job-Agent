"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ResumeProfile } from "../lib/api";
import { DEFAULT_PROFILE_ID, parseKeywordInput } from "../lib/resumeProfiles";

/**
 * Profile switcher + management for /resume/master. A profile is a whole base
 * resume (e.g. "ML") that /tailor can start from; the main profile (id 1)
 * always exists and can't be deleted. Creating, renaming and deleting take
 * effect immediately — they don't wait for the form's Save button.
 */
export default function ProfileBar({
  profiles,
  profileId,
  dirty,
}: {
  profiles: ResumeProfile[];
  profileId: number;
  /** Unsaved edits in the form — switching away would drop them. */
  dirty: boolean;
}) {
  const router = useRouter();
  const current = profiles.find((p) => p.id === profileId) ?? profiles[0];
  const isDefault = profileId === DEFAULT_PROFILE_ID;
  const [panel, setPanel] = useState<"none" | "new" | "settings">("none");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go(id: number) {
    router.push(id === DEFAULT_PROFILE_ID ? "/resume/master" : `/resume/master?profile=${id}`);
    router.refresh();
  }

  function leaveOk(): boolean {
    return !dirty || window.confirm("You have unsaved changes on this resume. Leave without saving?");
  }

  function openPanel(next: "new" | "settings") {
    setError(null);
    if (panel === next) { setPanel("none"); return; }
    setName(next === "settings" ? current.name : "");
    setKeywords(next === "settings" ? current.keywords.join(", ") : "");
    setPanel(next);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const create = () => run(async () => {
    if (!leaveOk()) return;
    const created = await api.createResumeProfile({
      name: name.trim(),
      keywords: parseKeywordInput(keywords),
      copyFrom: profileId,
    });
    setPanel("none");
    go(created.id);
  });

  const saveSettings = () => run(async () => {
    await api.updateResumeProfile(profileId, {
      name: name.trim(),
      ...(isDefault ? {} : { keywords: parseKeywordInput(keywords) }),
    });
    setPanel("none");
    router.refresh();
  });

  const remove = () => run(async () => {
    if (!window.confirm(`Delete the "${current.name}" resume? Tailored resumes built from it will use the main resume for future rounds.`)) return;
    await api.deleteResumeProfile(profileId);
    go(DEFAULT_PROFILE_ID);
  });

  const inputClass =
    "border border-paper-border rounded-lg px-3 py-1.5 text-sm bg-paper focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="px-8 pb-4 flex-shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="profile-select" className="text-xs font-semibold text-paper-muted uppercase tracking-wider">
          Profile
        </label>
        <select
          id="profile-select"
          value={profileId}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id !== profileId && leaveOk()) go(id);
          }}
          className={inputClass}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.id === DEFAULT_PROFILE_ID ? " (main)" : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => openPanel("settings")}
          className="text-sm px-3 py-1.5 rounded-lg border border-paper-border text-paper-ink hover:bg-black/5 transition-colors"
        >
          Rename{isDefault ? "" : " / keywords"}
        </button>
        <button
          onClick={() => openPanel("new")}
          className="text-sm px-3 py-1.5 rounded-lg border border-paper-border text-paper-ink hover:bg-black/5 transition-colors"
        >
          + New profile
        </button>
        {!isDefault && current.keywords.length > 0 && panel === "none" && (
          <span className="text-xs text-paper-muted">
            Auto-picked on /tailor for titles with: {current.keywords.join(", ")}
          </span>
        )}
        {!isDefault && current.keywords.length === 0 && panel === "none" && (
          <span className="text-xs text-paper-muted">
            No keywords — /tailor only uses this profile when you pick it.
          </span>
        )}
      </div>

      {panel !== "none" && (
        <div className="mt-3 border border-paper-border rounded-xl p-4 bg-black/[0.03] flex flex-col gap-3 max-w-2xl">
          {panel === "new" && (
            <p className="text-sm text-paper-muted">
              Starts as a copy of <span className="font-medium text-paper-ink">{current.name}</span>, then you edit it
              freely. The two are separate from then on — a fix in one doesn&apos;t carry over to the other.
              {dirty && " Unsaved edits on this page aren't included in the copy."}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-paper-ink" htmlFor="profile-name">Name</label>
            <input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. ML"
              className={inputClass}
            />
          </div>
          {!(panel === "settings" && isDefault) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-paper-ink" htmlFor="profile-keywords">
                Job-title keywords <span className="font-normal text-paper-muted">(comma-separated, optional)</span>
              </label>
              <input
                id="profile-keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="ML, machine learning, AI"
                className={inputClass}
              />
              <span className="text-xs text-paper-muted">
                On /tailor, &quot;Auto&quot; picks this profile when the job title contains one of these as a whole word.
                Anything else uses the main resume.
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={panel === "new" ? create : saveSettings}
              disabled={busy || !name.trim()}
              className="text-sm px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {busy ? "Saving…" : panel === "new" ? "Create profile" : "Save"}
            </button>
            <button
              onClick={() => setPanel("none")}
              className="text-sm px-3 py-1.5 rounded-lg text-paper-muted hover:bg-black/5 transition-colors"
            >
              Cancel
            </button>
            {panel === "settings" && !isDefault && (
              <button
                onClick={remove}
                disabled={busy}
                className="ml-auto text-sm px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                Delete profile
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

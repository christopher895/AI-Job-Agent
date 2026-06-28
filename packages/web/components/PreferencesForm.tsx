"use client";
import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { api, Preferences } from "../lib/api";

type Place = { name: string };

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-600 mb-1">{children}</label>;
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-widest">{title}</h2>
      {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-violet-50 text-violet-700 text-xs px-2 py-0.5 rounded-md font-medium">
      {label}
      <button type="button" onClick={onRemove} className="text-violet-400 hover:text-violet-700 leading-none">×</button>
    </span>
  );
}

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function add() {
    const val = input.trim();
    if (val && !tags.map((t) => t.toLowerCase()).includes(val.toLowerCase())) {
      onChange([...tags, val]);
    }
    setInput("");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && input === "" && tags.length > 0) onChange(tags.slice(0, -1));
  }

  return (
    <div className="border border-gray-200 rounded-lg px-3 py-2 bg-white flex flex-wrap gap-1.5 min-h-[40px] focus-within:ring-2 focus-within:ring-violet-500 focus-within:border-transparent">
      {tags.map((tag) => (
        <Chip key={tag} label={tag} onRemove={() => onChange(tags.filter((t) => t !== tag))} />
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[100px] text-sm outline-none bg-transparent placeholder-gray-400"
      />
    </div>
  );
}

const REMOTE_NAMES = new Set(["remote", "anywhere", "remote / anywhere"]);

function LocationTagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const open = suggestions.length > 0;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function addTag(name: string) {
    const val = name.trim();
    if (val && !tags.map((t) => t.toLowerCase()).includes(val.toLowerCase())) {
      onChange([...tags, val]);
    }
    setInput("");
    setSuggestions([]);
    setActiveIdx(-1);
  }

  function handleInputChange(val: string) {
    setInput(val);
    setActiveIdx(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = val.trim();
    if (trimmed.length < 2) { setSuggestions([]); return; }

    // "remote" is always valid — no need to geocode it
    if (REMOTE_NAMES.has(trimmed.toLowerCase())) {
      setSuggestions([{ name: "Remote" }]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await api.getPlaces(trimmed);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 320);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && activeIdx >= 0) {
        addTag(suggestions[activeIdx].name);
      } else if (open && suggestions.length > 0) {
        addTag(suggestions[0].name);
      } else {
        addTag(input);
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setActiveIdx(-1);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="border border-gray-200 rounded-lg px-3 py-2 bg-white flex flex-wrap gap-1.5 min-h-[40px] focus-within:ring-2 focus-within:ring-violet-500 focus-within:border-transparent">
        {tags.map((tag) => (
          <Chip key={tag} label={tag} onRemove={() => onChange(tags.filter((t) => t !== tag))} />
        ))}
        <div className="flex-1 min-w-[140px] flex items-center gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={onKey}
            placeholder={tags.length === 0 ? `Type a city or "remote"…` : ""}
            className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400"
            autoComplete="off"
          />
          {loading && (
            <svg className="animate-spin flex-shrink-0 text-gray-300" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            </svg>
          )}
        </div>
      </div>

      {open && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((place, i) => (
            <li key={place.name}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addTag(place.name); }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  i === activeIdx ? "bg-violet-50 text-violet-700" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {place.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PreferencesForm({ initial }: { initial: Preferences }) {
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.putPreferences(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Preferences</h1>
          <p className="text-sm text-gray-500 mt-1">
            Controls which jobs the scraper surfaces and emails to you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-600">{error}</span>}
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

      <div className="flex flex-col gap-6">
        {/* Locations */}
        <div className="border border-gray-100 rounded-xl p-5 bg-white">
          <SectionHeader
            title="Target Locations"
            description="Jobs must be in one of these cities, or remote/unspecified. Select from suggestions to validate."
          />
          <Label>Cities</Label>
          <LocationTagInput
            tags={prefs.targetLocations}
            onChange={(v) => set("targetLocations", v)}
          />
        </div>

        {/* Job matching */}
        <div className="border border-gray-100 rounded-xl p-5 bg-white">
          <SectionHeader
            title="Job Matching"
            description="Title must contain at least one keyword and all required keywords."
          />
          <div className="flex flex-col gap-4">
            <div>
              <Label>Title keywords (any one must match)</Label>
              <TagInput
                tags={prefs.titleKeywords}
                onChange={(v) => set("titleKeywords", v)}
                placeholder="software, engineer, ai…"
              />
            </div>
            <div>
              <Label>Required keywords (all must match)</Label>
              <TagInput
                tags={prefs.requiredKeywords}
                onChange={(v) => set("requiredKeywords", v)}
                placeholder="intern…"
              />
            </div>
            <div>
              <Label>Term filter (optional — e.g. 2027 for Summer 2027 only)</Label>
              <input
                type="text"
                value={prefs.termFilter ?? ""}
                onChange={(e) => set("termFilter", e.target.value || null)}
                placeholder="Leave blank to match any term"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
              />
            </div>
          </div>
        </div>

        {/* Email settings */}
        <div className="border border-gray-100 rounded-xl p-5 bg-white">
          <SectionHeader
            title="Email Settings"
            description="Controls the alert email sent when new jobs are found."
          />
          <div className="flex flex-col gap-4">
            <div>
              <Label>Max jobs per email</Label>
              <input
                type="number"
                min={1}
                max={20}
                value={prefs.maxPerEmail}
                onChange={(e) => set("maxPerEmail", Math.max(1, Math.min(20, Number(e.target.value))))}
                className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
              />
            </div>
            <div>
              <Label>Priority companies (get a score bonus — appear first)</Label>
              <TagInput
                tags={prefs.priorityCompanies}
                onChange={(v) => set("priorityCompanies", v)}
                placeholder="Google, Anthropic, OpenAI…"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom save */}
      <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

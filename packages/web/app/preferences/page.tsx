import { api } from "../../lib/api";
import PreferencesForm from "../../components/PreferencesForm";

export default async function PreferencesPage() {
  try {
    const prefs = await api.getPreferences();
    return (
      <div className="px-8 py-8 max-w-2xl">
        <PreferencesForm initial={prefs} />
      </div>
    );
  } catch {
    return (
      <div className="px-8 py-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          Could not load preferences — make sure the agent server is running.
        </div>
      </div>
    );
  }
}

import PlaygroundFlow from "../../components/PlaygroundFlow";

export default function PlaygroundPage() {
  return (
    <div className="relative min-h-full w-full overflow-hidden bg-ink-950 px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 0%, rgba(124,58,237,0.22), transparent 55%),
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: "auto, 42px 42px, 42px 42px",
        }}
      />
      <div className="relative mx-auto max-w-2xl">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-400">
          Public playground
        </p>
        <h1 className="mt-2 font-serif text-4xl text-white">Try the tailoring pipeline</h1>
        <p className="mt-3 text-sm text-white/60">
          Paste your resume and a job description, bring your own{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 underline underline-offset-2 hover:text-violet-300"
          >
            Anthropic API key
          </a>
          , and get a real tailored resume back. Nothing you paste here is stored —
          your resume, job description, and API key are used only for this
          request and never saved.
        </p>
        <div className="mt-8">
          <PlaygroundFlow />
        </div>
      </div>
    </div>
  );
}

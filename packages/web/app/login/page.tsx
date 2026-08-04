import { Fraunces } from "next/font/google";
import { signIn } from "@/auth";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal"],
  display: "swap",
});

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

const ERROR_COPY: Record<string, string> = {
  AccessDenied: "This Google account isn't authorized for this workspace.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_COPY[error] ?? "Couldn't sign you in — try again.") : null;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#0B0B12] px-6">
      {/* Ambient backdrop: violet glow over a fine scan grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 38%, rgba(124,58,237,0.28), transparent 55%),
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: "auto, 42px 42px, 42px 42px",
        }}
      />

      {/* Sign-in card, styled as a single sheet of paper */}
      <div className="relative w-full max-w-sm -rotate-1 rounded-sm bg-[#F6F1E4] px-8 py-9 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)]">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600">
          Private access
        </p>
        <h1 className={`${fraunces.className} mt-2 text-4xl text-[#1F1B16]`}>Resume Tailor</h1>

        {errorMessage ? (
          <p className="mt-3 text-sm text-[#9A5A32]">{errorMessage}</p>
        ) : (
          <p className="mt-3 text-sm text-[#544E42]">
            Your agent&rsquo;s been watching job boards while you were away.
          </p>
        )}

        <form
          className="mt-7"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2.5 rounded-sm bg-[#1F1B16] px-4 py-3 text-sm font-medium text-[#F6F1E4] transition-colors hover:bg-[#332C22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F1E4]"
          >
            <GoogleMark />
            Sign in with Google
          </button>
        </form>

        <div className="mt-7 flex items-center gap-2 border-t border-[#1F1B16]/10 pt-4">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <p className="font-mono text-[11px] tracking-wide text-[#7A7568]">
            80+ companies · scanned every 15 min
          </p>
        </div>
      </div>
    </div>
  );
}

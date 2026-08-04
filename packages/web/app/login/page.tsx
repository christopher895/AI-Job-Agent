import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Resume Tailor</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to continue</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}

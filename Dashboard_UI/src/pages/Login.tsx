import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Radio,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { apiErrorMessage, createUser } from "../api/routes";
import { useAuthStore } from "../store/authStore";

const demoAccounts = [
  { username: "admin", password: "admin123", label: "Admin" },
  { username: "operator", password: "operator123", label: "Operator" },
  { username: "demo", password: "demo123", label: "Demo" },
];

export default function Login() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountRequestLoading, setAccountRequestLoading] = useState(false);
  const [accountFeedback, setAccountFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const { login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleCreateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountRequestLoading(true);
    setAccountFeedback(null);
    clearError();
    try {
      const result = await createUser({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        user_name: username.trim(),
        password,
      });
      setAccountFeedback({ kind: "success", message: result.message });
      setCreatingAccount(false);
    } catch (requestError) {
      setAccountFeedback({
        kind: "error",
        message: apiErrorMessage(requestError),
      });
    } finally {
      setAccountRequestLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const success = await login(username, password);
    if (success) {
      navigate("/", { replace: true });
    }
  };

  const fillDemoAccount = (user: string, pass: string) => {
    clearError();
    setUsername(user);
    setPassword(pass);
  };

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900 lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#071421] px-12 py-10 text-white lg:flex lg:flex-col xl:px-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148, 190, 211, .22) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 190, 211, .22) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "linear-gradient(to bottom, black 0%, transparent 85%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-40 top-1/4 h-[34rem] w-[34rem] rounded-full bg-cyan-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 bottom-[-6rem] h-[28rem] w-[28rem] rounded-full bg-blue-500/10 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">FASTA ROBOTICS</p>
            <p className="text-xs text-slate-400">Fleet operations platform</p>
          </div>
        </div>

        <div className="relative my-auto max-w-xl py-16">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/[0.07] px-3 py-1.5 text-xs font-medium text-cyan-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Intelligent fleet management
          </div>
          <h1 className="text-5xl font-semibold leading-[1.12] tracking-tight xl:text-6xl">
            Your fleet,
            <br />
            <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
              in sync.
            </span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-slate-400">
            Monitor your autonomous robots, manage missions, and stay in
            control from one beautifully connected workspace.
          </p>

          <div className="mt-12 grid max-w-lg grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-300">
                <Activity className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium">Live telemetry</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Robot health and status at a glance
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-300/10 text-blue-300">
                <Radio className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium">Mission control</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Coordinate every move with confidence
              </p>
            </div>
          </div>
        </div>

        <div className="relative flex items-center justify-between border-t border-white/[0.08] pt-5 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} Fasta Robotics</span>
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Secure operations
          </span>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b1b2b] text-cyan-300 shadow-lg shadow-slate-900/10">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-wide text-slate-900">
                FASTA ROBOTICS
              </p>
              <p className="text-xs text-slate-500">Fleet operations platform</p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200/80 bg-white p-7 shadow-[0_24px_80px_-32px_rgba(15,35,60,0.22)] sm:p-10">
            <div className="mb-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
                {creatingAccount ? "Join the fleet workspace" : "Welcome back"}
              </p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
                {creatingAccount ? "Create your account" : "Sign in to your account"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {creatingAccount
                  ? "Create an account to access the fleet dashboard."
                  : "Enter your credentials to access your fleet dashboard."}
              </p>
            </div>

            {accountFeedback && (
              <div
                role={accountFeedback.kind === "error" ? "alert" : "status"}
                className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
                  accountFeedback.kind === "success"
                    ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                    : "border-red-100 bg-red-50 text-red-700"
                }`}
              >
                {accountFeedback.message}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-6 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={clearError}
                  className="rounded px-1 font-semibold leading-none text-red-500 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            )}

            <form
              onSubmit={creatingAccount ? handleCreateAccount : handleSubmit}
              className="space-y-5"
            >
              {creatingAccount && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label htmlFor="first-name" className="text-sm font-medium text-slate-700">
                        First name
                      </label>
                      <input
                        id="first-name"
                        autoComplete="given-name"
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        required
                        disabled={isLoading || accountRequestLoading}
                        className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 text-sm outline-none focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10 disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="last-name" className="text-sm font-medium text-slate-700">
                        Last name
                      </label>
                      <input
                        id="last-name"
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        required
                        disabled={isLoading || accountRequestLoading}
                        className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 text-sm outline-none focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10 disabled:opacity-60"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-slate-700">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      disabled={isLoading || accountRequestLoading}
                      className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 text-sm outline-none focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10 disabled:opacity-60"
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <label
                  htmlFor="username"
                  className="text-sm font-medium text-slate-700"
                >
                  Username
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    onFocus={clearError}
                    required
                    disabled={isLoading || accountRequestLoading}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-slate-700"
                >
                  Password
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={creatingAccount ? "new-password" : "current-password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onFocus={clearError}
                    required
                    disabled={isLoading || accountRequestLoading}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-11 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    disabled={isLoading || accountRequestLoading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/40 disabled:cursor-not-allowed"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <EyeOff className="h-[18px] w-[18px]" />
                    ) : (
                      <Eye className="h-[18px] w-[18px]" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading || accountRequestLoading}
                className="group mt-2 h-12 w-full rounded-xl bg-[#0b1b2b] text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:bg-[#132c40] focus-visible:ring-cyan-600/40"
              >
                {isLoading || accountRequestLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {creatingAccount ? "Creating account…" : "Signing in…"}
                  </>
                ) : (
                  <>
                    {creatingAccount ? "Create account" : "Sign in"}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => {
                setCreatingAccount((current) => !current);
                setAccountFeedback(null);
                clearError();
              }}
              disabled={isLoading || accountRequestLoading}
              className="mt-5 w-full rounded-lg py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/40 disabled:opacity-50"
            >
              {creatingAccount
                ? "Already have an account? Sign in"
                : "Need an account? Create one"}
            </button>

            {!creatingAccount && (
              <>
                <div className="my-7 flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    Demo access
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {demoAccounts.map((account) => (
                    <button
                      key={account.username}
                      type="button"
                      onClick={() =>
                        fillDemoAccount(account.username, account.password)
                      }
                      disabled={isLoading}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50/60 hover:text-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {account.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-center text-xs text-slate-400">
                  Select a demo account to fill in its credentials.
                </p>
              </>
            )}
          </div>

          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Your connection is protected and secure
          </p>
        </div>
      </section>
    </main>
  );
}

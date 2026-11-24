import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Lock,
  ShieldAlert,
  Terminal,
  UserPlus,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { validateUsername } from '../services/crypto';

const TERMINAL_STEPS = [
  'INITIALIZING ROOH SYSTEM...',
  'ESTABLISHING SECURE SESSION...',
  'VERIFYING USER ID...',
  'AUTHENTICATION COMPLETE.',
];

export const AuthTerminal: React.FC = () => {
  const {
    hasExistingAccount,
    register,
    login,
    preferences,
    addToast,
  } = useVault();

  const [mode, setMode] = useState<'login' | 'signup'>(hasExistingAccount ? 'login' : 'signup');

  const [touchedTab, setTouchedTab] = useState(false);
  useEffect(() => {
    if (!touchedTab) {
      setMode(hasExistingAccount ? 'login' : 'signup');
    }
  }, [hasExistingAccount, touchedTab]);

  const fullTagline = 'Your memories. Your universe. Your private cloud.';
  const [typedLength, setTypedLength] = useState(0);
  useEffect(() => {
    if (preferences.reducedMotion) {
      setTypedLength(fullTagline.length);
      return;
    }
    if (typedLength >= fullTagline.length) return;
    const timer = setTimeout(() => setTypedLength((n) => n + 1), 24);
    return () => clearTimeout(timer);
  }, [typedLength, preferences.reducedMotion]);

  const [username, setUsername] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<'idle' | 'verifying' | 'granted' | 'denied'>('idle');

  const usernameValidation = useMemo(() => validateUsername(username), [username]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!usernameValidation.valid) {
      setErrorMsg(usernameValidation.error || 'Invalid username.');
      return;
    }

    setIsSubmitting(true);
    try {
      await register(username);
      addToast({
        type: 'success',
        title: 'Vault initialized',
        description: 'Welcome to rooh.clouds.',
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAuthStatus('verifying');
    setTerminalLines([]);
    setIsSubmitting(true);

    const stepDelay = preferences.reducedMotion ? 30 : 180;

    try {
      for (let i = 0; i < TERMINAL_STEPS.length - 1; i++) {
        setTerminalLines((prev) => [...prev, TERMINAL_STEPS[i]]);
        await new Promise((r) => setTimeout(r, stepDelay));
      }

      await login(username);

      setTerminalLines((prev) => [...prev, TERMINAL_STEPS[3], 'ACCESS GRANTED']);
      setAuthStatus('granted');
      await new Promise((r) => setTimeout(r, preferences.reducedMotion ? 50 : 320));
    } catch (err) {
      setTerminalLines((prev) => [...prev, 'ACCESS DENIED']);
      setAuthStatus('denied');
      setErrorMsg(err instanceof Error ? err.message : 'ACCESS DENIED');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Terminal Identity Panel */}
        <div className="lg:col-span-5 bg-[#090D0D]/90 border border-white/10 rounded-xl p-6 md:p-7 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-8 h-8 rounded-lg bg-[#39FF88]/10 border border-[#39FF88]/30 flex items-center justify-center text-[#39FF88]">
                <Terminal className="w-4 h-4" />
              </div>
              <span className="text-base font-bold tracking-tight text-[#E6F1EE]">rooh.clouds</span>
            </div>

            <h1 className="text-2xl font-bold text-[#E6F1EE] tracking-tight leading-snug mb-3 text-balance">
              Private Digital Vault
            </h1>

            <p className="text-xs text-[#39FF88] min-h-[2.5rem] leading-relaxed">
              {fullTagline.slice(0, typedLength)}
              <span className="inline-block w-2 h-3.5 bg-[#39FF88] ml-1 align-middle rooh-cursor-blink" />
            </p>

            <div
              aria-live="polite"
              className="mt-6 bg-[#030505] border border-white/10 rounded-lg p-4 min-h-[156px] text-xs space-y-1.5"
            >
              <div className="text-[#6E827D] text-[11px] mb-2">Session Terminal</div>
              {terminalLines.length === 0 ? (
                <div className="text-[#6E827D]">
                  Awaiting local operator credentials...
                </div>
              ) : (
                terminalLines.map((line, idx) => {
                  const isGranted = line === 'ACCESS GRANTED';
                  const isDenied = line === 'ACCESS DENIED';
                  return (
                    <div
                      key={`${line}-${idx}`}
                      className={
                        isGranted
                          ? 'text-[#39FF88] font-bold pt-1'
                          : isDenied
                          ? 'text-red-400 font-bold pt-1'
                          : 'text-[#A3B5B0]'
                      }
                    >
                      {line}
                    </div>
                  );
                })
              )}
              {authStatus === 'verifying' && (
                <div className="text-[#00E5FF]">Verifying Web Crypto session...</div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-white/10">
            <div className="flex items-start gap-2.5 text-[11px] text-[#8A9D98] font-sans-ui leading-relaxed">
              <ShieldAlert className="w-4 h-4 text-[#00E5FF] shrink-0 mt-0.5" />
              <p>
                <strong className="text-[#E6F1EE] font-medium">Cross-Browser Vault Auth:</strong> Secure Web Crypto session persistence allows instant access across devices via your Username or Vault UUID.
              </p>
            </div>
          </div>
        </div>

        {/* Right Auth Form Card */}
        <div className="lg:col-span-7 bg-[#090D0D]/95 border border-[#39FF88]/20 rounded-xl p-6 md:p-8 flex flex-col justify-center">
          <div className="flex items-center gap-1 p-1 bg-[#030505] border border-white/10 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setTouchedTab(true);
                setMode('login');
                setErrorMsg(null);
                setAuthStatus('idle');
              }}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-[#39FF88]/15 text-[#39FF88] border border-[#39FF88]/30'
                  : 'text-[#8A9D98] hover:text-[#E6F1EE]'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTouchedTab(true);
                setMode('signup');
                setErrorMsg(null);
                setAuthStatus('idle');
              }}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'signup'
                  ? 'bg-[#39FF88]/15 text-[#39FF88] border border-[#39FF88]/30'
                  : 'text-[#8A9D98] hover:text-[#E6F1EE]'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Create Vault
            </button>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="mb-5 bg-red-500/10 border border-red-500/35 rounded-lg px-4 py-3 flex items-start gap-2.5 text-xs text-red-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-username" className="block text-xs font-medium text-[#A3B5B0] mb-1.5">
                  Username or Vault ID
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="operator_handle or Vault UUID"
                  className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3.5 py-2.5 text-sm text-[#E6F1EE] placeholder:text-[#4F615C]"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-3 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] disabled:opacity-50 transition-colors rooh-glitch-hover"
              >
                {isSubmitting ? 'Authenticating...' : 'Unlock Vault'}
              </button>

              <div className="pt-3 border-t border-white/10 text-center">
                <p className="text-[11px] text-[#8A9D98] font-sans-ui">
                  Access from any browser: Enter your Username or Vault UUID to connect your vault instantly.
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label htmlFor="signup-username" className="block text-xs font-medium text-[#A3B5B0] mb-1.5">
                  Username
                </label>
                <input
                  id="signup-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose unique handle (min 3 chars)"
                  className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3.5 py-2.5 text-sm text-[#E6F1EE] placeholder:text-[#4F615C]"
                />
                {username.length > 0 && !usernameValidation.valid && (
                  <p className="text-[11px] text-amber-400 mt-1">{usernameValidation.error}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-3 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] disabled:opacity-50 transition-colors rooh-glitch-hover"
              >
                {isSubmitting ? 'Creating Vault...' : 'Create Vault'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

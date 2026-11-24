import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  KeyRound,
  Lock,
  ShieldAlert,
  Terminal,
  UserPlus,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { validateUsername } from '../services/crypto';
import { VaultModal } from './Modals';

const TERMINAL_STEPS = [
  'INITIALIZING ROOH SYSTEM...',
  'ESTABLISHING SECURE SESSION...',
  'VERIFYING USER ID...',
  'VALIDATING ROOH KEY...',
  'AUTHENTICATION COMPLETE.',
];

export const AuthTerminal: React.FC = () => {
  const {
    hasExistingAccount,
    pendingRoohKey,
    clearPendingRoohKey,
    register,
    login,
    checkRecoveryEligibility,
    recoverKeyOnThisBrowser,
    recoverKeyViaGoogle,
    user,
    addToast,
    preferences,
  } = useVault();

  const [mode, setMode] = useState<'login' | 'signup'>(hasExistingAccount ? 'login' : 'signup');

  // Sync initial tab once DB check completes (only if user hasn't typed yet)
  const [touchedTab, setTouchedTab] = useState(false);
  useEffect(() => {
    if (!touchedTab) {
      setMode(hasExistingAccount ? 'login' : 'signup');
    }
  }, [hasExistingAccount, touchedTab]);

  // Typing tagline animation
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

  // Form states
  const [username, setUsername] = useState('');
  const [roohKey, setRoohKey] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Terminal sequence animation state
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<'idle' | 'verifying' | 'granted' | 'denied'>('idle');

  // One-time recovery screen state
  const [keyCopied, setKeyCopied] = useState(false);
  const [keySavedConfirmed, setKeySavedConfirmed] = useState(false);

  // Forgot Rooh Key modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [recoverIdentifier, setRecoverIdentifier] = useState('');
  const [recoverVaultUuid, setRecoverVaultUuid] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<{
    found: boolean;
    vaultId: string;
    username: string;
    hasLocalTrust: boolean;
    boundDriveEmail?: string;
  } | null>(null);

  useEffect(() => {
    if (!forgotOpen) return;
    const clean = recoverIdentifier.trim();
    if (clean.length < 3) {
      setRecoveryInfo(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      checkRecoveryEligibility(clean)
        .then((info) => {
          if (active) setRecoveryInfo(info);
        })
        .catch(() => {
          if (active) setRecoveryInfo(null);
        });
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [forgotOpen, recoverIdentifier, checkRecoveryEligibility]);

  const openForgotModal = () => {
    setRecoverIdentifier(username.trim());
    setRecoverVaultUuid('');
    setRecoverError(null);
    setRecoveryInfo(null);
    setForgotOpen(true);
  };

  const handleBrowserRecoverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoverBusy(true);
    setRecoverError(null);
    try {
      await recoverKeyOnThisBrowser(recoverIdentifier, recoverVaultUuid);
      setForgotOpen(false);
      addToast({
        type: 'success',
        title: 'New Rooh Key issued',
        description: 'Save your replacement key immediately.',
      });
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : 'Unable to recover Rooh Key.');
    } finally {
      setRecoverBusy(false);
    }
  };

  const handleGoogleRecover = async () => {
    setRecoverBusy(true);
    setRecoverError(null);
    try {
      await recoverKeyViaGoogle(recoverIdentifier);
      setForgotOpen(false);
      addToast({
        type: 'success',
        title: 'Verified via Google & new Rooh Key issued',
        description: 'Save your replacement key immediately.',
      });
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : 'Google verification failed.');
    } finally {
      setRecoverBusy(false);
    }
  };

  const usernameValidation = useMemo(() => validateUsername(username), [username]);

  const handleCopyKey = async () => {
    if (!pendingRoohKey) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(pendingRoohKey);
      } else {
        throw new Error('Clipboard API restricted');
      }
      setKeyCopied(true);
      addToast({ type: 'success', title: 'Rooh Key copied to clipboard' });
      setTimeout(() => setKeyCopied(false), 2500);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = pendingRoohKey;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
          setKeyCopied(true);
          addToast({ type: 'success', title: 'Rooh Key copied to clipboard' });
          setTimeout(() => setKeyCopied(false), 2500);
          return;
        }
      } catch {
        // fall through to manual toast
      }
      addToast({
        type: 'info',
        title: 'Use Download Key or copy manually',
        description: 'Browser clipboard access is restricted in this context.',
      });
    }
  };

  const handleDownloadKey = () => {
    if (!pendingRoohKey) return;
    const content = [
      'ROOH.CLOUDS — ONE-TIME VAULT RECOVERY KEY',
      '==========================================',
      `Username: ${user?.username || username}`,
      `Vault ID: ${user?.id || 'pending'}`,
      `Rooh Key: ${pendingRoohKey}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'IMPORTANT:',
      '- Keep this key safe. It is required alongside your Username or Vault ID to unlock your vault on any browser.',
      '- rooh.clouds never stores or displays your plaintext Rooh Key after setup.',
      '- Your encrypted vault syncs across browsers via Cloud Vault and optional Google Drive backup.',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rooh-recovery-key-${(user?.username || username || 'vault').toLowerCase()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Recovery key file downloaded' });
  };

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
      setKeySavedConfirmed(false);
      addToast({
        type: 'success',
        title: 'Vault initialized',
        description: 'Save your one-time Rooh Key before entering.',
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

      await login(username, roohKey);

      setTerminalLines((prev) => [...prev, TERMINAL_STEPS[4], 'ACCESS GRANTED']);
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

  // One-time Rooh Key Recovery Screen
  if (pendingRoohKey) {
    return (
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4 md:p-8">
        <motion.div
          initial={preferences.reducedMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-xl bg-[#090D0D]/95 border border-[#39FF88]/30 rounded-xl p-6 md:p-8 shadow-2xl"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#39FF88]/10 border border-[#39FF88]/30 flex items-center justify-center text-[#39FF88]">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#E6F1EE] tracking-tight">
                Save Your One-Time Rooh Key
              </h1>
              <p className="text-xs text-[#8A9D98] font-sans-ui">
                Required with your password on every sign-in. Shown once only.
              </p>
            </div>
          </div>

          <div className="my-6 bg-[#030505] border border-[#39FF88]/35 rounded-lg p-5 text-center space-y-2.5">
            <div className="text-[11px] text-[#8A9D98] font-sans-ui">
              Unique Cryptographic Rooh Key for <span className="text-[#E6F1EE] font-mono">{user?.username}</span>
            </div>
            <div
              data-testid="generated-rooh-key"
              className="text-xl sm:text-2xl font-bold tracking-[0.14em] text-[#39FF88] select-all break-all"
            >
              {pendingRoohKey}
            </div>
            {user?.id && (
              <div className="pt-2 border-t border-white/10 text-[11px] text-[#8A9D98] font-mono break-all select-all">
                Vault ID: <span className="text-[#00E5FF]">{user.id}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mb-6">
            <button
              type="button"
              onClick={handleCopyKey}
              className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg border border-[#39FF88]/30 bg-[#39FF88]/10 text-[#39FF88] hover:bg-[#39FF88]/20 transition-colors whitespace-nowrap"
            >
              {keyCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {keyCopied ? 'Copied Key' : 'Copy Key'}
            </button>
            <button
              type="button"
              onClick={handleDownloadKey}
              className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20 transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              Download Key
            </button>
          </div>

          <div className="bg-[#0F1515] border border-white/10 rounded-lg p-4 mb-6 text-xs text-[#A3B5B0] font-sans-ui leading-relaxed">
            Once you leave this screen, the complete Rooh Key is discarded from memory and only its salted PBKDF2 hash remains. Use your Username or Vault ID with this key on any browser to access your vault.
          </div>

          <label className="flex items-start gap-3 cursor-pointer mb-6 select-none">
            <input
              type="checkbox"
              checked={keySavedConfirmed}
              onChange={(e) => setKeySavedConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-white/25 bg-[#030505] accent-[#39FF88]"
            />
            <span className="text-xs text-[#E6F1EE] font-sans-ui leading-relaxed">
              I confirm that I have copied or downloaded my Rooh Key and stored it safely.
            </span>
          </label>

          <button
            type="button"
            disabled={!keySavedConfirmed}
            onClick={() => {
              clearPendingRoohKey();
              addToast({
                type: 'success',
                title: 'Welcome to rooh.clouds',
                description: 'Your personal local vault is unlocked.',
              });
            }}
            className="w-full py-3 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
          >
            Enter Vault
          </button>
        </motion.div>
      </div>
    );
  }

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

            {/* Terminal authentication log output */}
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
                <div className="text-[#00E5FF]">Verifying Web Crypto digest...</div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-white/10">
            <div className="flex items-start gap-2.5 text-[11px] text-[#8A9D98] font-sans-ui leading-relaxed">
              <ShieldAlert className="w-4 h-4 text-[#00E5FF] shrink-0 mt-0.5" />
              <p>
                <strong className="text-[#E6F1EE] font-medium">Cross-Browser Vault Auth:</strong> Credentials are hashed with Web Crypto PBKDF2 and synced cleanly so your Username or Vault UUID + Rooh Key unlocks your vault from any browser.
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

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label htmlFor="login-rooh-key" className="block text-xs font-medium text-[#A3B5B0]">
                    Rooh Key
                  </label>
                  <button
                    type="button"
                    onClick={openForgotModal}
                    className="text-[11px] text-[#00E5FF] hover:underline"
                  >
                    Forgot Rooh Key?
                  </button>
                </div>
                <input
                  id="login-rooh-key"
                  type="text"
                  required
                  value={roohKey}
                  onChange={(e) => setRoohKey(e.target.value.toUpperCase())}
                  placeholder="ROOH-XXXX-XXXX-XXXX"
                  className="w-full bg-[#030505] border border-white/15 focus:border-[#00E5FF] focus:outline-none rounded-lg px-3.5 py-2.5 text-sm text-[#00E5FF] tracking-wider placeholder:text-[#4F615C]"
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
                  Access from any browser: Enter your Username (or Vault UUID) &amp; Rooh Key to connect your vault anywhere.
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

              <div className="p-3 bg-white/5 border border-white/10 rounded-lg text-xs text-[#A3B5B0]">
                <p className="text-[#39FF88] font-medium mb-1">Rooh Key Generation</p>
                A secure <code className="text-[#00E5FF]">ROOH-XXXX-XXXX-XXXX</code> key will be generated instantly upon creation to secure your vault.
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-3 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] disabled:opacity-50 transition-colors rooh-glitch-hover"
              >
                {isSubmitting ? 'Generating Rooh Key...' : 'Create Vault'}
              </button>
            </form>
          )}
        </div>
      </div>

      <VaultModal
        open={forgotOpen}
        title="Forgot Rooh Key — Browser Recovery"
        onClose={() => setForgotOpen(false)}
      >
        <form onSubmit={handleBrowserRecoverSubmit} className="space-y-4">
          <p className="text-xs text-[#A3B5B0] font-sans-ui leading-relaxed">
            Reset your Rooh Key from a browser where you have previously unlocked this vault (verified via local IndexedDB trust + your exact Vault UUID).
          </p>

          {recoverError && (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/35 rounded-lg px-3.5 py-2.5 text-xs text-red-300"
            >
              {recoverError}
            </div>
          )}

          <div>
            <label htmlFor="recover-identifier" className="block text-xs font-medium text-[#A3B5B0] mb-1.5">
              Username or Bound Email
            </label>
            <input
              id="recover-identifier"
              type="text"
              required
              value={recoverIdentifier}
              onChange={(e) => setRecoverIdentifier(e.target.value)}
              placeholder="tejaspphirake or shunyavansh@gmail.com"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#E6F1EE] placeholder:text-[#4F615C]"
            />
          </div>

          {recoveryInfo && (
            <div
              className={`rounded-lg p-3 text-[11px] font-sans-ui border ${
                recoveryInfo.found && recoveryInfo.hasLocalTrust
                  ? 'bg-[#39FF88]/10 border-[#39FF88]/30 text-[#A3B5B0]'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              }`}
            >
              {!recoveryInfo.found ? (
                <span>No matching vault found yet for that identifier.</span>
              ) : recoveryInfo.hasLocalTrust ? (
                <span>
                  Verified: This browser has prior local vault trust for{' '}
                  <strong className="text-[#39FF88]">{recoveryInfo.username}</strong>. Confirm your Vault UUID below to generate a replacement Rooh Key.
                </span>
              ) : (
                <span>
                  No prior local IndexedDB session was found on this browser for{' '}
                  <strong>{recoveryInfo.username}</strong>. Open a previously logged-in browser or verify your bound Google account below.
                </span>
              )}
            </div>
          )}

          <div>
            <label htmlFor="recover-vault-uuid" className="block text-xs font-medium text-[#A3B5B0] mb-1.5">
              Confirm Vault UUID
            </label>
            <input
              id="recover-vault-uuid"
              type="text"
              required={Boolean(!recoveryInfo || recoveryInfo.hasLocalTrust)}
              value={recoverVaultUuid}
              onChange={(e) => setRecoverVaultUuid(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#00E5FF] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#00E5FF] font-mono placeholder:text-[#4F615C]"
            />
          </div>

          <div className="bg-[#0F1515] border border-white/10 rounded-lg p-3 text-[11px] text-[#8A9D98] font-sans-ui">
            Previously AES-256-GCM encrypted files encrypted with your old key still require the old key to decrypt.
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setForgotOpen(false)}
              className="px-3.5 py-2 text-xs text-[#8A9D98] border border-white/10 rounded-lg hover:text-[#E6F1EE]"
            >
              Cancel
            </button>
            {recoveryInfo?.found && recoveryInfo.boundDriveEmail && !recoveryInfo.hasLocalTrust && (
              <button
                type="button"
                disabled={recoverBusy}
                onClick={handleGoogleRecover}
                className="px-3.5 py-2 text-xs font-semibold bg-[#00E5FF]/15 text-[#00E5FF] border border-[#00E5FF]/35 rounded-lg hover:bg-[#00E5FF]/25 disabled:opacity-50"
              >
                {recoverBusy ? 'Verifying...' : `Verify Google (${recoveryInfo.boundDriveEmail})`}
              </button>
            )}
            <button
              type="submit"
              disabled={recoverBusy || Boolean(recoveryInfo && !recoveryInfo.hasLocalTrust)}
              className="px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50"
            >
              {recoverBusy ? 'Resetting...' : 'Reset & Generate New Key'}
            </button>
          </div>
        </form>
      </VaultModal>
    </div>
  );
};

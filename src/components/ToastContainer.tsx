import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useVault } from '../context/VaultContext';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast, preferences } = useVault();

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 md:bottom-5 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const borderClass =
            toast.type === 'success'
              ? 'border-[#39FF88]/35'
              : toast.type === 'error'
              ? 'border-red-500/45'
              : toast.type === 'warning'
              ? 'border-amber-400/40'
              : 'border-[#00E5FF]/35';

          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error'
              ? XCircle
              : toast.type === 'warning'
              ? AlertTriangle
              : Info;

          const iconColor =
            toast.type === 'success'
              ? 'text-[#39FF88]'
              : toast.type === 'error'
              ? 'text-red-400'
              : toast.type === 'warning'
              ? 'text-amber-400'
              : 'text-[#00E5FF]';

          return (
            <motion.div
              key={toast.id}
              initial={preferences.reducedMotion ? { opacity: 1 } : { opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={preferences.reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className={`pointer-events-auto bg-[#0A0E0E]/95 backdrop-blur-md border ${borderClass} rounded-lg px-4 py-3 shadow-lg flex items-start gap-3`}
            >
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#E6F1EE] leading-snug">{toast.title}</p>
                {toast.description && (
                  <p className="text-xs text-[#8A9D98] mt-0.5 leading-snug font-sans-ui">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label={`Dismiss notification: ${toast.title}`}
                className="text-[#6E827D] hover:text-[#E6F1EE] p-1 -m-1 rounded transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

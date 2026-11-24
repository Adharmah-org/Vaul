import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthTerminal } from './components/AuthTerminal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HackerDockShell } from './components/HackerDockShell';
import { MatrixBackground } from './components/MatrixBackground';
import { ToastContainer } from './components/ToastContainer';
import { useVault, VaultProvider } from './context/VaultContext';

const VaultAppRouter: React.FC = () => {
  const { user, session, isInitializing, preferences } = useVault();

  const accentHex = preferences.accentMode === 'cyan' ? '#00E5FF' : '#39FF88';

  return (
    <div className="relative min-h-screen bg-[#030505] text-[#E6F1EE]">
      <MatrixBackground
        enabled={preferences.matrixRain && !preferences.reducedMotion}
        accentColor={accentHex}
      />

      {preferences.scanlines && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-20 rooh-scanlines opacity-20"
        />
      )}

      {isInitializing ? (
        <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
          <div className="text-xs text-[#39FF88] tracking-wider">
            INITIALIZING ROOH VAULT...
          </div>
        </div>
      ) : !user || !session ? (
        <AuthTerminal />
      ) : (
        <Routes>
          <Route path="/all" element={<HackerDockShell />} />
          <Route path="/images" element={<HackerDockShell />} />
          <Route path="/videos" element={<HackerDockShell />} />
          <Route path="/documents" element={<HackerDockShell />} />
          <Route path="/links" element={<HackerDockShell />} />
          <Route path="/browser" element={<HackerDockShell />} />
          <Route path="/notes" element={<HackerDockShell />} />
          <Route path="/favorites" element={<HackerDockShell />} />
          <Route path="/trash" element={<HackerDockShell />} />
          <Route path="/analytics" element={<HackerDockShell />} />
          <Route path="/settings" element={<HackerDockShell />} />
          <Route path="*" element={<Navigate to="/all" replace />} />
        </Routes>
      )}

      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <VaultProvider>
          <VaultAppRouter />
        </VaultProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

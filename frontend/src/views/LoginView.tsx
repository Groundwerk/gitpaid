import React, { useEffect, useState } from 'react';
import { API_BASE } from '../utils/api';

interface LoginViewProps {
  onLoginSuccess: (authData: { token: string; email: string; name: string; avatar: string; companyId: number | null; needsOnboarding: boolean }) => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLoginSuccess,
  triggerToast
}) => {
  const [bypassToken, setBypassToken] = useState('mock-google-token-admin');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if GIS script loaded and initialize Google Auth Button
    const initGis = () => {
      const g = (window as any).google;
      if (g && g.accounts) {
        g.accounts.id.initialize({
          // Placeholder client_id. Can override in settings if needed.
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || '123456789-placeholder.apps.googleusercontent.com',
          callback: async (response: any) => {
            await handleLogin(response.credential);
          }
        });
        g.accounts.id.renderButton(
          document.getElementById('google-signin-button'),
          { theme: 'filled_blue', size: 'large', width: 300, shape: 'pill' }
        );
      }
    };

    // Retry initialization in case script loads slowly
    const interval = setInterval(() => {
      if ((window as any).google) {
        initGis();
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const handleLogin = async (idToken: string) => {
    try {
      setLoading(true);
      // Call auth endpoint:
      const authResponse = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });

      if (!authResponse.ok) {
        const err = await authResponse.json() as any;
        throw new Error(err.error || 'Authentication failed');
      }

      const session = await authResponse.json() as any;
      triggerToast(`Welcome back, ${session.name}!`, 'success');
      onLoginSuccess(session);
    } catch (error: any) {
      console.error('Login error:', error);
      triggerToast(error.message || 'Google Auth verification failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBypassSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bypassToken.trim()) return;
    handleLogin(bypassToken.trim());
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest border border-outline-variant shadow-lg rounded-2xl p-8 max-w-md w-full flex flex-col items-center">
        {/* Brand Logo */}
        <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-on-primary font-bold text-lg shadow-sm mb-4">
          OP
        </div>
        
        <h2 className="text-2xl font-bold text-primary tracking-tight text-center mb-1">Ontario Payroll Portal</h2>
        <p className="text-xs text-on-surface-variant text-center mb-8 font-medium">
          Ontario compliant payroll, WSIB, EHT, and tax form automation.
        </p>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="text-xs text-on-surface-variant font-medium">Verifying credentials...</p>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center gap-6">
            {/* Google Identity Services Render Target */}
            <div id="google-signin-button" className="min-h-[40px] flex items-center justify-center"></div>

            <div className="w-full flex items-center my-2">
              <div className="h-px bg-outline-variant flex-1"></div>
              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider font-bold px-3">or live test bypass</span>
              <div className="h-px bg-outline-variant flex-1"></div>
            </div>

            {/* Test Bypass Form */}
            <form onSubmit={handleBypassSubmit} className="w-full flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="bypassToken">
                  Mock Google Token
                </label>
                <input 
                  type="text" 
                  id="bypassToken"
                  value={bypassToken}
                  onChange={(e) => setBypassToken(e.target.value)}
                  placeholder="mock-google-token-admin"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent text-center font-mono w-full"
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-surface-container-low border border-outline hover:bg-surface-container-high text-xs font-bold py-2.5 px-4 rounded-xl text-primary transition-colors flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[16px]">bug_report</span>
                Bypass Auth for Live Testing
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginView;

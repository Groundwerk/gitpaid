import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DashboardView from './views/DashboardView';
import EmployeeDirectoryView from './views/EmployeeDirectoryView';
import EmployeeProfileView from './views/EmployeeProfileView';
import PayrollRunView from './views/PayrollRunView';
import ReportsView from './views/ReportsView';
import SettingsView from './views/SettingsView';
import LoginView from './views/LoginView';
import OnboardingView from './views/OnboardingView';
import { api } from './utils/api';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export const App: React.FC = () => {
  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  const [userName, setUserName] = useState<string | null>(localStorage.getItem('name'));
  const [userAvatar, setUserAvatar] = useState<string | null>(localStorage.getItem('avatar'));
  const [companyId, setCompanyId] = useState<number | null>(() => {
    const val = localStorage.getItem('companyId');
    return val && val !== 'null' ? parseInt(val, 10) : null;
  });
  const [companyName, setCompanyName] = useState<string>('My Business');
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [useCompanyBranding, setUseCompanyBranding] = useState<boolean>(false);


  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Navigation states for employee view subroutes
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [isOnboardingNew, setIsOnboardingNew] = useState<boolean>(false);
  const [selectedScheduleIdForRun, setSelectedScheduleIdForRun] = useState<number | null>(null);

  // Check for Gmail connection callback params in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailSuccess = params.get('gmail_success');
    const gmailError = params.get('gmail_error');

    if (gmailSuccess) {
      triggerToast('Gmail account connected successfully!', 'success');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (gmailError) {
      triggerToast(`Failed to connect Gmail: ${decodeURIComponent(gmailError)}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Fetch company settings including branding when companyId is set
  useEffect(() => {
    if (token && companyId) {
      api.getSettings()
        .then(settings => {
          if (settings && settings.legal_name) {
            setCompanyName(settings.legal_name);
          }
          setBrandLogo(settings?.logo_url || null);
          setBrandColor(settings?.brand_color || null);
          setUseCompanyBranding(settings?.use_company_branding === 1);
        })
        .catch(err => {
          console.error('Failed to load company settings:', err);
        });
    }
  }, [token, companyId]);

  // Inject brand color as CSS variables whenever it changes
  useEffect(() => {
    // Explicitly clean up any historical settings of --brand-primary
    document.documentElement.style.removeProperty('--brand-primary');
    document.documentElement.style.removeProperty('--brand-primary-container');

    if (brandColor) {
      document.documentElement.style.setProperty('--brand-highlight', brandColor);
      // Derive a slightly lighter shade for secondary/container variants
      document.documentElement.style.setProperty('--brand-highlight-container', brandColor);
    } else {
      document.documentElement.style.removeProperty('--brand-highlight');
      document.documentElement.style.removeProperty('--brand-highlight-container');
    }
  }, [brandColor]);


  const triggerToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    
    // Auto-remove toast after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleLoginSuccess = (authData: { token: string; email: string; name: string; avatar: string; companyId: number | null; needsOnboarding: boolean }) => {
    localStorage.setItem('token', authData.token);
    localStorage.setItem('email', authData.email);
    localStorage.setItem('name', authData.name);
    localStorage.setItem('avatar', authData.avatar);
    if (authData.companyId) {
      localStorage.setItem('companyId', authData.companyId.toString());
    } else {
      localStorage.removeItem('companyId');
    }
    
    setToken(authData.token);

    setUserName(authData.name);
    setUserAvatar(authData.avatar);
    setCompanyId(authData.companyId);
  };

  const handleOnboardingComplete = (newToken: string, newCompanyId: number) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('companyId', newCompanyId.toString());
    
    setToken(newToken);
    setCompanyId(newCompanyId);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('email');
    localStorage.removeItem('name');
    localStorage.removeItem('avatar');
    localStorage.removeItem('companyId');
    
    setToken(null);
    setUserName(null);
    setUserAvatar(null);
    setCompanyId(null);
    setCompanyName('My Business');
    setBrandLogo(null);
    setBrandColor(null);
    setUseCompanyBranding(false);
    document.documentElement.style.removeProperty('--brand-highlight');
    document.documentElement.style.removeProperty('--brand-highlight-container');
    document.documentElement.style.removeProperty('--brand-primary');
    document.documentElement.style.removeProperty('--brand-primary-container');
    triggerToast('Signed out successfully.', 'success');
  };


  const handleSettingsUpdate = () => {
    if (token && companyId) {
      api.getSettings()
        .then(settings => {
          if (settings && settings.legal_name) {
            setCompanyName(settings.legal_name);
          }
          setBrandLogo(settings?.logo_url || null);
          setBrandColor(settings?.brand_color || null);
          setUseCompanyBranding(settings?.use_company_branding === 1);
        })
        .catch(err => console.error(err));
    }
  };


  const navigateToTab = (tabId: string) => {
    // Reset employee subviews when switching tabs
    setEditingEmployeeId(null);
    setIsOnboardingNew(false);
    if (tabId !== 'run-payroll') {
      setSelectedScheduleIdForRun(null);
    }
    setActiveTab(tabId);
  };

  const getPageTitle = () => {
    if (isOnboardingNew) return 'Onboard New Employee';
    if (editingEmployeeId !== null) return 'Edit Employee Profile';
    
    switch (activeTab) {
      case 'dashboard': return 'Dashboard';
      case 'employees': return 'Employee Directory';
      case 'run-payroll': return 'Run Payroll';
      case 'reports': return 'Reports & History';
      case 'settings': return 'Company Settings';
      default: return 'Ontario Payroll';
    }
  };

  const renderContent = () => {
    // Render employee setup forms if active
    if (isOnboardingNew) {
      return (
        <EmployeeProfileView 
          employeeId={null} 
          onBack={() => setIsOnboardingNew(false)} 
          triggerToast={triggerToast}
        />
      );
    }

    if (editingEmployeeId !== null) {
      return (
        <EmployeeProfileView 
          employeeId={editingEmployeeId} 
          onBack={() => setEditingEmployeeId(null)} 
          triggerToast={triggerToast}
        />
      );
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardView 
            onStartPayroll={(scheduleId) => {
              if (scheduleId) {
                setSelectedScheduleIdForRun(scheduleId);
              } else {
                setSelectedScheduleIdForRun(null);
              }
              navigateToTab('run-payroll');
            }}
            onNavigateToTab={navigateToTab}
            triggerToast={triggerToast}
          />
        );
      case 'employees':
        return (
          <EmployeeDirectoryView 
            onEditEmployee={(id) => setEditingEmployeeId(id)}
            onNewEmployee={() => setIsOnboardingNew(true)}
            triggerToast={triggerToast}
          />
        );
      case 'run-payroll':
        return (
          <PayrollRunView 
            preselectedScheduleId={selectedScheduleIdForRun}
            onSuccess={() => {
              setSelectedScheduleIdForRun(null);
              navigateToTab('reports');
            }}
            triggerToast={triggerToast}
          />
        );
      case 'reports':
        return <ReportsView triggerToast={triggerToast} />;
      case 'settings':
        return <SettingsView triggerToast={triggerToast} onSettingsUpdate={handleSettingsUpdate} />;
      default:
        return (
          <div className="p-8 text-center bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm">
            <h2 className="text-xl font-bold text-primary mb-2">Page Under Construction</h2>
            <p className="text-sm text-on-surface-variant">The selected dashboard tab is currently preparing compliance resources.</p>
          </div>
        );
    }
  };

  // Render LoginView if unauthenticated
  if (!token) {
    return (
      <div className="bg-background text-on-background antialiased min-h-screen flex items-center justify-center text-sm">
        <LoginView onLoginSuccess={handleLoginSuccess} triggerToast={triggerToast} />
        {/* Toast stack for login notifications */}
        <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
          {toasts.map((t) => (
            <div 
              key={t.id}
              className={`
                p-4 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-3 transition-all duration-300 pointer-events-auto
                ${t.type === 'success' 
                  ? 'bg-green-50 border-green-200 text-green-800' 
                  : 'bg-red-50 border-red-200 text-red-800'
                }
              `}
            >
              <span className="material-symbols-outlined">
                {t.type === 'success' ? 'check_circle' : 'error'}
              </span>
              <span className="flex-1">{t.message}</span>
              <button 
                onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))}
                className="text-on-surface-variant hover:text-on-surface transition-colors pointer-events-auto"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render OnboardingView if authenticated but missing company settings profile
  if (companyId === null) {
    return (
      <div className="bg-background text-on-background antialiased min-h-screen flex items-center justify-center text-sm">
        <OnboardingView 
          onOnboardingComplete={handleOnboardingComplete} 
          triggerToast={triggerToast} 
          onLogout={handleLogout}
        />
        {/* Toast stack for onboarding notifications */}
        <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
          {toasts.map((t) => (
            <div 
              key={t.id}
              className={`
                p-4 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-3 transition-all duration-300 pointer-events-auto
                ${t.type === 'success' 
                  ? 'bg-green-50 border-green-200 text-green-800' 
                  : 'bg-red-50 border-red-200 text-red-800'
                }
              `}
            >
              <span className="material-symbols-outlined">
                {t.type === 'success' ? 'check_circle' : 'error'}
              </span>
              <span className="flex-1">{t.message}</span>
              <button 
                onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))}
                className="text-on-surface-variant hover:text-on-surface transition-colors pointer-events-auto"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render Main Dashboard Portal if authenticated and onboarded
  return (
    <div className="bg-background text-on-background antialiased min-h-screen flex text-sm">
      {/* Sidebar Navigation */}
      <Sidebar 
        activeTab={isOnboardingNew || editingEmployeeId !== null ? 'employees' : activeTab}
        setActiveTab={navigateToTab}
        onRunPayrollClick={() => navigateToTab('run-payroll')}
        mobileOpen={mobileSidebarOpen}
        setMobileOpen={setMobileSidebarOpen}
        userName={userName || 'Administrator'}
        userAvatar={userAvatar || ''}
        onLogout={handleLogout}
        brandLogo={brandLogo}
        companyDisplayName={companyName}
        useCompanyBranding={useCompanyBranding}
      />


      {/* Main Content Layout Wrapper */}
      <div className="flex-1 md:ml-[260px] flex flex-col min-h-screen relative w-full md:w-[calc(100%-260px)]">
        {/* Top App Header */}
        <Header 
          title={getPageTitle()}
          onMenuClick={() => setMobileSidebarOpen(true)}
          onNewEmployeeClick={() => setIsOnboardingNew(true)}
          activeTab={activeTab}
          setActiveTab={navigateToTab}
          companyName={companyName}
          userAvatar={userAvatar || ''}
          onLogout={handleLogout}
        />

        {/* Dynamic page main content canvas */}
        <main className="flex-1 p-4 md:p-8 max-w-[1280px] mx-auto w-full">
          {renderContent()}
        </main>
      </div>

      {/* Toast Notice Stack */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div 
            key={t.id}
            className={`
              p-4 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-3 transition-all duration-300 pointer-events-auto animate-bounce-short
              ${t.type === 'success' 
                ? 'bg-green-50 border-green-200 text-green-800' 
                : 'bg-red-50 border-red-200 text-red-800'
              }
            `}
          >
            <span className="material-symbols-outlined">
              {t.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span className="flex-1">{t.message}</span>
            <button 
              onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))}
              className="text-on-surface-variant hover:text-on-surface transition-colors pointer-events-auto"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;

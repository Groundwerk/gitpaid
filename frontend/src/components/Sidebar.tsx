import React from 'react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onRunPayrollClick: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  userName?: string;
  userAvatar?: string;
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onRunPayrollClick,
  mobileOpen,
  setMobileOpen,
  userName = 'Administrator',
  userAvatar = '',
  onLogout
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'employees', label: 'Employees', icon: 'group' },
    { id: 'run-payroll', label: 'Payroll Run', icon: 'payments' },
    { id: 'reports', label: 'Reports', icon: 'description' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-40 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <nav className={`
        fixed left-0 top-0 h-full w-[260px] bg-surface-container-lowest border-r border-outline-variant
        flex flex-col py-6 px-4 z-40 transition-transform duration-300 ease-in-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:flex
      `}>
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-on-primary font-bold shadow-sm">
            OP
          </div>
          <div>
            <h1 className="font-semibold text-lg text-primary tracking-tight">Gitpaid</h1>
            <p className="text-xs text-on-surface-variant font-medium">Payroll Portal</p>
          </div>
        </div>

        {/* Quick Action: Run Payroll */}
        <button
          onClick={onRunPayrollClick}
          className="w-full mb-6 bg-primary text-on-primary font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 hover:bg-opacity-90 transition-all shadow-[0_4px_12px_rgba(0,30,64,0.1)] active:scale-95 duration-100"
        >
          <span className="material-symbols-outlined text-[18px]">payments</span>
          Run Payroll
        </button>

        {/* Navigation Tabs */}
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-left w-full
                  ${isActive
                    ? 'bg-primary text-on-primary font-bold shadow-sm'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }
                `}
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {item.icon}
                </span>
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-auto pt-4 border-t border-outline-variant flex flex-col gap-2">
          <div className="flex items-center gap-3 px-4 py-2 text-on-surface-variant text-sm font-medium">
            {userAvatar ? (
              <img
                src={userAvatar}
                className="w-6 h-6 rounded-full object-cover border border-outline-variant"
                alt="User"
              />
            ) : (
              <span className="material-symbols-outlined text-[20px]">account_circle</span>
            )}
            <span className="truncate max-w-[150px]">{userName}</span>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center gap-3 px-4 py-2 rounded-xl text-on-surface-variant hover:bg-red-50 hover:text-error transition-all duration-200 text-left w-full font-bold"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
              <span className="text-xs">Sign Out</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
};

export default Sidebar;

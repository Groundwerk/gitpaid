import React from 'react';

interface HeaderProps {
  title: string;
  onMenuClick: () => void;
  onNewEmployeeClick: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  companyName?: string;
  userAvatar?: string;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  onMenuClick,
  onNewEmployeeClick,
  activeTab,
  setActiveTab,
  companyName = 'My Business',
  userAvatar = '',
  onLogout
}) => {
  return (
    <header className="bg-surface border-b border-outline-variant z-30 sticky top-0 flex justify-between items-center h-16 px-4 md:px-8">
      {/* Left: Mobile hamburger & breadcrumbs */}
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuClick}
          className="md:hidden text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <span className="material-symbols-outlined text-[24px]">menu</span>
        </button>
        <span className="md:hidden font-semibold text-primary text-sm">{title}</span>
        
        {/* Navigation Tabs aligned left */}
        <nav className="hidden sm:flex items-end h-full gap-6 pt-4 self-stretch">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`pb-4 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'dashboard' ? 'border-highlight text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
          >
            Overview
          </button>
          <button 
            onClick={() => setActiveTab('reports')}
            className={`pb-4 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'reports' ? 'border-highlight text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
          >
            Reports
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`pb-4 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'settings' ? 'border-highlight text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
          >
            Compliance Config
          </button>
        </nav>
      </div>

      {/* Right: Quick actions and avatar */}
      <div className="flex items-center gap-4">
        {activeTab === 'employees' && (
          <button 
            onClick={onNewEmployeeClick}
            className="bg-highlight hover:bg-opacity-90 text-on-highlight text-xs font-semibold h-9 px-4 rounded-lg shadow-sm transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New Employee
          </button>
        )}
        
        <div className="flex items-center gap-3 border-l border-outline-variant pl-4">
          <div className="text-right hidden lg:block">
            <p className="text-xs font-bold text-on-surface">{companyName}</p>
            <p className="text-[10px] text-on-surface-variant font-medium">Ontario Account</p>
          </div>
          {onLogout ? (
            <div className="relative group">
              <button 
                title="Account Settings"
                className="w-8 h-8 rounded-full overflow-hidden border border-outline-variant hover:opacity-90 transition-opacity flex items-center justify-center bg-surface-container-high"
              >
                {userAvatar ? (
                  <img 
                    alt="User Profile" 
                    className="w-full h-full object-cover" 
                    src={userAvatar}
                  />
                ) : (
                  <span className="material-symbols-outlined text-[18px] text-primary">person</span>
                )}
              </button>
              <div className="absolute right-0 mt-1 w-32 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg py-1 hidden group-hover:block hover:block z-50">
                <button 
                  onClick={onLogout}
                  className="w-full text-left px-4 py-2 text-xs font-bold text-error hover:bg-red-50 transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[14px]">logout</span>
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full overflow-hidden border border-outline-variant flex items-center justify-center bg-surface-container-high">
              {userAvatar ? (
                <img 
                  alt="User Profile" 
                  className="w-full h-full object-cover" 
                  src={userAvatar}
                />
              ) : (
                <span className="material-symbols-outlined text-[18px] text-primary">person</span>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;

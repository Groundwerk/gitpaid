import React, { useEffect, useState } from 'react';
import type { PayrollRun } from '../types';
import { api } from '../utils/api';

interface DashboardViewProps {
  onStartPayroll: () => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ 
  onStartPayroll,
  triggerToast
}) => {
  const [ytdData, setYtdData] = useState<any>(null);
  const [recentRuns, setRecentRuns] = useState<PayrollRun[]>([]);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [ytd, runs, emps] = await Promise.all([
          api.getYtdReports(),
          api.getPayrollRuns(),
          api.getEmployees()
        ]);
        setYtdData(ytd);
        setRecentRuns(runs.slice(0, 5)); // Show top 5 recent runs
        setEmployeeCount(emps.filter(e => e.status === 'active').length);
      } catch (error: any) {
        console.error('Error fetching dashboard data:', error);
        triggerToast('Failed to load dashboard summaries.', 'error');
      } finally {
        setLoading(false);
      }
    }
    loadDashboardData();
  }, []);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(val);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Page Title Area */}
      <div>
        <h1 className="text-3xl font-bold text-on-surface mb-1">Dashboard</h1>
        <p className="text-sm text-on-surface-variant">Overview of your current payroll cycle and YTD summaries.</p>
      </div>

      {/* Bento Grid: Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* YTD Gross */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm flex flex-col justify-between hover:border-primary transition-all duration-200">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center text-primary">
              <span className="material-symbols-outlined">payments</span>
            </div>
            <span className="text-xs font-bold text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full uppercase tracking-wider">YTD</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Total Gross Pay</p>
            <h2 className="text-3xl font-bold text-on-surface">
              {ytdData ? formatCurrency(ytdData.totalGross) : '$0.00'}
            </h2>
            <p className="text-xs text-primary font-semibold mt-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">trending_up</span> Standard compliant calculations
            </p>
          </div>
        </div>

        {/* YTD Net */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm flex flex-col justify-between hover:border-primary transition-all duration-200">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center text-secondary">
              <span className="material-symbols-outlined">account_balance_wallet</span>
            </div>
            <span className="text-xs font-bold text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full uppercase tracking-wider">YTD</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Total Net Pay</p>
            <h2 className="text-3xl font-bold text-on-surface">
              {ytdData ? formatCurrency(ytdData.totalNet) : '$0.00'}
            </h2>
            <p className="text-xs text-on-surface-variant font-medium mt-2">Deposited to employee bank accounts</p>
          </div>
        </div>

        {/* CRA Remittance */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-sm flex flex-col justify-between hover:border-error transition-all duration-200">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-error-container flex items-center justify-center text-error">
              <span className="material-symbols-outlined">account_balance</span>
            </div>
            <span className="text-xs font-bold text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full uppercase tracking-wider">YTD</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">CRA Remittances</p>
            <h2 className="text-3xl font-bold text-on-surface">
              {ytdData ? formatCurrency(ytdData.craRemittance) : '$0.00'}
            </h2>
            <p className="text-xs text-on-surface-variant mt-2 font-medium">Includes employee withholdings & employer share</p>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Next Pay Run Widget */}
        <div className="lg:col-span-1 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-all duration-300">
          <div className="p-6 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
            <h3 className="font-bold text-base text-primary">Next Pay Run</h3>
            <span className="text-xs font-bold text-secondary flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span> Ready
            </span>
          </div>
          <div className="p-6 flex-1 flex flex-col justify-center items-center text-center">
            <div className="w-16 h-16 bg-surface-container-low text-primary rounded-full flex items-center justify-center mb-4 border border-outline-variant shadow-inner">
              <span className="material-symbols-outlined text-[32px]">calendar_today</span>
            </div>
            <h4 className="text-2xl font-bold text-on-surface">Oct 31, 2024</h4>
            <p className="text-xs text-on-surface-variant font-medium mb-6">Bi-weekly Period (Oct 14 - Oct 27)</p>
            
            <div className="w-full bg-surface-container-low rounded-lg p-4 flex justify-around items-center border border-outline-variant mb-6 shadow-sm">
              <div>
                <div className="text-xl font-bold text-primary">{employeeCount}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Active Staff</div>
              </div>
              <div className="w-px h-8 bg-outline-variant"></div>
              <div>
                <div className="text-xl font-bold text-primary">1</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Prov. ON</div>
              </div>
            </div>

            <button 
              onClick={onStartPayroll}
              className="w-full bg-primary text-on-primary font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 hover:bg-opacity-95 transition-all shadow-sm active:scale-[0.98]"
            >
              Begin Preparation
            </button>
          </div>
        </div>

        {/* Recent Activity List */}
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
            <h3 className="font-bold text-base text-primary">Recent Payroll Activity</h3>
            <span className="text-xs font-semibold text-on-surface-variant">Showing latest payruns</span>
          </div>
          <div className="overflow-x-auto flex-1">
            {recentRuns.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant font-medium">
                No past payroll runs recorded.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant">
                    <th className="py-3.5 px-6 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Date</th>
                    <th className="py-3.5 px-6 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Period</th>
                    <th className="py-3.5 px-6 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Total Amount</th>
                    <th className="py-3.5 px-6 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="border-b border-outline-variant hover:bg-surface-container-low/40 transition-colors">
                      <td className="py-4.5 px-6 text-sm text-on-surface font-semibold">{run.run_date}</td>
                      <td className="py-4.5 px-6 text-xs text-on-surface-variant font-medium">
                        {run.period_start} to {run.period_end}
                      </td>
                      <td className="py-4.5 px-6 text-sm font-bold text-primary">
                        {formatCurrency(run.total_gross)}
                      </td>
                      <td className="py-4.5 px-6">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200">
                          {run.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;

import React, { useEffect, useState } from 'react';
import type { PayrollRun } from '../types';
import { api } from '../utils/api';

interface DashboardViewProps {
  onStartPayroll: (scheduleId?: number) => void;
  onNavigateToTab?: (tabId: string) => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ 
  onStartPayroll,
  onNavigateToTab,
  triggerToast
}) => {
  const [ytdData, setYtdData] = useState<any>(null);
  const [recentRuns, setRecentRuns] = useState<PayrollRun[]>([]);
  const [upcomingSchedules, setUpcomingSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [ytd, runs, , schedules] = await Promise.all([
          api.getYtdReports(),
          api.getPayrollRuns(),
          api.getEmployees(),
          api.getUpcomingSchedules()
        ]);
        setYtdData(ytd);
        setRecentRuns(runs.slice(0, 5)); // Show top 5 recent runs
        setUpcomingSchedules(schedules);
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

      {/* Compliance Warning Banner */}
      {ytdData && (
        (() => {
          const alerts: { type: string; agency: string; status: string; dueDate?: string; amount: number }[] = [];
          if (ytdData.craStatus === 'DUE SOON' || ytdData.craStatus === 'OVERDUE') {
            alerts.push({ type: 'CRA', agency: 'Canada Revenue Agency (CRA)', status: ytdData.craStatus, dueDate: ytdData.craDueDate, amount: ytdData.craRemittance });
          }
          if (ytdData.wsibStatus === 'DUE SOON' || ytdData.wsibStatus === 'OVERDUE') {
            alerts.push({ type: 'WSIB', agency: 'WSIB Ontario', status: ytdData.wsibStatus, dueDate: ytdData.wsibDueDate, amount: ytdData.wsibDue });
          }
          if (!ytdData.ehtExempt && (ytdData.ehtStatus === 'DUE SOON' || ytdData.ehtStatus === 'OVERDUE')) {
            alerts.push({ type: 'EHT', agency: 'Employer Health Tax (EHT)', status: ytdData.ehtStatus, dueDate: ytdData.ehtDueDate, amount: ytdData.ehtDue });
          }

          if (alerts.length === 0) return null;

          return (
            <div className="flex flex-col gap-3">
              {alerts.map((alert, idx) => {
                const isOverdue = alert.status === 'OVERDUE';
                return (
                  <div 
                    key={idx} 
                    className={`p-4 border rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm animate-fade-in ${
                      isOverdue 
                        ? 'bg-rose-50 border-rose-200 text-rose-900 animate-pulse-light' 
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`material-symbols-outlined mt-0.5 ${isOverdue ? 'text-rose-700 animate-pulse' : 'text-amber-700'}`}>
                        {isOverdue ? 'error' : 'warning'}
                      </span>
                      <div>
                        <h4 className="text-sm font-bold flex items-center gap-2">
                          {alert.agency} Remittance {alert.status === 'OVERDUE' ? 'Overdue!' : 'Due Soon!'}
                          <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase border ${
                            isOverdue 
                              ? 'bg-rose-100 text-rose-800 border-rose-300' 
                              : 'bg-amber-100 text-amber-800 border-amber-300'
                          }`}>
                            {alert.status}
                          </span>
                        </h4>
                        <p className="text-xs font-semibold mt-1">
                          An outstanding balance of <strong className="font-extrabold">{formatCurrency(alert.amount)}</strong> is {isOverdue ? 'overdue' : 'due soon'}.
                          {alert.dueDate ? <> Please remit payment by <strong className="font-extrabold">{alert.dueDate}</strong>.</> : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <button 
                        onClick={() => onNavigateToTab?.('reports')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all hover:bg-white/40 cursor-pointer text-center block w-fit bg-transparent ${
                          isOverdue 
                            ? 'border-rose-300 text-rose-900' 
                            : 'border-amber-300 text-amber-900'
                        }`}
                      >
                        View Compliance Report
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()
      )}

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
              {ytdData ? formatCurrency(ytdData.craRemittanceYTD || ytdData.craRemittance) : '$0.00'}
            </h2>
            <p className="text-xs text-on-surface-variant mt-2 font-medium">Includes employee withholdings & employer share</p>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Pay Cycles Widget */}
        <div className="lg:col-span-1 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-all duration-300">
          <div className="p-6 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
            <h3 className="font-bold text-base text-primary">Upcoming Pay Cycles</h3>
            <span className="text-xs font-bold text-secondary flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">schedule</span> Active
            </span>
          </div>
          <div className="p-6 flex-1 flex flex-col justify-between gap-4">
            {upcomingSchedules.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-6 text-on-surface-variant font-medium text-xs">
                <span className="material-symbols-outlined text-[32px] text-outline mb-2">event_busy</span>
                No upcoming pay schedules found.<br />Configure pay groups in Settings.
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[220px] pr-1">
                {upcomingSchedules.slice(0, 4).map((schedule) => (
                  <div key={schedule.id} className="p-3 bg-surface-container-low rounded-lg border border-outline-variant flex justify-between items-center hover:border-primary transition-all">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="text-xs font-bold text-on-surface truncate">{schedule.pay_group_name}</div>
                      <div className="text-[10px] text-on-surface-variant font-semibold">
                        {schedule.period_start} to {schedule.period_end}
                      </div>
                      <div className="text-[10px] text-primary font-bold">
                        Pay Date: {schedule.payment_date}
                      </div>
                    </div>
                    <button
                      onClick={() => onStartPayroll(schedule.id)}
                      className="flex-shrink-0 px-3 py-1.5 bg-primary text-on-primary font-bold text-[10px] uppercase tracking-wider rounded hover:bg-opacity-90 transition-all flex items-center gap-1 shadow-sm"
                    >
                      Run
                      <span className="material-symbols-outlined text-[12px]">play_arrow</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => onStartPayroll()}
              className="w-full bg-surface-container-high hover:bg-surface-container-highest text-primary font-bold py-2.5 px-3 rounded-lg text-xs flex items-center justify-center gap-1 transition-all border border-outline-variant"
            >
              Ad-hoc Custom Run
              <span className="material-symbols-outlined text-[14px]">tune</span>
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
                      <td className="py-4 px-6 text-sm text-on-surface font-semibold">{run.run_date}</td>
                      <td className="py-4 px-6 text-xs text-on-surface-variant font-medium">
                        {run.period_start} to {run.period_end}
                      </td>
                      <td className="py-4 px-6 text-sm font-bold text-primary">
                        {formatCurrency(run.total_gross)}
                      </td>
                      <td className="py-4 px-6">
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

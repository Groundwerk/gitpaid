import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { PayrollRun } from '../types';

interface ReportsViewProps {
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ triggerToast }) => {
  const [loading, setLoading] = useState(true);
  const [ytdData, setYtdData] = useState<any>(null);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runDetails, setRunDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    loadReportsData();
  }, []);

  async function loadReportsData() {
    try {
      setLoading(true);
      const [ytd, runsData] = await Promise.all([
        api.getYtdReports(),
        api.getPayrollRuns()
      ]);
      setYtdData(ytd);
      setRuns(runsData);
      
      // Auto-select the first run if available
      if (runsData.length > 0) {
        handleSelectRun(runsData[0].id);
      }
    } catch (error) {
      console.error('Error loading reports data:', error);
      triggerToast('Failed to load compliance report summaries.', 'error');
    } finally {
      setLoading(false);
    }
  }

  const handleSelectRun = async (runId: number) => {
    setSelectedRunId(runId);
    try {
      setDetailsLoading(true);
      const details = await api.getPayrollRunDetails(runId);
      setRunDetails(details);
    } catch (error) {
      console.error('Error fetching payroll run details:', error);
      triggerToast('Failed to load payroll run employee listing.', 'error');
    } finally {
      setDetailsLoading(false);
    }
  };

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
    <div className="flex flex-col gap-6">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-bold text-on-surface mb-1">Reports &amp; Compliance</h1>
        <p className="text-sm text-on-surface-variant">Compile Ontario remittances, export T4s, and audit past pay cycles.</p>
      </div>

      {/* Remittances Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* CRA Card */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-primary"></div>
          <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary">account_balance</span>
            CRA Remittance Due
          </h3>
          <p className="text-2xl font-black text-on-surface">
            {ytdData ? formatCurrency(ytdData.craRemittance) : '$0.00'}
          </p>
          <div className="text-[10px] text-on-surface-variant leading-relaxed mt-2">
            <p>• Employee CPP Deduct + Employer Match (1:1)</p>
            <p>• Employee EI Deduct + Employer Match (1.4:1)</p>
            <p>• Federal &amp; Provincial Income Withholdings</p>
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant flex justify-between items-center">
            <span className="text-[10px] text-on-surface-variant font-bold">FREQUENCY: MONTHLY</span>
            <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">ON TIME</span>
          </div>
        </div>

        {/* WSIB Card */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-secondary"></div>
          <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary">medical_services</span>
            WSIB Premium Due
          </h3>
          <p className="text-2xl font-black text-on-surface">
            {ytdData ? formatCurrency(ytdData.totalWsib) : '$0.00'}
          </p>
          <p className="text-[10px] text-on-surface-variant leading-relaxed mt-2">
            Ontario workers safety board premium. Calculated based on configured class rate against gross insurable earnings (capped at $112,500 annually per employee).
          </p>
          <div className="mt-4 pt-4 border-t border-outline-variant flex justify-between items-center">
            <span className="text-[10px] text-on-surface-variant font-bold">FREQUENCY: QUARTERLY</span>
            <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">ON TIME</span>
          </div>
        </div>

        {/* EHT Card */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-tertiary"></div>
          <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-tertiary">analytics</span>
            EHT Premium Due
          </h3>
          <p className="text-2xl font-black text-on-surface">
            {ytdData ? formatCurrency(ytdData.totalEht) : '$0.00'}
          </p>
          <p className="text-[10px] text-on-surface-variant leading-relaxed mt-2">
            Employer Health Tax. Configured at 1.95% with private-sector exemption claimed on first $1,000,000 in Ontario payroll. Currently under exemption limit.
          </p>
          <div className="mt-4 pt-4 border-t border-outline-variant flex justify-between items-center">
            <span className="text-[10px] text-on-surface-variant font-bold">EXEMPTION STATUS</span>
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">EXEMPT CLAIMED</span>
          </div>
        </div>
      </div>

      {/* Compliance Center Actions */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-primary mb-2 border-b border-outline-variant pb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">file_download</span>
          Tax Forms Filing Center
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div>
            <h4 className="text-sm font-bold text-primary">CRA T4 XML Annual Return</h4>
            <p className="text-xs text-on-surface-variant leading-relaxed mt-1">
              Download the official T4 XML payload containing Box 14, 16, 18, 22, 50, and 52 ledger summaries for electronic submission to the Canada Revenue Agency.
            </p>
          </div>
          <div className="flex md:justify-end">
            <a 
              href={api.getT4ExportUrl()}
              download
              className="bg-primary hover:bg-opacity-95 text-on-primary font-bold py-2.5 px-6 rounded-lg text-sm shadow-sm flex items-center gap-2 active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined">export_notes</span>
              Export T4 XML Submission
            </a>
          </div>
        </div>
      </section>

      {/* Past Runs Details and Pay Stubs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: list of runs */}
        <div className="lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px]">
          <div className="p-4 bg-surface-container-low border-b border-outline-variant">
            <h3 className="font-bold text-sm text-primary">Payroll Runs Archive</h3>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-outline-variant">
            {runs.map((run) => {
              const isSelected = selectedRunId === run.id;
              return (
                <button
                  key={run.id}
                  onClick={() => handleSelectRun(run.id)}
                  className={`
                    w-full p-4 flex flex-col gap-1 text-left transition-colors
                    ${isSelected ? 'bg-primary/5 border-l-4 border-primary' : 'hover:bg-surface-container-low/20'}
                  `}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-primary">ID: #{run.id} • {run.run_date}</span>
                    <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded uppercase">{run.status}</span>
                  </div>
                  <span className="text-xs text-on-surface-variant font-medium">Period: {run.period_start} to {run.period_end}</span>
                  <span className="text-sm font-bold text-on-surface mt-1">{formatCurrency(run.total_gross)} Gross</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: run detail table (employee stub downloads) */}
        <div className="lg:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px]">
          <div className="p-4 bg-surface-container-low border-b border-outline-variant flex justify-between items-center">
            <h3 className="font-bold text-sm text-primary">
              {runDetails ? `Run Details: Period ${runDetails.period_start} - ${runDetails.period_end}` : 'Payroll Run Detail'}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {detailsLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : runDetails ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4 text-right">Gross</th>
                    <th className="py-2.5 px-4 text-right">Deductions</th>
                    <th className="py-2.5 px-4 text-right">Net Paid</th>
                    <th className="py-2.5 px-4 text-right w-32">Stub</th>
                  </tr>
                </thead>
                <tbody>
                  {runDetails.employees.map((emp: any) => {
                    const totalDeductions = emp.cpp_employee + emp.ei_employee + emp.tax;
                    return (
                      <tr key={emp.employee_id} className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors text-xs font-semibold">
                        <td className="py-3 px-4 font-bold text-on-surface">{emp.first_name} {emp.last_name}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(emp.gross_pay)}</td>
                        <td className="py-3 px-4 text-right text-red-600">-${totalDeductions.toFixed(2)}</td>
                        <td className="py-3 px-4 text-right text-primary font-bold">{formatCurrency(emp.net_pay)}</td>
                        <td className="py-3 px-4 text-right">
                          <a 
                            href={api.getPaystubUrl(runDetails.id, emp.employee_id)}
                            download
                            className="inline-flex items-center gap-1.5 text-secondary hover:text-primary hover:underline"
                          >
                            <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                            PDF Stub
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-on-surface-variant font-medium h-full flex items-center justify-center">
                Select a payroll run from the archive to inspect details and download employee pay stubs.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportsView;

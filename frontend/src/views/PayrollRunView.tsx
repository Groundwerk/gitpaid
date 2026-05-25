import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { Employee } from '../types';

interface PayrollRunViewProps {
  onSuccess: () => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const PayrollRunView: React.FC<PayrollRunViewProps> = ({
  onSuccess,
  triggerToast
}) => {
  const [step, setStep] = useState(1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Pay period dates (defaulting to current bi-weekly approximation)
  const [periodStart, setPeriodStart] = useState('2026-05-11');
  const [periodEnd, setPeriodEnd] = useState('2026-05-24');
  const [paymentMethod, setPaymentMethod] = useState('e-Transfer');

  // Selected employees and inputs: key is employee_id
  const [selectedEmps, setSelectedEmps] = useState<Record<number, boolean>>({});
  const [hoursWorked, setHoursWorked] = useState<Record<number, string>>({});
  const [commission, setCommission] = useState<Record<number, string>>({});
  const [vacationPayout, setVacationPayout] = useState<Record<number, string>>({});

  // Calculation Results
  const [previewData, setPreviewData] = useState<any>(null);

  useEffect(() => {
    async function loadEmployees() {
      try {
        setLoading(true);
        const data = await api.getEmployees();
        const active = data.filter(e => e.status !== 'terminated');
        setEmployees(active);

        // Pre-select all active employees
        const selectedMap: Record<number, boolean> = {};
        const hoursMap: Record<number, string> = {};
        const commissionMap: Record<number, string> = {};
        const vacMap: Record<number, string> = {};
        
        active.forEach(e => {
          selectedMap[e.id] = e.status === 'active'; // On leave is unselected by default
          hoursMap[e.id] = '80'; // Default 80 hours bi-weekly
          commissionMap[e.id] = '0';
          vacMap[e.id] = '0';
        });

        setSelectedEmps(selectedMap);
        setHoursWorked(hoursMap);
        setCommission(commissionMap);
        setVacationPayout(vacMap);
      } catch (error) {
        console.error('Error fetching employees for payrun:', error);
        triggerToast('Failed to load employee configuration.', 'error');
      } finally {
        setLoading(false);
      }
    }
    loadEmployees();
  }, []);

  const handleSelectToggle = (id: number) => {
    setSelectedEmps(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleInputChange = (id: number, field: 'hours' | 'commission' | 'vacation', value: string) => {
    if (field === 'hours') setHoursWorked(prev => ({ ...prev, [id]: value }));
    if (field === 'commission') setCommission(prev => ({ ...prev, [id]: value }));
    if (field === 'vacation') setVacationPayout(prev => ({ ...prev, [id]: value }));
  };

  const handleCalculatePreview = async () => {
    // Construct inputs
    const inputs = employees
      .filter(e => selectedEmps[e.id])
      .map(e => ({
        employee_id: e.id,
        hours_worked: e.pay_type === 'hourly' ? parseFloat(hoursWorked[e.id]) || 0 : 0,
        additional_commission: e.pay_type === 'salary_commission' ? parseFloat(commission[e.id]) || 0 : 0,
        vacation_payout_amount: parseFloat(vacationPayout[e.id]) || 0
      }));

    if (inputs.length === 0) {
      triggerToast('Please select at least one employee to run payroll.', 'error');
      return;
    }

    try {
      setLoading(true);
      const data = await api.calculatePayrollPreview(inputs);
      setPreviewData(data);
      setStep(2);
    } catch (error: any) {
      console.error('Error calculating payroll preview:', error);
      triggerToast(error.message || 'Failed to preview calculations.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitPayroll = async () => {
    const inputs = employees
      .filter(e => selectedEmps[e.id])
      .map(e => ({
        employee_id: e.id,
        hours_worked: e.pay_type === 'hourly' ? parseFloat(hoursWorked[e.id]) || 0 : 0,
        additional_commission: e.pay_type === 'salary_commission' ? parseFloat(commission[e.id]) || 0 : 0,
        vacation_payout_amount: parseFloat(vacationPayout[e.id]) || 0
      }));

    try {
      setSubmitting(true);
      await api.submitPayrollRun({
        period_start: periodStart,
        period_end: periodEnd,
        payment_method: paymentMethod,
        employeesInput: inputs
      });
      triggerToast('Payroll run finalized & paid successfully!', 'success');
      onSuccess();
    } catch (error: any) {
      console.error('Error submitting payroll:', error);
      triggerToast(error.message || 'Failed to persist payroll run.', 'error');
    } finally {
      setSubmitting(false);
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
        <h1 className="text-3xl font-bold text-on-surface mb-1">Run Payroll</h1>
        <p className="text-sm text-on-surface-variant">Step-by-step wizard to process current period calculations.</p>
      </div>

      {/* Stepper Indicators */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-center max-w-3xl mx-auto">
          {[1, 2, 3, 4].map((num) => {
            const label = num === 1 ? 'Prepare' : num === 2 ? 'Calculate' : num === 3 ? 'Pay Method' : 'Confirm';
            const isActive = step === num;
            const isCompleted = step > num;

            return (
              <React.Fragment key={num}>
                <div className="flex flex-col items-center gap-1.5 flex-1 relative">
                  <div className={`
                    w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shadow-sm transition-all duration-200
                    ${isActive ? 'bg-primary text-on-primary scale-110 ring-4 ring-primary-container' : ''}
                    ${isCompleted ? 'bg-green-600 text-on-primary' : ''}
                    ${!isActive && !isCompleted ? 'bg-surface-container-high text-on-surface-variant' : ''}
                  `}>
                    {isCompleted ? (
                      <span className="material-symbols-outlined text-[18px]">check</span>
                    ) : (
                      num
                    )}
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-primary' : 'text-on-surface-variant'}`}>
                    {label}
                  </span>
                </div>
                {num < 4 && <div className={`h-0.5 flex-1 mx-2 ${step > num ? 'bg-green-600' : 'bg-outline-variant'}`} />}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* STEP 1: PREPARE */}
      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Panel */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-primary mb-4 border-b border-outline-variant pb-2">Select Active Employees</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-outline-variant text-[11px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container-low">
                      <th className="py-2.5 px-4 w-12 text-center">Include</th>
                      <th className="py-2.5 px-4">Employee</th>
                      <th className="py-2.5 px-4">Pay Config</th>
                      <th className="py-2.5 px-4 w-32">Hours / Commission</th>
                      <th className="py-2.5 px-4 w-32">Vacation Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => {
                      const isSelected = selectedEmps[emp.id] || false;
                      return (
                        <tr key={emp.id} className={`border-b border-outline-variant hover:bg-surface-container-low/30 transition-colors ${!isSelected ? 'opacity-60' : ''}`}>
                          <td className="py-3 px-4 text-center">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => handleSelectToggle(emp.id)}
                              className="rounded border-outline-variant text-primary focus:ring-primary h-4.5 w-4.5 cursor-pointer"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-sm font-semibold text-on-surface">{emp.first_name} {emp.last_name}</p>
                            <p className="text-[10px] text-on-surface-variant font-medium">{emp.role} • {emp.department}</p>
                          </td>
                          <td className="py-3 px-4 text-xs font-semibold text-on-surface">
                            {emp.pay_type === 'hourly' && `$${emp.rate.toFixed(2)}/hr`}
                            {emp.pay_type === 'salary' && `$${emp.rate.toFixed(2)}/period`}
                            {emp.pay_type === 'salary_commission' && `$${emp.rate.toFixed(2)} + Comm.`}
                          </td>
                          <td className="py-3 px-4">
                            {emp.pay_type === 'hourly' && isSelected && (
                              <div className="flex items-center gap-1.5">
                                <input 
                                  type="number" 
                                  value={hoursWorked[emp.id] || ''}
                                  onChange={(e) => handleInputChange(emp.id, 'hours', e.target.value)}
                                  className="w-16 h-8 text-xs font-semibold border border-outline-variant rounded px-2 text-center"
                                />
                                <span className="text-[10px] text-on-surface-variant font-medium">hrs</span>
                              </div>
                            )}
                            {emp.pay_type === 'salary_commission' && isSelected && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-on-surface-variant font-medium">$</span>
                                <input 
                                  type="number" 
                                  value={commission[emp.id] || ''}
                                  onChange={(e) => handleInputChange(emp.id, 'commission', e.target.value)}
                                  className="w-20 h-8 text-xs font-semibold border border-outline-variant rounded px-2"
                                  placeholder="Commission"
                                />
                              </div>
                            )}
                            {emp.pay_type === 'salary' && <span className="text-xs text-on-surface-variant font-medium">Fixed period salary</span>}
                          </td>
                          <td className="py-3 px-4">
                            {isSelected && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-on-surface-variant font-medium">$</span>
                                <input 
                                  type="number" 
                                  value={vacationPayout[emp.id] || ''}
                                  onChange={(e) => handleInputChange(emp.id, 'vacation', e.target.value)}
                                  className="w-20 h-8 text-xs font-semibold border border-outline-variant rounded px-2"
                                  placeholder="Payout"
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Sidebar dates config */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-primary mb-4 border-b border-outline-variant pb-2">Pay Period Info</h3>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Start Date</label>
                  <input 
                    type="date" 
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">End Date</label>
                  <input 
                    type="date" 
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full"
                  />
                </div>
                <div className="mt-4 pt-4 border-t border-outline-variant flex flex-col gap-2">
                  <button 
                    onClick={handleCalculatePreview}
                    className="w-full bg-primary text-on-primary font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 hover:bg-opacity-95 shadow-sm"
                  >
                    Calculate Preview
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* STEP 2: REVIEW CALCULATIONS */}
      {step === 2 && previewData && (
        <div className="flex flex-col gap-6">
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm overflow-hidden">
            <h3 className="text-base font-bold text-primary mb-4 border-b border-outline-variant pb-2">Review Deduction Sheet</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container-low">
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4 text-right">Gross Earnings</th>
                    <th className="py-2.5 px-4 text-right">CPP (Employee)</th>
                    <th className="py-2.5 px-4 text-right">EI (Employee)</th>
                    <th className="py-2.5 px-4 text-right">Income Tax</th>
                    <th className="py-2.5 px-4 text-right">Vac. Accrued</th>
                    <th className="py-2.5 px-4 text-right font-bold text-primary">Net Pay</th>
                    <th className="py-2.5 px-4 text-right">Employer CPP</th>
                    <th className="py-2.5 px-4 text-right">Employer EI</th>
                    <th className="py-2.5 px-4 text-right">WSIB Premium</th>
                    <th className="py-2.5 px-4 text-right">EHT Premium</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.employees.map((emp: any) => (
                    <tr key={emp.employee_id} className="border-b border-outline-variant hover:bg-surface-container-low/30 transition-colors text-xs font-semibold">
                      <td className="py-3 px-4 font-bold text-on-surface">{emp.first_name} {emp.last_name}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(emp.gross_pay)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant">${emp.cpp_employee.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant">${emp.ei_employee.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant">${emp.tax.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant text-[10px]">${emp.vacation_accrued.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-sm font-bold text-primary">{formatCurrency(emp.net_pay)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant/80">${emp.cpp_employer.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant/80">${emp.ei_employer.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant/80">${emp.wsib_premium.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant/80">${emp.eht_premium.toFixed(2)}</td>
                    </tr>
                  ))}
                  {/* Totals Row */}
                  <tr className="bg-primary/5 text-xs font-bold text-primary border-t-2 border-primary/20">
                    <td className="py-3 px-4">TOTALS</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(previewData.totals.totalGross)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalCppEmployee.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalEiEmployee.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalTax.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalVacationAccrued.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right text-sm font-black">{formatCurrency(previewData.totals.totalNet)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalCppEmployer.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalEiEmployer.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalWsib.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">${previewData.totals.totalEht.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Stepper controls */}
          <div className="flex justify-between items-center bg-surface-container-lowest border border-outline-variant p-4 rounded-xl shadow-sm">
            <button 
              onClick={() => setStep(1)}
              className="px-5 py-2 border border-outline-variant text-sm font-semibold rounded-lg hover:bg-surface-container-low transition-colors"
            >
              Back to Preparation
            </button>
            <button 
              onClick={() => setStep(3)}
              className="px-5 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:bg-opacity-95 transition-all shadow-sm"
            >
              Proceed to Payment
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: PAYMENT METHOD */}
      {step === 3 && previewData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 flex flex-col gap-6">
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-primary mb-6 border-b border-outline-variant pb-2">Select Payment Method</h3>
              <div className="flex flex-col gap-4">
                {[
                  { id: 'e-Transfer', title: 'INTERAC e-Transfer', desc: 'Secure, instant digital fund routing directly to employee emails.' },
                  { id: 'Cheque', title: 'Physical Cheque', desc: 'Print physical cheques locally for manual distribution.' },
                  { id: 'Cash', title: 'Cash Outlay', desc: 'Manual cash payouts. Ideal for immediate local labor compliance.' }
                ].map((item) => (
                  <label 
                    key={item.id}
                    className={`
                      flex items-start gap-4 p-4 border rounded-xl cursor-pointer transition-all duration-150
                      ${paymentMethod === item.id 
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20' 
                        : 'border-outline-variant hover:bg-surface-container-low/35'
                      }
                    `}
                  >
                    <input 
                      type="radio" 
                      name="payment_method" 
                      value={item.id}
                      checked={paymentMethod === item.id}
                      onChange={() => setPaymentMethod(item.id)}
                      className="sr-only"
                    />
                    <div className={`
                      w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                      ${paymentMethod === item.id ? 'border-primary' : 'border-outline'}
                    `}>
                      {paymentMethod === item.id && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-primary">{item.title}</h4>
                      <p className="text-xs text-on-surface-variant leading-relaxed mt-0.5">{item.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </section>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-6">
            <section className="bg-surface-container-low border border-primary-container/20 rounded-xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-primary-container mb-4">Summary of Liabilities</h3>
              <div className="flex flex-col gap-3 font-semibold text-xs text-on-surface-variant">
                <div className="flex justify-between">
                  <span>Net Payout (Cash Outlay):</span>
                  <span className="text-on-surface">{formatCurrency(previewData.totals.totalNet)}</span>
                </div>
                <div className="flex justify-between">
                  <span>CRA Deductions Remittance:</span>
                  <span className="text-on-surface">
                    {formatCurrency((previewData.totals.totalCppEmployee * 2) + (previewData.totals.totalEiEmployee * 2.4) + previewData.totals.totalTax)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>WSIB Premium:</span>
                  <span className="text-on-surface">{formatCurrency(previewData.totals.totalWsib)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Employer Health Tax (EHT):</span>
                  <span className="text-on-surface">{formatCurrency(previewData.totals.totalEht)}</span>
                </div>
                <hr className="border-outline-variant/60 my-2" />
                <div className="flex justify-between text-sm font-black text-primary">
                  <span>Total Liability for Run:</span>
                  <span>
                    {formatCurrency(
                      previewData.totals.totalGross + 
                      previewData.totals.totalCppEmployer + 
                      previewData.totals.totalEiEmployer + 
                      previewData.totals.totalWsib + 
                      previewData.totals.totalEht
                    )}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <div className="col-span-1 lg:col-span-12 flex justify-between items-center bg-surface-container-lowest border border-outline-variant p-4 rounded-xl shadow-sm">
            <button 
              onClick={() => setStep(2)}
              className="px-5 py-2 border border-outline-variant text-sm font-semibold rounded-lg hover:bg-surface-container-low transition-colors"
            >
              Back to Deductions
            </button>
            <button 
              onClick={() => setStep(4)}
              className="px-5 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:bg-opacity-95 transition-all shadow-sm"
            >
              Review and Confirm
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: CONFIRM & SUBMIT */}
      {step === 4 && previewData && (
        <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-md relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-green-600"></div>
            
            <h3 className="text-lg font-bold text-primary text-center mb-6">Confirm and Authorize Payroll</h3>
            
            <div className="space-y-4 mb-8">
              <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant flex justify-between items-center">
                <div>
                  <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Payroll Run Period</h4>
                  <p className="text-sm font-bold text-primary mt-1">{periodStart} to {periodEnd}</p>
                </div>
                <div className="text-right">
                  <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Payment Method</h4>
                  <p className="text-sm font-bold text-primary mt-1">{paymentMethod}</p>
                </div>
              </div>

              <div className="border border-outline-variant rounded-lg divide-y divide-outline-variant">
                <div className="p-4 flex justify-between items-center text-xs font-semibold text-on-surface-variant">
                  <span>Employees Included:</span>
                  <span className="text-on-surface font-bold">{previewData.employees.length}</span>
                </div>
                <div className="p-4 flex justify-between items-center text-xs font-semibold text-on-surface-variant">
                  <span>Gross Pay Total:</span>
                  <span className="text-on-surface font-bold">{formatCurrency(previewData.totals.totalGross)}</span>
                </div>
                <div className="p-4 flex justify-between items-center text-xs font-semibold text-on-surface-variant">
                  <span>Employee Withholdings:</span>
                  <span className="text-on-surface font-bold">
                    {formatCurrency(previewData.totals.totalGross - previewData.totals.totalNet)}
                  </span>
                </div>
                <div className="p-4 bg-green-50/50 flex justify-between items-center text-sm font-bold text-primary">
                  <span>Net Payout Amount:</span>
                  <span className="text-lg font-black">{formatCurrency(previewData.totals.totalNet)}</span>
                </div>
              </div>
            </div>

            <button 
              onClick={handleSubmitPayroll}
              disabled={submitting}
              className="w-full bg-green-600 hover:bg-green-700 text-on-primary font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md disabled:opacity-50"
            >
              <span className="material-symbols-outlined">verified</span>
              {submitting ? 'Processing Submission...' : 'Authorize & Disburse Funds'}
            </button>
          </section>

          <div className="flex justify-start">
            <button 
              onClick={() => setStep(3)}
              disabled={submitting}
              className="px-5 py-2 border border-outline-variant text-sm font-semibold rounded-lg bg-surface-container-lowest hover:bg-surface-container-low transition-colors disabled:opacity-50"
            >
              Back to Payment Method
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollRunView;

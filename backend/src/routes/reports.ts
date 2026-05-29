import { Hono } from 'hono';
import { jsPDF } from 'jspdf';
import { decryptText } from '../utils/crypto';
import { calculateProgressiveTax, federalBrackets, ontarioBrackets, getPeriodsPerYear } from '../services/taxEngine';


const router = new Hono<{
  Bindings: {
    DB: D1Database;
    GMAIL_REFRESH_TOKEN?: string;
    GMAIL_ACCESS_TOKEN?: string;
    GMAIL_CLIENT_ID?: string;
    GMAIL_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    JWT_SECRET: string;
  };
}>();

// Helper to get companyId from request
function getCompanyId(c: any): number {
  const payload = c.get('jwtPayload');
  return payload?.companyId;
}

// 1. YTD Totals Summary
router.get('/ytd', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const summary = await c.env.DB.prepare(`
      SELECT 
        SUM(ytd_gross) as totalGross,
        SUM(ytd_net) as totalNet,
        SUM(ytd_cpp) as totalCpp,
        SUM(ytd_cpp_employer) as totalCppEmployer,
        SUM(ytd_ei) as totalEi,
        SUM(ytd_ei_employer) as totalEiEmployer,
        SUM(ytd_tax) as totalTax,
        SUM(ytd_wsib) as totalWsib,
        SUM(ytd_eht) as totalEht
      FROM employees
      WHERE company_id = ?
    `).bind(companyId).first() as any;

    const finalizedRuns = await c.env.DB.prepare(`
      SELECT pr.id, pr.run_date,
             SUM(pre.cpp_employee + pre.cpp_employer + pre.ei_employee + pre.ei_employer + pre.tax) as craRemittance,
             SUM(pre.wsib_premium) as wsibPremium,
             SUM(pre.eht_premium) as ehtPremium
      FROM payroll_runs pr
      JOIN payroll_run_employees pre ON pr.id = pre.run_id
      WHERE pr.company_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
      GROUP BY pr.id
    `).bind(companyId).all() as any;

    const settings = await c.env.DB.prepare('SELECT eht_exempt, gmail_refresh_token, gmail_email FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;

    const gross = summary?.totalGross || 0;
    const net = summary?.totalNet || 0;
    const cpp = summary?.totalCpp || 0;
    const cppEmployer = summary?.totalCppEmployer || 0;
    const ei = summary?.totalEi || 0;
    const eiEmployer = summary?.totalEiEmployer || 0;
    const tax = summary?.totalTax || 0;
    const wsib = summary?.totalWsib || 0;
    const eht = summary?.totalEht || 0;

    const craRemittanceYTD = cpp + cppEmployer + ei + eiEmployer + tax;
    const ehtExempt = settings?.eht_exempt === 1;


    // Determine due dates, active status, and compliance states
    const todayStr = new Date().toISOString().split('T')[0];

    const getCraActiveDate = (runDateStr: string) => {
      const [year, month, day] = runDateStr.split('-').map(Number);
      let nextMonth = month + 1;
      let nextYear = year;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear += 1;
      }
      const monthStr = String(nextMonth).padStart(2, '0');
      return `${nextYear}-${monthStr}-01`;
    };

    const getCraDueDate = (runDateStr: string) => {
      const [year, month, day] = runDateStr.split('-').map(Number);
      let nextMonth = month + 1;
      let nextYear = year;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear += 1;
      }
      const monthStr = String(nextMonth).padStart(2, '0');
      return `${nextYear}-${monthStr}-15`;
    };

    const getWsibActiveDate = (runDateStr: string) => {
      const [year, month, day] = runDateStr.split('-').map(Number);
      let nextQuarterMonth = 4;
      let nextYear = year;
      if (month >= 1 && month <= 3) {
        nextQuarterMonth = 4;
      } else if (month >= 4 && month <= 6) {
        nextQuarterMonth = 7;
      } else if (month >= 7 && month <= 9) {
        nextQuarterMonth = 10;
      } else {
        nextQuarterMonth = 1;
        nextYear += 1;
      }
      const monthStr = String(nextQuarterMonth).padStart(2, '0');
      return `${nextYear}-${monthStr}-01`;
    };

    const getWsibDueDate = (runDateStr: string) => {
      const [year, month, day] = runDateStr.split('-').map(Number);
      let dueMonth = 4;
      let dueYear = year;
      if (month >= 1 && month <= 3) {
        dueMonth = 4;
      } else if (month >= 4 && month <= 6) {
        dueMonth = 7;
      } else if (month >= 7 && month <= 9) {
        dueMonth = 10;
      } else {
        dueMonth = 1;
        dueYear += 1;
      }
      const lastDay = dueMonth === 4 ? '30' : '31';
      const monthStr = String(dueMonth).padStart(2, '0');
      return `${dueYear}-${monthStr}-${lastDay}`;
    };

    const getMonthEndStr = (dateStr: string) => {
      const [year, month, day] = dateStr.split('-').map(Number);
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const monthStr = String(month).padStart(2, '0');
      return `${year}-${monthStr}-${lastDay}`;
    };

    const getQuarterEndStr = (dateStr: string) => {
      const [year, month, day] = dateStr.split('-').map(Number);
      if (month >= 1 && month <= 3) return `${year}-03-31`;
      if (month >= 4 && month <= 6) return `${year}-06-30`;
      if (month >= 7 && month <= 9) return `${year}-09-30`;
      return `${year}-12-31`;
    };

    const paymentsMap: Record<string, Record<string, number>> = {
      CRA: {},
      WSIB: {},
      EHT: {}
    };
    const paymentsList = await c.env.DB.prepare(`
      SELECT type, period_end, SUM(amount) as paid 
      FROM remittance_payments 
      WHERE company_id = ? 
      GROUP BY type, period_end
    `).bind(companyId).all() as any;

    if (paymentsList.results) {
      for (const p of paymentsList.results) {
        paymentsMap[p.type] = paymentsMap[p.type] || {};
        paymentsMap[p.type][p.period_end] = p.paid || 0;
      }
    }

    const craPeriods: Record<string, { liability: number; activeDate: string; dueDate: string }> = {};
    const wsibPeriods: Record<string, { liability: number; activeDate: string; dueDate: string }> = {};
    const ehtPeriods: Record<string, { liability: number; activeDate: string; dueDate: string }> = {};

    if (finalizedRuns.results) {
      for (const run of finalizedRuns.results) {
        const runDate = run.run_date;

        if (run.craRemittance > 0) {
          const periodEnd = getMonthEndStr(runDate);
          if (!craPeriods[periodEnd]) {
            craPeriods[periodEnd] = {
              liability: 0,
              activeDate: getCraActiveDate(runDate),
              dueDate: getCraDueDate(runDate)
            };
          }
          craPeriods[periodEnd].liability += run.craRemittance;
        }

        if (run.wsibPremium > 0) {
          const periodEnd = getQuarterEndStr(runDate);
          if (!wsibPeriods[periodEnd]) {
            wsibPeriods[periodEnd] = {
              liability: 0,
              activeDate: getWsibActiveDate(runDate),
              dueDate: getWsibDueDate(runDate)
            };
          }
          wsibPeriods[periodEnd].liability += run.wsibPremium;
        }

        if (run.ehtPremium > 0 && !ehtExempt) {
          const periodEnd = getMonthEndStr(runDate);
          if (!ehtPeriods[periodEnd]) {
            ehtPeriods[periodEnd] = {
              liability: 0,
              activeDate: getCraActiveDate(runDate),
              dueDate: getCraDueDate(runDate)
            };
          }
          ehtPeriods[periodEnd].liability += run.ehtPremium;
        }
      }
    }

    let craRemittanceDue = 0;
    let craRemittanceUpcoming = 0;
    let craStatus = 'ON TIME';
    let craDueDate: string | null = null;
    let earliestCraOverdue: string | null = null;
    let earliestCraUpcoming: string | null = null;

    for (const [periodEnd, data] of Object.entries(craPeriods)) {
      const paid = paymentsMap['CRA'][periodEnd] || 0;
      const outstanding = Math.max(0, data.liability - paid);
      if (outstanding > 0) {
        if (todayStr >= data.activeDate) {
          craRemittanceDue += outstanding;
          if (todayStr > data.dueDate) {
            craStatus = 'OVERDUE';
            if (!earliestCraOverdue || data.dueDate < earliestCraOverdue) {
              earliestCraOverdue = data.dueDate;
            }
          } else {
            const diffTime = new Date(data.dueDate).getTime() - new Date(todayStr).getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 7 && craStatus !== 'OVERDUE') {
              craStatus = 'DUE SOON';
            } else if (craStatus !== 'OVERDUE' && craStatus !== 'DUE SOON') {
              craStatus = 'DUE';
            }
            if (!earliestCraUpcoming || data.dueDate < earliestCraUpcoming) {
              earliestCraUpcoming = data.dueDate;
            }
          }
        } else {
          craRemittanceUpcoming += outstanding;
        }
      }
    }
    craDueDate = earliestCraOverdue || earliestCraUpcoming;

    let wsibDue = 0;
    let wsibUpcoming = 0;
    let wsibStatus = 'ON TIME';
    let wsibDueDate: string | null = null;
    let earliestWsibOverdue: string | null = null;
    let earliestWsibUpcoming: string | null = null;

    for (const [periodEnd, data] of Object.entries(wsibPeriods)) {
      const paid = paymentsMap['WSIB'][periodEnd] || 0;
      const outstanding = Math.max(0, data.liability - paid);
      if (outstanding > 0) {
        if (todayStr >= data.activeDate) {
          wsibDue += outstanding;
          if (todayStr > data.dueDate) {
            wsibStatus = 'OVERDUE';
            if (!earliestWsibOverdue || data.dueDate < earliestWsibOverdue) {
              earliestWsibOverdue = data.dueDate;
            }
          } else {
            const diffTime = new Date(data.dueDate).getTime() - new Date(todayStr).getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 10 && wsibStatus !== 'OVERDUE') {
              wsibStatus = 'DUE SOON';
            } else if (wsibStatus !== 'OVERDUE' && wsibStatus !== 'DUE SOON') {
              wsibStatus = 'DUE';
            }
            if (!earliestWsibUpcoming || data.dueDate < earliestWsibUpcoming) {
              earliestWsibUpcoming = data.dueDate;
            }
          }
        } else {
          wsibUpcoming += outstanding;
        }
      }
    }
    wsibDueDate = earliestWsibOverdue || earliestWsibUpcoming;

    let ehtDue = 0;
    let ehtUpcoming = 0;
    let ehtStatus = 'ON TIME';
    let ehtDueDate: string | null = null;
    let earliestEhtOverdue: string | null = null;
    let earliestEhtUpcoming: string | null = null;

    for (const [periodEnd, data] of Object.entries(ehtPeriods)) {
      const paid = paymentsMap['EHT'][periodEnd] || 0;
      const outstanding = Math.max(0, data.liability - paid);
      if (outstanding > 0) {
        if (todayStr >= data.activeDate) {
          ehtDue += outstanding;
          if (todayStr > data.dueDate) {
            ehtStatus = 'OVERDUE';
            if (!earliestEhtOverdue || data.dueDate < earliestEhtOverdue) {
              earliestEhtOverdue = data.dueDate;
            }
          } else {
            const diffTime = new Date(data.dueDate).getTime() - new Date(todayStr).getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 7 && ehtStatus !== 'OVERDUE') {
              ehtStatus = 'DUE SOON';
            } else if (ehtStatus !== 'OVERDUE' && ehtStatus !== 'DUE SOON') {
              ehtStatus = 'DUE';
            }
            if (!earliestEhtUpcoming || data.dueDate < earliestEhtUpcoming) {
              earliestEhtUpcoming = data.dueDate;
            }
          }
        } else {
          ehtUpcoming += outstanding;
        }
      }
    }
    ehtDueDate = earliestEhtOverdue || earliestEhtUpcoming;

    return c.json({
      totalGross: Math.round(gross * 100) / 100,
      totalNet: Math.round(net * 100) / 100,
      totalCpp: Math.round(cpp * 100) / 100,
      totalEi: Math.round(ei * 100) / 100,
      totalTax: Math.round(tax * 100) / 100,
      totalWsib: Math.round(wsib * 100) / 100,
      totalEht: Math.round(eht * 100) / 100,
      craRemittance: Math.round(craRemittanceDue * 100) / 100,
      craRemittanceYTD: Math.round(craRemittanceYTD * 100) / 100,
      craRemittanceUpcoming: Math.round(craRemittanceUpcoming * 100) / 100,
      wsibDue: Math.round(wsibDue * 100) / 100,
      wsibUpcoming: Math.round(wsibUpcoming * 100) / 100,
      ehtDue: Math.round(ehtDue * 100) / 100,
      ehtUpcoming: Math.round(ehtUpcoming * 100) / 100,
      ehtExempt,
      craDueDate,
      craStatus,
      wsibDueDate,
      wsibStatus,
      ehtDueDate,
      ehtStatus,
      gmailConnected: !!settings?.gmail_refresh_token,
      gmailEmail: settings?.gmail_email || null
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Helper to encode Uint8Array to base64 safely without call stack limit errors
function uint8ArrayToBase64(arr: Uint8Array): string {
  let binString = '';
  const len = arr.byteLength;
  for (let i = 0; i < len; i++) {
    binString += String.fromCharCode(arr[i]);
  }
  return btoa(binString);
}

// Shared helper to generate paystub PDF with dynamic label overrides
export function generatePaystubPdf(settings: any, emp: any, payrollInfo: any): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const primaryColor = settings?.use_company_branding && settings?.brand_color ? settings.brand_color : '#001e40';
  const secondaryColor = settings?.use_company_branding && settings?.brand_color ? settings.brand_color : '#0059bb';

  // --- Header ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(primaryColor);
  doc.text(settings.legal_name, 50, 60);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#43474f');
  doc.text(`CRA BN: ${settings.business_number}`, 50, 80);
  doc.text(`${settings.address_line1 || ''}, ${settings.city || ''}, ${settings.postal_code || ''}`, 50, 94);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(secondaryColor);
  doc.text('STATEMENT OF EARNINGS & DEDUCTIONS', 306, 130, { align: 'center' });

  // Meta Grid
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#0b1c30');
  
  // Left column
  doc.text(`Employee: ${emp.first_name} ${emp.last_name}`, 50, 170);
  doc.text(`Role: ${emp.role || ''}`, 50, 185);
  doc.text(`Department: ${emp.department || ''}`, 50, 200);

  // Right column
  doc.text(`Pay Date: ${payrollInfo.run_date}`, 350, 170);
  doc.text(`Pay Period: ${payrollInfo.period_start} to ${payrollInfo.period_end}`, 350, 185);
  doc.text(`Payment Method: ${payrollInfo.payment_method}`, 350, 200);

  const tableTop = 230;

  // --- Table Headers ---
  doc.setFillColor('#e5eeff');
  doc.rect(50, tableTop, 512, 20, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(primaryColor);
  doc.text('DESCRIPTION', 60, tableTop + 14);
  doc.text('CURRENT RATE', 200, tableTop + 14);
  doc.text('CURRENT AMOUNT', 320, tableTop + 14);
  doc.text('YTD AMOUNT', 440, tableTop + 14);

  let rowY = tableTop + 20;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#0b1c30');
  doc.setDrawColor('#c3c6d1');

  const addRow = (desc: string, rate: string, current: number, ytd: number) => {
    doc.rect(50, rowY, 512, 20, 'S');
    doc.text(desc, 60, rowY + 14);
    doc.text(rate, 200, rowY + 14);
    doc.text(`$${current.toFixed(2)}`, 320, rowY + 14);
    doc.text(`$${ytd.toFixed(2)}`, 440, rowY + 14);
    rowY += 20;
  };

  const hourlyRateStr = emp.pay_type === 'hourly' ? `$${emp.rate.toFixed(2)}/hr` : 'Salary';
  addRow('Gross Earnings', hourlyRateStr, payrollInfo.gross_pay, emp.ytd_gross);
  addRow('CPP Deduction', '5.95%', payrollInfo.cpp_employee, emp.ytd_cpp);
  addRow('EI Deduction', '1.66%', payrollInfo.ei_employee, emp.ytd_ei);
  addRow('Income Tax', 'Calculated', payrollInfo.tax, emp.ytd_tax);
  addRow('Vacation Accrued', `${settings.vacation_rate}%`, payrollInfo.vacation_accrued, emp.ytd_vacation_accrued);
  addRow('Vacation Paid Out', '-', payrollInfo.vacation_paid, emp.ytd_vacation_paid);

  // --- Net Pay Block ---
  rowY += 15;
  doc.setFillColor('#dce9ff');
  doc.rect(50, rowY, 512, 40, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(primaryColor);
  doc.text('NET PAY DEPOSITED', 60, rowY + 24);
  doc.setFontSize(16);
  doc.text(`$${payrollInfo.net_pay.toFixed(2)}`, 540, rowY + 26, { align: 'right' });

  // --- Employer Contributions Info (Bottom) ---
  rowY += 75;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor('#737780');
  doc.text('Employer Contributions (For Reference / Compliance Reporting Only)', 50, rowY);
  
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#43474f');
  rowY += 16;
  doc.text(`Employer CPP Match (1:1): $${payrollInfo.cpp_employer.toFixed(2)}`, 50, rowY);
  rowY += 14;

  const eiMultiplier = settings.override_ei_employer_rate !== null && settings.override_ei_employer_rate !== undefined 
    ? settings.override_ei_employer_rate 
    : 1.4;
  doc.text(`Employer EI Match (${eiMultiplier}x): $${payrollInfo.ei_employer.toFixed(2)}`, 50, rowY);
  rowY += 14;

  const wsibRateUsed = emp.wcb_rate > 0 ? emp.wcb_rate : settings.wsib_rate;
  doc.text(`WSIB Premium (${wsibRateUsed}%): $${payrollInfo.wsib_premium.toFixed(2)}`, 50, rowY);
  rowY += 14;

  doc.text(`Employer Health Tax (EHT): $${payrollInfo.eht_premium.toFixed(2)}`, 50, rowY);

  return new Uint8Array(doc.output('arraybuffer'));
}

// 2. Pay stub PDF Generation
router.get('/paystub/:runId/:employeeId', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const { runId, employeeId } = c.req.param();

    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    // Get company settings
    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;
    
    // Get payroll run employee details
    const payrollInfo = await c.env.DB.prepare(
      `SELECT pre.*, pr.run_date, pr.period_start, pr.period_end, COALESCE(pre.payment_method, pr.payment_method) as payment_method
       FROM payroll_run_employees pre
       JOIN payroll_runs pr ON pre.run_id = pr.id
       WHERE pre.run_id = ? AND pre.employee_id = ? AND pr.company_id = ?`
    ).bind(runId, employeeId, companyId).first() as any;

    if (!payrollInfo) {
      return c.json({ error: 'Payroll details not found' }, 404);
    }

    // Get employee details
    const emp = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(employeeId, companyId)
      .first() as any;

    if (!emp) {
      return c.json({ error: 'Employee not found' }, 404);
    }

    const pdfBytes = generatePaystubPdf(settings, emp, payrollInfo);

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=paystub-${employeeId}-${runId}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 2.5 Email Paystubs using Gmail REST API (with dynamic auth refresh or mock fallback)
router.post('/email-stubs', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { runId, employeeIds } = await c.req.json() as { runId: number; employeeIds: number[] };

    if (!runId || !employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return c.json({ error: 'Missing runId or employeeIds' }, 400);
    }

    // 1. Fetch company settings
    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;

    if (!settings) {
      return c.json({ error: 'Company settings not found' }, 404);
    }

    // 2. Fetch the payroll run to check its status
    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(runId, companyId)
      .first() as any;

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    const results = [];
    
    let gmailRefreshToken = '';
    if (settings.gmail_refresh_token) {
      try {
        gmailRefreshToken = await decryptText(settings.gmail_refresh_token, c.env.JWT_SECRET);
      } catch (err) {
        console.error('[EMAIL STUBS] Failed to decrypt database GMAIL_REFRESH_TOKEN:', err);
      }
    }
    if (!gmailRefreshToken) {
      gmailRefreshToken = c.env.GMAIL_REFRESH_TOKEN || '';
    }

    const isGmailConfigured = !!(gmailRefreshToken || c.env.GMAIL_ACCESS_TOKEN);

    // Get a Gmail Access Token if credentials are set
    let gmailAccessToken = '';
    if (isGmailConfigured) {
      if (c.env.GMAIL_ACCESS_TOKEN) {
        gmailAccessToken = c.env.GMAIL_ACCESS_TOKEN;
      } else {
        const clientIdUsed = c.env.GMAIL_CLIENT_ID || c.env.GOOGLE_CLIENT_ID || '';
        const clientSecretUsed = c.env.GMAIL_CLIENT_SECRET || '';
        
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientIdUsed,
            client_secret: clientSecretUsed,
            refresh_token: gmailRefreshToken,
            grant_type: 'refresh_token'
          })
        });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json() as any;
          gmailAccessToken = tokenData.access_token;
        } else {
          const errText = await tokenRes.text();
          console.error('[EMAIL STUBS] Failed to exchange Google OAuth refresh token for access token. Status:', tokenRes.status, 'Response:', errText);
          return c.json({ error: `Gmail integration credentials expired or invalid: ${errText}` }, 401);
        }
      }
    }

    for (const employeeId of employeeIds) {
      // Get employee details
      const emp = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
        .bind(employeeId, companyId)
        .first() as any;

      if (!emp) {
        results.push({ employeeId, success: false, error: 'Employee not found' });
        continue;
      }

      // Get payroll info for employee in this run
      const payrollInfo = await c.env.DB.prepare(
        `SELECT pre.*, pr.run_date, pr.period_start, pr.period_end, COALESCE(pre.payment_method, pr.payment_method) as payment_method
         FROM payroll_run_employees pre
         JOIN payroll_runs pr ON pre.run_id = pr.id
         WHERE pre.run_id = ? AND pre.employee_id = ? AND pr.company_id = ?`
      ).bind(runId, employeeId, companyId).first() as any;

      if (!payrollInfo) {
        results.push({ employeeId, success: false, error: 'Payroll information not found for this run' });
        continue;
      }

      if (payrollInfo.status === 'draft') {
        results.push({ employeeId, success: false, error: 'Cannot email a draft pay stub. Pay run/payment must be finalized first.' });
        continue;
      }

      // Generate the PDF stub
      const pdfBytes = generatePaystubPdf(settings, emp, payrollInfo);
      const filename = `paystub_${emp.first_name}_${emp.last_name}_run_${runId}.pdf`;

      const subject = `Pay Stub for Period ${payrollInfo.period_start} - ${payrollInfo.period_end}`;
      const emailBody = `Hello ${emp.first_name} ${emp.last_name},\n\nPlease find your paystub for the period ${payrollInfo.period_start} - ${payrollInfo.period_end} attached.\n\nSincerely,\n${settings.legal_name}`;

      if (isGmailConfigured && gmailAccessToken) {
        try {
          // Construct raw MIME email
          const base64Attachment = uint8ArrayToBase64(pdfBytes);
          const boundary = 'foo_bar_baz_boundary';
          const rfc2822Message = [
            `To: ${emp.email}`,
            `Subject: ${subject}`,
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            `MIME-Version: 1.0`,
            '',
            `--${boundary}`,
            `Content-Type: text/plain; charset="UTF-8"`,
            `Content-Transfer-Encoding: 7bit`,
            '',
            emailBody,
            '',
            `--${boundary}`,
            `Content-Type: application/pdf; name="${filename}"`,
            `Content-Disposition: attachment; filename="${filename}"`,
            `Content-Transfer-Encoding: base64`,
            '',
            base64Attachment,
            '',
            `--${boundary}--`
          ].join('\r\n');

          const rawEncoded = btoa(rfc2822Message)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

          // Send via Google Gmail API
          const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${gmailAccessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              raw: rawEncoded
            })
          });

          if (sendRes.ok) {
            results.push({ employeeId, success: true, method: 'gmail' });
          } else {
            const sendStatus = sendRes.status;
            const sendResText = await sendRes.text();
            console.error(`[EMAIL STUBS] Google Gmail API Send failed. Status: ${sendStatus}, Response: ${sendResText}`);
            throw new Error(`Gmail API returned error status ${sendStatus}: ${sendResText}`);
          }
        } catch (err: any) {
          console.error('[EMAIL STUBS] Error in Gmail API loop:', err);
          results.push({ employeeId, success: false, error: err.message });
          // Break the loop immediately on critical Google API send failure
          break;
        }
      } else {
        // Mock Send Mode: Log to console
        console.log(`[MOCK EMAIL SEND]
To: ${emp.email}
Subject: ${subject}
Attachment: ${filename} (Size: ${pdfBytes.length} bytes)
Body:
${emailBody}`);

        results.push({ employeeId, success: true, method: 'mock_logged' });
      }

      // Slow roll: wait 1 second before processing the next employee
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return c.json({
      message: isGmailConfigured ? 'Emails processed' : 'Emails processed (Mock mode: credentials not configured)',
      mocked: !isGmailConfigured,
      results
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 3. T4 XML Generation
router.get('/t4/export', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    // Get company settings
    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;

    const { results: employees } = await c.env.DB.prepare('SELECT * FROM employees WHERE company_id = ?')
      .bind(companyId)
      .all();

    // Helper to escape XML special characters
    const escapeXml = (unsafe: string) => {
      return (unsafe || '').replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });
    };

    let xmlString = `<?xml version="1.0" encoding="UTF-8"?>
<Submission xmlns="http://www.cra-arc.gc.ca/xmlns/sdt/2024" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <T4TaxesTransmitter>
    <TransmitterCompany>
      <CompanyName>${escapeXml(settings.legal_name)}</CompanyName>
      <BusinessNumber>${escapeXml(settings.business_number)}</BusinessNumber>
    </TransmitterCompany>
    <PayrollSettings>
      <WSIBNumber>${escapeXml(settings.wsib_number || '')}</WSIBNumber>
    </PayrollSettings>
  </T4TaxesTransmitter>
  <T4Slips>`;

    for (const emp of employees as any[]) {
      xmlString += `
    <T4Slip>
      <EmployeeName>
        <FirstName>${escapeXml(emp.first_name)}</FirstName>
        <LastName>${escapeXml(emp.last_name)}</LastName>
      </EmployeeName>
      <EmployeeEmail>${escapeXml(emp.email)}</EmployeeEmail>
      <Box12_SIN>${escapeXml((emp.sin || '000000000').replace(/[-\s]/g, ''))}</Box12_SIN>
      <Box14_GrossEarnings>${emp.ytd_gross.toFixed(2)}</Box14_GrossEarnings>
      <Box16_EmployeeCPP>${emp.ytd_cpp.toFixed(2)}</Box16_EmployeeCPP>
      <Box18_EmployeeEI>${emp.ytd_ei.toFixed(2)}</Box18_EmployeeEI>
      <Box22_IncomeTax>${emp.ytd_tax.toFixed(2)}</Box22_IncomeTax>
      <Box24_EIInsurableEarnings>${emp.ytd_gross.toFixed(2)}</Box24_EIInsurableEarnings>
      <Box26_CPPPensionableEarnings>${Math.min(emp.ytd_gross, 68500).toFixed(2)}</Box26_CPPPensionableEarnings>
      <Box50_WSIBEarnings>${emp.ytd_wsib.toFixed(2)}</Box50_WSIBEarnings>
      <Box52_EHTEarnings>${emp.ytd_eht.toFixed(2)}</Box52_EHTEarnings>
    </T4Slip>`;
    }

    xmlString += `
  </T4Slips>
</Submission>`;

    return new Response(xmlString, {
      headers: {
        'Content-Type': 'application/xml',
        'Content-Disposition': 'attachment; filename=T4-submission-2024.xml'
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/reports/remittances
router.get('/remittances', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { results } = await c.env.DB.prepare(`
      SELECT * FROM remittance_payments
      WHERE company_id = ?
      ORDER BY payment_date DESC, id DESC
    `).bind(companyId).all();

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/reports/remittances
router.post('/remittances', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { type, payment_date, amount, period_end } = await c.req.json();

    if (!type || !payment_date || amount === undefined || !period_end) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    if (!['CRA', 'WSIB', 'EHT'].includes(type)) {
      return c.json({ error: 'Invalid remittance type' }, 400);
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return c.json({ error: 'Amount must be a positive number' }, 400);
    }

    const result = await c.env.DB.prepare(`
      INSERT INTO remittance_payments (company_id, type, payment_date, amount, period_end)
      VALUES (?, ?, ?, ?, ?)
    `).bind(companyId, type, payment_date, numericAmount, period_end).run();

    const id = result.meta.last_row_id;

    return c.json({ id, message: 'Remittance payment logged successfully' }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// DELETE /api/reports/remittances/:id
router.delete('/remittances/:id', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');

    const result = await c.env.DB.prepare(`
      DELETE FROM remittance_payments
      WHERE id = ? AND company_id = ?
    `).bind(id, companyId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Remittance payment not found or unauthorized' }, 404);
    }

    return c.json({ message: 'Remittance payment deleted successfully' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ==========================================
// NEW REPORTING HELPER FUNCTIONS & ROUTERS
// ==========================================

function formatReportCurrency(val: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(val);
}

function drawReportFooter(doc: jsPDF, userEmail: string, currentPage: number = 1, totalPages: number = 1, generatedBy: string = 'Gitpaid Payroll', brandColor: string | null = null) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  
  const footerLineColor = brandColor || '#0059bb';
  
  // Thin line above footer with Gitpaid secondary accent
  doc.setDrawColor(footerLineColor);
  doc.setLineWidth(0.75);
  doc.line(50, pageHeight - 60, pageWidth - 50, pageHeight - 60);
  
  // Footer text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor('#43474f');
  doc.text('Created on:', 50, pageHeight - 45);
  doc.text('User account:', 50, pageHeight - 32);
  
  doc.setFont('helvetica', 'normal');
  const now = new Date();
  const formatNum = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${formatNum(now.getMonth() + 1)}/${formatNum(now.getDate())}/${now.getFullYear()} ${formatNum(now.getHours())}:${formatNum(now.getMinutes())}:${formatNum(now.getSeconds())}`;
  
  doc.text(dateStr, 110, pageHeight - 45);
  doc.text(userEmail, 110, pageHeight - 32);
  
  doc.text(`Generated by ${generatedBy}`, pageWidth - 50, pageHeight - 45, { align: 'right' });
  doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth - 50, pageHeight - 32, { align: 'right' });
}

function drawReportHeader(doc: jsPDF, title: string, companyName: string, metadata: { label: string; value: string }[], brandColor: string | null = null) {
  const primaryColor = brandColor || '#001e40';
  const secondaryColor = brandColor || '#0059bb';

  // Title (Gitpaid Primary Navy)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(primaryColor);
  doc.text(title, 50, 50);
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(primaryColor);
  doc.text('Company:', 50, 75);
  
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#43474f');
  doc.text(companyName, 110, 75);
  
  let y = 90;
  let rightY = 75;
  for (const item of metadata) {
    const isRightAligned = 
      item.label.toLowerCase().includes('date') || 
      item.label.toLowerCase().includes('period') ||
      item.label.toLowerCase().includes('group') ||
      item.label.toLowerCase().includes('selection');
      
    if (isRightAligned) {
      const xLabel = doc.internal.pageSize.getWidth() - 320;
      const xValue = xLabel + 110;
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor);
      doc.text(item.label, xLabel, rightY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor('#43474f');
      doc.text(item.value, xValue, rightY);
      rightY += 15;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor);
      doc.text(item.label, 50, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor('#43474f');
      doc.text(item.value, 110, y);
      y += 15;
    }
  }
  
  // Draw horizontal divider line below headers with Gitpaid custom double-accent styling
  doc.setDrawColor(primaryColor); // Gitpaid Primary Navy
  doc.setLineWidth(2.0);
  doc.line(50, 115, doc.internal.pageSize.getWidth() - 50, 115);
  
  doc.setDrawColor(secondaryColor); // Gitpaid Secondary Blue
  doc.setLineWidth(1.0);
  doc.line(50, 118, doc.internal.pageSize.getWidth() - 50, 118);
}

// Progressive tax splitter helper
function splitTaxForEmployee(gross: number, savedTax: number, payPeriod: string, emp: any): { fed: number; prov: number } {
  if (emp.tax_exempt === 1 || savedTax <= 0) {
    return { fed: 0, prov: 0 };
  }
  
  const periodsPerYear = getPeriodsPerYear(payPeriod || 'bi-weekly');
  const annualizedGross = gross * periodsPerYear;
  
  const fedCredit = emp.override_fed_tax_credit === 1 ? (emp.fed_tax_credit_amount ?? 15705) : 15705;
  const provCredit = emp.override_prov_tax_credit === 1 ? (emp.prov_tax_credit_amount ?? 12399) : 12399;
  
  const fedTaxable = Math.max(0, annualizedGross - fedCredit);
  const provTaxable = Math.max(0, annualizedGross - provCredit);
  
  const fedTaxAnnual = calculateProgressiveTax(fedTaxable, federalBrackets);
  const provTaxAnnual = calculateProgressiveTax(provTaxable, ontarioBrackets);
  
  const totalTaxAnnual = fedTaxAnnual + provTaxAnnual;
  if (totalTaxAnnual <= 0) {
    return {
      fed: Math.round(savedTax * 0.6 * 100) / 100,
      prov: Math.round(savedTax * 0.4 * 100) / 100
    };
  }
  
  const fedRatio = fedTaxAnnual / totalTaxAnnual;
  const fedTax = Math.round(savedTax * fedRatio * 100) / 100;
  const provTax = Math.round((savedTax - fedTax) * 100) / 100;
  
  return { fed: fedTax, prov: provTax };
}

interface YTDAccumulator {
  gross: number;
  net: number;
  cpp: number;
  cppEmployer: number;
  ei: number;
  eiEmployer: number;
  tax: number;
  wsib: number;
  eht: number;
  vacationAccrued: number;
  vacationPaid: number;
}

// Helper to calculate YTD as of a specific run (date and ID order)
async function getHistoricalYTD(db: D1Database, companyId: number, targetRunDate: string, targetRunId: number): Promise<Record<number, YTDAccumulator>> {
  const employees = await db.prepare('SELECT id, ytd_gross, ytd_net, ytd_cpp, ytd_cpp_employer, ytd_ei, ytd_ei_employer, ytd_tax, ytd_wsib, ytd_eht, ytd_vacation_accrued, ytd_vacation_paid FROM employees WHERE company_id = ?').bind(companyId).all() as any;
  
  const ytdMap: Record<number, YTDAccumulator> = {};
  for (const emp of employees.results) {
    ytdMap[emp.id] = {
      gross: emp.ytd_gross || 0,
      net: emp.ytd_net || 0,
      cpp: emp.ytd_cpp || 0,
      cppEmployer: emp.ytd_cpp_employer || 0,
      ei: emp.ytd_ei || 0,
      eiEmployer: emp.ytd_ei_employer || 0,
      tax: emp.ytd_tax || 0,
      wsib: emp.ytd_wsib || 0,
      eht: emp.ytd_eht || 0,
      vacationAccrued: emp.ytd_vacation_accrued || 0,
      vacationPaid: emp.ytd_vacation_paid || 0
    };
  }
  
  // Find all runs strictly after targetRun (chronologically)
  const subsequentPayments = await db.prepare(`
    SELECT pre.* 
    FROM payroll_run_employees pre
    JOIN payroll_runs pr ON pre.run_id = pr.id
    WHERE pr.company_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
      AND (pr.run_date > ? OR (pr.run_date = ? AND pr.id > ?))
  `).bind(companyId, targetRunDate, targetRunDate, targetRunId).all() as any;
  
  if (subsequentPayments.results) {
    for (const p of subsequentPayments.results) {
      if (ytdMap[p.employee_id]) {
        ytdMap[p.employee_id].gross -= p.gross_pay || 0;
        ytdMap[p.employee_id].net -= p.net_pay || 0;
        ytdMap[p.employee_id].cpp -= p.cpp_employee || 0;
        ytdMap[p.employee_id].cppEmployer -= p.cpp_employer || 0;
        ytdMap[p.employee_id].ei -= p.ei_employee || 0;
        ytdMap[p.employee_id].eiEmployer -= p.ei_employer || 0;
        ytdMap[p.employee_id].tax -= p.tax || 0;
        ytdMap[p.employee_id].wsib -= p.wsib_premium || 0;
        ytdMap[p.employee_id].eht -= p.eht_premium || 0;
        ytdMap[p.employee_id].vacationAccrued -= p.vacation_accrued || 0;
        ytdMap[p.employee_id].vacationPaid -= p.vacation_paid || 0;
      }
    }
  }
  
  return ytdMap;
}

// 4. Net Pay Detail Report (per pay run)
router.get('/net-pay', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const runId = c.req.query('run_id');
    const paymentMethodsParam = c.req.query('payment_methods');
    const format = c.req.query('format');

    if (!runId) return c.json({ error: 'Missing run_id parameter' }, 400);

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    const run = await c.env.DB.prepare(`
      SELECT pr.*, cs.legal_name, pg.name as pay_group_name
      FROM payroll_runs pr
      JOIN company_settings cs ON pr.company_id = cs.id
      LEFT JOIN pay_groups pg ON pr.pay_group_id = pg.id
      WHERE pr.id = ? AND pr.company_id = ?
    `).bind(runId, companyId).first() as any;

    if (!run) return c.json({ error: 'Payroll run not found' }, 404);

    const employeesData = await c.env.DB.prepare(`
      SELECT pre.*, emp.first_name, emp.last_name, emp.sin, emp.role, emp.department
      FROM payroll_run_employees pre
      JOIN employees emp ON pre.employee_id = emp.id
      WHERE pre.run_id = ?
    `).bind(runId).all() as any;

    let employees = employeesData.results || [];
    
    // Filter by payment methods if specified
    if (paymentMethodsParam) {
      const allowedMethods = paymentMethodsParam.split(',').map(m => m.trim().toLowerCase());
      employees = employees.filter((emp: any) => 
        allowedMethods.includes((emp.payment_method || 'e-transfer').toLowerCase())
      );
    }

    // Group employees by payment method
    const grouped: Record<string, any[]> = {};
    for (const emp of employees) {
      const method = emp.payment_method || 'e-Transfer';
      if (!grouped[method]) grouped[method] = [];
      grouped[method].push(emp);
    }

    // Sort names within groups
    for (const method of Object.keys(grouped)) {
      grouped[method].sort((a, b) => {
        const nameA = `${a.last_name}, ${a.first_name}`.toLowerCase();
        const nameB = `${b.last_name}, ${b.first_name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }

    const groupsList = Object.entries(grouped).map(([method, list]) => {
      const total = list.reduce((sum, e) => sum + e.net_pay, 0);
      return {
        paymentMethod: method,
        employees: list.map(e => ({
          id: e.employee_id,
          name: `${e.last_name}, ${e.first_name}`,
          code: '', // left blank per spec
          netPay: e.net_pay
        })),
        employeeCount: list.length,
        totalNetPay: Math.round(total * 100) / 100
      };
    });

    const grandTotal = employees.reduce((sum: number, e: any) => sum + e.net_pay, 0);
    const reportData = {
      companyName: run.legal_name,
      payGroup: run.pay_group_name || 'Ad-hoc Run',
      periodStart: run.period_start,
      periodEnd: run.period_end,
      groups: groupsList,
      grandTotal: Math.round(grandTotal * 100) / 100
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    // Generate PDF
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Pay group:', value: reportData.payGroup },
      { label: 'Pay run date:', value: `${reportData.periodStart} - ${reportData.periodEnd}` }
    ];
    drawReportHeader(doc, 'Net pay detail report', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Table column coordinates
    const nameX = 50;
    const codeX = 280;
    const netPayX = pageWidth - 50;

    // Print headers
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor('#43474f');
    doc.text('Employee name', nameX, y);
    doc.text('Employee code', codeX, y);
    doc.text('Net pay', netPayX, y, { align: 'right' });
    
    y += 10;
    doc.setDrawColor('#c3c6d1');
    doc.setLineWidth(0.5);
    doc.line(50, y, pageWidth - 50, y);
    y += 18;

    if (reportData.groups.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.text('No matching employee payments found for this pay run.', 50, y);
    } else {
      for (const group of reportData.groups) {
        // Check page overflow before drawing group header
        if (y > pageHeight - 100) {
          doc.addPage();
          drawReportHeader(doc, 'Net pay detail report', reportData.companyName, metadata, brandColor);
          y = 135;
          doc.setFont('helvetica', 'bold');
          doc.text('Employee name', nameX, y);
          doc.text('Employee code', codeX, y);
          doc.text('Net pay', netPayX, y, { align: 'right' });
          y += 10;
          doc.line(50, y, pageWidth - 50, y);
          y += 18;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor('#0b1c30');
        doc.text(`Payment type: ${group.paymentMethod}`, nameX, y);
        y += 15;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor('#0b1c30');

        for (const emp of group.employees) {
          // Check page overflow
          if (y > pageHeight - 100) {
            doc.addPage();
            drawReportHeader(doc, 'Net pay detail report', reportData.companyName, metadata, brandColor);
            y = 135;
            doc.setFont('helvetica', 'bold');
            doc.text('Employee name', nameX, y);
            doc.text('Employee code', codeX, y);
            doc.text('Net pay', netPayX, y, { align: 'right' });
            y += 10;
            doc.line(50, y, pageWidth - 50, y);
            y += 18;
            doc.setFont('helvetica', 'bold');
            doc.text(`Payment type: ${group.paymentMethod} (continued)`, nameX, y);
            y += 15;
            doc.setFont('helvetica', 'normal');
          }

          doc.text(emp.name, nameX, y);
          doc.text(emp.code, codeX, y);
          doc.text(formatReportCurrency(emp.netPay), netPayX, y, { align: 'right' });
          y += 15;
        }

        // Subtotal row
        if (y > pageHeight - 100) {
          doc.addPage();
          drawReportHeader(doc, 'Net pay detail report', reportData.companyName, metadata, brandColor);
          y = 135;
        }
        y += 5;
        doc.line(50, y, pageWidth - 50, y);
        y += 12;
        doc.setFont('helvetica', 'bold');
        doc.text(`${group.paymentMethod} total`, nameX, y);
        doc.text(`Employee count: ${group.employeeCount}`, codeX, y);
        doc.text(formatReportCurrency(group.totalNetPay), netPayX, y, { align: 'right' });
        y += 20;
      }

      // Grand total row
      if (y > pageHeight - 100) {
        doc.addPage();
        drawReportHeader(doc, 'Net pay detail report', reportData.companyName, metadata, brandColor);
        y = 135;
      }
      y += 5;
      doc.setLineWidth(1);
      doc.line(50, y, pageWidth - 50, y);
      y += 12;
      doc.setFont('helvetica', 'bold');
      doc.text('Grand total', nameX, y);
      doc.text(formatReportCurrency(reportData.grandTotal), netPayX, y, { align: 'right' });
      y += 5;
      doc.line(50, y, pageWidth - 50, y);
      doc.line(50, y + 2, pageWidth - 50, y + 2); // double underline
    }

    // Add page footers dynamically
    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=net_pay_report_${runId}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 5. Pay Run Summary Report
router.get('/pay-run-summary', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const runId = c.req.query('run_id');
    const format = c.req.query('format');

    if (!runId) return c.json({ error: 'Missing run_id parameter' }, 400);

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    const run = await c.env.DB.prepare(`
      SELECT pr.*, cs.legal_name, cs.pay_period as company_pay_period, pg.name as pay_group_name
      FROM payroll_runs pr
      JOIN company_settings cs ON pr.company_id = cs.id
      LEFT JOIN pay_groups pg ON pr.pay_group_id = pg.id
      WHERE pr.id = ? AND pr.company_id = ?
    `).bind(runId, companyId).first() as any;

    if (!run) return c.json({ error: 'Payroll run not found' }, 404);

    // Fetch employee calculations for this run
    const currentRunEmployees = await c.env.DB.prepare(`
      SELECT pre.*, emp.first_name, emp.last_name, emp.pay_type, emp.rate, emp.pay_interval, emp.tax_exempt,
             emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount,
             emp.override_prov_tax_credit, emp.prov_tax_credit_amount
      FROM payroll_run_employees pre
      JOIN employees emp ON pre.employee_id = emp.id
      WHERE pre.run_id = ?
    `).bind(runId).all() as any;

    const employees = currentRunEmployees.results || [];

    // Calculate YTD sums as of this run
    const ytdMap = await getHistoricalYTD(c.env.DB, companyId, run.run_date, run.id);

    // Totals accumulators
    let curSalary = 0, ytdSalary = 0;
    let curHourly = 0, ytdHourly = 0;
    let curComm = 0, ytdComm = 0;
    let curVacPaid = 0, ytdVacPaid = 0;

    let curCpp = 0, ytdCpp = 0;
    let curFedTax = 0, ytdFedTax = 0;
    let curProvTax = 0, ytdProvTax = 0;
    
    let curCppEmployer = 0, ytdCppEmployer = 0;
    let curEiEmployer = 0, ytdEiEmployer = 0;
    let curWsib = 0, ytdWsib = 0;
    let curEht = 0, ytdEht = 0;

    let totalHours = 0;

    for (const re of employees) {
      const ytd = ytdMap[re.employee_id] || {
        gross: 0, net: 0, cpp: 0, cppEmployer: 0, ei: 0, eiEmployer: 0, tax: 0, wsib: 0, eht: 0, vacationAccrued: 0, vacationPaid: 0
      };

      // Regular pay split (Salary vs Hourly vs Commission vs Vacation)
      const payPeriod = (re.pay_interval && re.pay_interval !== 'company') ? re.pay_interval : run.company_pay_period;
      const hours = re.hours_worked || 0;
      totalHours += hours;

      let curSalLine = 0;
      let curHourlyLine = 0;
      let curCommLine = 0;

      if (re.pay_type === 'hourly') {
        curHourlyLine = hours * re.rate;
      } else if (re.pay_type === 'salary_commission') {
        curSalLine = re.rate;
        curCommLine = re.additional_commission || 0;
      } else {
        curSalLine = re.rate;
      }

      curSalary += curSalLine;
      curHourly += curHourlyLine;
      curComm += curCommLine;
      curVacPaid += re.vacation_paid || 0;

      // Historical YTD classification based on pay_type
      let ytdSalLine = 0;
      let ytdHourlyLine = 0;
      let ytdVacPaidLine = ytd.vacationPaid;

      // Regular YTD Earnings = Gross - Vacation Paid
      const ytdRegular = Math.max(0, ytd.gross - ytdVacPaidLine);

      if (re.pay_type === 'hourly') {
        ytdHourlyLine = ytdRegular;
      } else {
        // For salary/commission, YTD regular goes to Salary line (including accumulated commissions)
        ytdSalLine = ytdRegular;
      }

      ytdSalary += ytdSalLine;
      ytdHourly += ytdHourlyLine;
      ytdVacPaid += ytdVacPaidLine;

      // Split income taxes dynamically into Federal and Provincial portions
      const curTaxSplit = splitTaxForEmployee(re.gross_pay, re.tax, payPeriod, re);
      curFedTax += curTaxSplit.fed;
      curProvTax += curTaxSplit.prov;

      // Split YTD tax
      const ytdTaxSplit = splitTaxForEmployee(ytd.gross, ytd.tax, payPeriod, re);
      ytdFedTax += ytdTaxSplit.fed;
      ytdProvTax += ytdTaxSplit.prov;

      // CPP
      curCpp += re.cpp_employee;
      ytdCpp += ytd.cpp;

      // Employer expenses
      curCppEmployer += re.cpp_employer;
      ytdCppEmployer += ytd.cppEmployer;

      curEiEmployer += re.ei_employer;
      ytdEiEmployer += ytd.eiEmployer;

      curWsib += re.wsib_premium;
      ytdWsib += ytd.wsib;

      curEht += re.eht_premium;
      ytdEht += ytd.eht;
    }

    const curEarningsTotal = curSalary + curHourly + curComm + curVacPaid;
    const ytdEarningsTotal = ytdSalary + ytdHourly + ytdComm + ytdVacPaid;

    const curTaxTotal = curCpp + curFedTax + curProvTax;
    const ytdTaxTotal = ytdCpp + ytdFedTax + ytdProvTax;

    const curOtherExpTotal = curCppEmployer + curEiEmployer + curWsib + curEht;
    const ytdOtherExpTotal = ytdCppEmployer + ytdEiEmployer + ytdWsib + ytdEht;

    const curNetPay = run.total_net;
    const ytdNetPay = Object.values(ytdMap).reduce((sum, e) => sum + e.net, 0);

    const curTotalSalaryCost = curEarningsTotal + curOtherExpTotal;
    const ytdTotalSalaryCost = ytdEarningsTotal + ytdOtherExpTotal;

    const reportData = {
      companyName: run.legal_name,
      payGroup: run.pay_group_name || 'Ad-hoc Run',
      periodStart: run.period_start,
      periodEnd: run.period_end,
      totalHours,
      earnings: {
        salary: { cur: curSalary, ytd: ytdSalary },
        hourly: { cur: curHourly, ytd: ytdHourly },
        commission: { cur: curComm, ytd: ytdComm },
        vacationPaid: { cur: curVacPaid, ytd: ytdVacPaid },
        total: { cur: curEarningsTotal, ytd: ytdEarningsTotal }
      },
      tax: {
        cppEmployee: { cur: curCpp, ytd: ytdCpp },
        fedTax: { cur: curFedTax, ytd: ytdFedTax },
        provTax: { cur: curProvTax, ytd: ytdProvTax },
        total: { cur: curTaxTotal, ytd: ytdTaxTotal }
      },
      otherExpenses: {
        cppEmployer: { cur: curCppEmployer, ytd: ytdCppEmployer },
        eiEmployer: { cur: curEiEmployer, ytd: ytdEiEmployer },
        wsib: { cur: curWsib, ytd: ytdWsib },
        eht: { cur: curEht, ytd: ytdEht },
        total: { cur: curOtherExpTotal, ytd: ytdOtherExpTotal }
      },
      totals: {
        netPay: { cur: curNetPay, ytd: ytdNetPay },
        salaryCost: { cur: curTotalSalaryCost, ytd: ytdTotalSalaryCost }
      }
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    // Generate PDF
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Pay group:', value: reportData.payGroup },
      { label: 'Pay run date:', value: `${reportData.periodStart} - ${reportData.periodEnd}` }
    ];
    drawReportHeader(doc, 'Pay run summary', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Table columns
    const compX = 50;
    const qtyX = 250;
    const curX = 410;
    const ytdX = pageWidth - 50;

    // Headers
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor('#43474f');
    doc.text('Components', compX, y);
    doc.text('Quantity/Hours', qtyX, y);
    doc.text('Current period', curX, y, { align: 'right' });
    doc.text('YTD + current period', ytdX, y, { align: 'right' });

    y += 10;
    doc.setDrawColor('#c3c6d1');
    doc.setLineWidth(0.5);
    doc.line(50, y, pageWidth - 50, y);
    y += 18;

    const printRow = (label: string, qty: string, cur: number, ytdValue: number, isSubtotal: boolean = false) => {
      if (y > pageHeight - 80) {
        doc.addPage();
        drawReportHeader(doc, 'Pay run summary', reportData.companyName, metadata, brandColor);
        y = 135;
        doc.setFont('helvetica', 'bold');
        doc.text('Components', compX, y);
        doc.text('Quantity/Hours', qtyX, y);
        doc.text('Current period', curX, y, { align: 'right' });
        doc.text('YTD + current period', ytdX, y, { align: 'right' });
        y += 10;
        doc.line(50, y, pageWidth - 50, y);
        y += 18;
      }

      if (isSubtotal) {
        y += 5;
        doc.setLineWidth(1);
        doc.line(50, y, pageWidth - 50, y);
        y += 12;
        doc.setFont('helvetica', 'bold');
      } else {
        doc.setFont('helvetica', 'normal');
      }

      doc.text(label, compX, y);
      doc.text(qty, qtyX, y);
      doc.text(formatReportCurrency(cur), curX, y, { align: 'right' });
      doc.text(formatReportCurrency(ytdValue), ytdX, y, { align: 'right' });
      y += 15;
    };

    const printSectionHeader = (label: string) => {
      if (y > pageHeight - 80) {
        doc.addPage();
        drawReportHeader(doc, 'Pay run summary', reportData.companyName, metadata, brandColor);
        y = 135;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor('#0b1c30');
      doc.text(label, compX, y);
      y += 15;
    };

    // 1. Earnings Section
    printSectionHeader('Earnings');
    if (reportData.earnings.salary.cur > 0 || reportData.earnings.salary.ytd > 0) {
      printRow('Salary', '', reportData.earnings.salary.cur, reportData.earnings.salary.ytd);
    }
    if (reportData.earnings.hourly.cur > 0 || reportData.earnings.hourly.ytd > 0) {
      printRow('Hourly Wages', reportData.totalHours > 0 ? reportData.totalHours.toFixed(2) : '', reportData.earnings.hourly.cur, reportData.earnings.hourly.ytd);
    }
    if (reportData.earnings.commission.cur > 0 || reportData.earnings.commission.ytd > 0) {
      printRow('Commission', '', reportData.earnings.commission.cur, reportData.earnings.commission.ytd);
    }
    if (reportData.earnings.vacationPaid.cur > 0 || reportData.earnings.vacationPaid.ytd > 0) {
      printRow('Vacation Paid Out', '', reportData.earnings.vacationPaid.cur, reportData.earnings.vacationPaid.ytd);
    }
    printRow('Total earnings', '', reportData.earnings.total.cur, reportData.earnings.total.ytd, true);
    y += 10;

    // 2. Tax Section
    printSectionHeader('Tax');
    printRow('CPP (employee contribution)', '', reportData.tax.cppEmployee.cur, reportData.tax.cppEmployee.ytd);
    printRow('Federal income tax', '', reportData.tax.fedTax.cur, reportData.tax.fedTax.ytd);
    printRow('Ontario component of FIT', '', reportData.tax.provTax.cur, reportData.tax.provTax.ytd);
    printRow('Total tax', '', reportData.tax.total.cur, reportData.tax.total.ytd, true);
    y += 10;

    // 3. Other Expenses Section
    printSectionHeader('Other expenses');
    printRow('CPP (employer contribution)', '', reportData.otherExpenses.cppEmployer.cur, reportData.otherExpenses.cppEmployer.ytd);
    printRow('EI (employer contribution)', '', reportData.otherExpenses.eiEmployer.cur, reportData.otherExpenses.eiEmployer.ytd);
    printRow('WSIB premium', '', reportData.otherExpenses.wsib.cur, reportData.otherExpenses.wsib.ytd);
    printRow('EHT premium', '', reportData.otherExpenses.eht.cur, reportData.otherExpenses.eht.ytd);
    printRow('Total other expenses', '', reportData.otherExpenses.total.cur, reportData.otherExpenses.total.ytd, true);
    y += 10;

    // 4. Other Totals Section
    printSectionHeader('Other totals');
    printRow('Net pay: To employee: earnings - deductions', '', reportData.totals.netPay.cur, reportData.totals.netPay.ytd);
    y += 10;
    
    // Total Salary Cost (double-underlined)
    y += 5;
    doc.setLineWidth(1.0);
    doc.line(50, y, pageWidth - 50, y);
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.text('Total salary cost', compX, y);
    doc.text('To company: total earnings + total benefits + total company contributions', compX, y + 12, { maxWidth: 200 });
    doc.text(formatReportCurrency(reportData.totals.salaryCost.cur), curX, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.totals.salaryCost.ytd), ytdX, y, { align: 'right' });
    
    y += 24;
    doc.setLineWidth(1.0);
    doc.line(50, y, pageWidth - 50, y);
    doc.line(50, y + 2, pageWidth - 50, y + 2); // double line

    // Add page footers dynamically
    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=pay_run_summary_${runId}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 6. Pay Statement Report (generates pay stub cheques)
router.get('/pay-statement', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const runId = c.req.query('run_id'); // run ID or 'all'
    const employeeId = c.req.query('employee_id'); // employee ID or 'all'
    const paymentMethodsParam = c.req.query('payment_methods');

    if (!runId || !employeeId) {
      return c.json({ error: 'Missing run_id or employee_id query parameters' }, 400);
    }

    // Determine the list of runs to process
    let runIds: number[] = [];
    if (runId === 'all') {
      const runs = await c.env.DB.prepare(`
        SELECT id FROM payroll_runs 
        WHERE company_id = ? AND status != 'draft'
        ORDER BY run_date ASC, id ASC
      `).bind(companyId).all() as any;
      runIds = (runs.results || []).map((r: any) => r.id);
    } else {
      runIds = [parseInt(runId)];
    }

    // Determine the list of employees to process
    let employeeIds: number[] = [];
    if (employeeId === 'all') {
      const employees = await c.env.DB.prepare(`
        SELECT id FROM employees 
        WHERE company_id = ?
      `).bind(companyId).all() as any;
      employeeIds = (employees.results || []).map((e: any) => e.id);
    } else {
      employeeIds = [parseInt(employeeId)];
    }

    // Get company settings
    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;

    if (!settings) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = settings.use_company_branding ? settings.brand_color : null;

    // Collect all statements
    const statements = [];

    for (const rid of runIds) {
      const run = await c.env.DB.prepare(`
        SELECT pr.*, pg.name as pay_group_name
        FROM payroll_runs pr
        LEFT JOIN pay_groups pg ON pr.pay_group_id = pg.id
        WHERE pr.id = ? AND pr.company_id = ?
      `).bind(rid, companyId).first() as any;

      if (!run) continue;

      const ytdMap = await getHistoricalYTD(c.env.DB, companyId, run.run_date, run.id);

      for (const eid of employeeIds) {
        const re = await c.env.DB.prepare(`
          SELECT pre.*, COALESCE(pre.payment_method, pr.payment_method) as method
          FROM payroll_run_employees pre
          JOIN payroll_runs pr ON pre.run_id = pr.id
          WHERE pre.run_id = ? AND pre.employee_id = ?
        `).bind(rid, eid).first() as any;

        if (!re) continue;

        // Apply payment method filtering if specified
        if (paymentMethodsParam) {
          const allowed = paymentMethodsParam.split(',').map(m => m.trim().toLowerCase());
          if (!allowed.includes(re.method.toLowerCase())) {
            continue;
          }
        }

        const emp = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
          .bind(eid, companyId)
          .first() as any;

        if (!emp) continue;

        const ytd = ytdMap[eid] || {
          gross: emp.ytd_gross, net: emp.ytd_net, cpp: emp.ytd_cpp, cppEmployer: emp.ytd_cpp_employer,
          ei: emp.ytd_ei, eiEmployer: emp.ytd_ei_employer, tax: emp.ytd_tax, wsib: emp.ytd_wsib, eht: emp.ytd_eht,
          vacationAccrued: emp.ytd_vacation_accrued, vacationPaid: emp.ytd_vacation_paid
        };

        const payPeriod = (emp.pay_interval && emp.pay_interval !== 'company') ? emp.pay_interval : settings.pay_period;
        const taxSplit = splitTaxForEmployee(re.gross_pay, re.tax, payPeriod, emp);
        const ytdTaxSplit = splitTaxForEmployee(ytd.gross, ytd.tax, payPeriod, emp);

        statements.push({
          run,
          emp,
          re,
          ytd,
          taxSplit,
          ytdTaxSplit
        });
      }
    }

    if (statements.length === 0) {
      return c.json({ error: 'No matching payroll statements found for the selected filters.' }, 404);
    }

    // Build jsPDF multi-page document
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    statements.forEach((st, idx) => {
      if (idx > 0) {
        doc.addPage();
      }

      // --- Header (Payment from) ---
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor('#43474f');
      doc.text('Payment from:', 50, 40);
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor('#0b1c30');
      doc.text(settings.legal_name, 50, 52);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(settings.address_line1 || '', 50, 64);
      doc.text(`${settings.city || ''} ${settings.province || 'ON'} ${settings.postal_code || ''}`, 50, 74);

      // Payment Details (Right column)
      doc.setFont('helvetica', 'normal');
      doc.text(st.re.method, 450, 40);
      doc.setFont('helvetica', 'bold');
      doc.text('DATE', 450, 52);
      doc.setFont('helvetica', 'normal');
      doc.text(st.run.run_date, 500, 52);

      // Non-negotiable Header text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('Non-negotiable -- This is not a cheque', pageWidth / 2, 110, { align: 'center' });

      // Payment to:
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Payment to:', 50, 140);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`${st.emp.first_name} ${st.emp.last_name}`, 50, 152);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(st.emp.email || '', 50, 164); // address fallback

      // Payment Amounts (Right)
      doc.text('Payment amount:', 400, 140);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`$**${st.re.net_pay.toFixed(2)}`, 490, 140);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Amount received:', 400, 170);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`$**${st.re.net_pay.toFixed(2)}`, 490, 170);

      // Acknowledgement line
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Acknowledgement of payment received', 250, 220);
      doc.setDrawColor(brandColor || '#0b1c30');
      doc.setLineWidth(1.0);
      doc.line(415, 220, 562, 220);

      // Details Metadata Box
      doc.setLineWidth(1.5);
      doc.rect(50, 240, 512, 55, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(settings.legal_name, 60, 253);
      doc.text('Payment method:', 370, 253);
      doc.setFont('helvetica', 'normal');
      doc.text(st.re.method, 445, 253);

      doc.setFont('helvetica', 'bold');
      doc.text('Employee name:', 60, 268);
      doc.setFont('helvetica', 'normal');
      doc.text(`${st.emp.first_name} ${st.emp.last_name}`, 140, 268);
      
      doc.setFont('helvetica', 'bold');
      doc.text('Pay date:', 370, 268);
      doc.setFont('helvetica', 'normal');
      doc.text(st.run.run_date, 445, 268);

      doc.setFont('helvetica', 'bold');
      doc.text('Employee ID:', 60, 283);
      doc.setFont('helvetica', 'normal');
      doc.text(st.emp.id.toString(), 140, 283);
      
      doc.setFont('helvetica', 'bold');
      doc.text('Pay period:', 370, 283);
      doc.setFont('helvetica', 'normal');
      doc.text(`${st.run.period_start} to ${st.run.period_end}`, 445, 283);

      // Tables side-by-side (y = 315)
      const tabY = 315;
      const leftColX = 50;
      const rightColX = pageWidth / 2 + 10;
      const colWidth = 240;

      // Draw Earnings Table Headers
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor('#43474f');
      doc.text('Earnings', leftColX, tabY);
      doc.text('Rate', leftColX + 90, tabY);
      doc.text('Hours', leftColX + 130, tabY);
      doc.text('This period', leftColX + 170, tabY);
      doc.text('Year to date', leftColX + 215, tabY);
      doc.line(leftColX, tabY + 4, leftColX + colWidth + 10, tabY + 4);

      // Earnings Table content
      doc.setFont('helvetica', 'normal');
      doc.setTextColor('#0b1c30');
      let ey = tabY + 16;
      
      const isHourly = st.emp.pay_type === 'hourly';
      const rateStr = isHourly ? st.emp.rate.toFixed(2) : '';
      const hoursStr = isHourly ? st.re.hours_worked.toFixed(2) : '';
      const grossRegular = isHourly ? (st.re.hours_worked * st.emp.rate) : st.emp.rate;

      doc.text(isHourly ? 'Hourly Wages' : 'Salary', leftColX, ey);
      doc.text(rateStr, leftColX + 90, ey);
      doc.text(hoursStr, leftColX + 130, ey);
      doc.text(grossRegular.toFixed(2), leftColX + 170, ey);
      doc.text((st.ytd.gross - st.ytd.vacationPaid).toFixed(2), leftColX + 215, ey);
      ey += 12;

      if (st.re.vacation_paid > 0 || st.ytd.vacationPaid > 0) {
        doc.text('Vacation Paid Out', leftColX, ey);
        doc.text('', leftColX + 90, ey);
        doc.text('', leftColX + 130, ey);
        doc.text(st.re.vacation_paid.toFixed(2), leftColX + 170, ey);
        doc.text(st.ytd.vacationPaid.toFixed(2), leftColX + 215, ey);
        ey += 12;
      }

      // Gross total
      ey += 4;
      doc.line(leftColX, ey, leftColX + colWidth + 10, ey);
      ey += 12;
      doc.setFont('helvetica', 'bold');
      doc.text('Gross earnings/hours', leftColX, ey);
      doc.text(hoursStr, leftColX + 130, ey);
      doc.text(st.re.gross_pay.toFixed(2), leftColX + 170, ey);
      doc.text(st.ytd.gross.toFixed(2), leftColX + 215, ey);
      doc.setFont('helvetica', 'normal');

      // Other Information block (y = 440)
      let oy = tabY + 120;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor('#43474f');
      doc.text('Other information', leftColX, oy);
      doc.line(leftColX, oy + 4, leftColX + colWidth + 10, oy + 4);
      
      doc.setFont('helvetica', 'normal');
      doc.setTextColor('#0b1c30');
      oy += 16;
      
      doc.text(`Vacation balance forward (${st.run.run_date.split('-')[0]})`, leftColX, oy);
      doc.text('0.00', leftColX + 215, oy);
      oy += 12;
      
      doc.text('Vacation earned', leftColX, oy);
      doc.text(st.re.vacation_accrued.toFixed(2), leftColX + 215, oy); // this period accrual
      oy += 12;
      
      doc.text('Vacation owed', leftColX, oy);
      doc.text(st.re.vacation_accrued.toFixed(2), leftColX + 215, oy);
      oy += 12;
      
      doc.text('EI insurable hours', leftColX, oy);
      doc.text(hoursStr || '0.00', leftColX + 130, oy);

      // --- Deductions Table (Right Side) ---
      doc.setFont('helvetica', 'bold');
      doc.setTextColor('#43474f');
      doc.text('Deduction', rightColX, tabY);
      doc.text('This period', rightColX + 130, tabY);
      doc.text('Year to date', rightColX + 190, tabY);
      doc.line(rightColX, tabY + 4, rightColX + colWidth, tabY + 4);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor('#0b1c30');
      let dy = tabY + 16;

      doc.setFont('helvetica', 'bold');
      doc.text('Statutory', rightColX, dy);
      doc.setFont('helvetica', 'normal');
      dy += 14;

      doc.text('CPP (employee contribution)', rightColX, dy);
      doc.text(st.re.cpp_employee.toFixed(2), rightColX + 130, dy);
      doc.text(st.ytd.cpp.toFixed(2), rightColX + 190, dy);
      dy += 12;

      doc.text('EI (employee contribution)', rightColX, dy);
      doc.text(st.re.ei_employee.toFixed(2), rightColX + 130, dy);
      doc.text(st.ytd.ei.toFixed(2), rightColX + 190, dy);
      dy += 12;

      doc.text('Income tax (Federal)', rightColX, dy);
      doc.text(st.taxSplit.fed.toFixed(2), rightColX + 130, dy);
      doc.text(st.ytdTaxSplit.fed.toFixed(2), rightColX + 190, dy);
      dy += 12;

      doc.text('Income tax (Ontario)', rightColX, dy);
      doc.text(st.taxSplit.prov.toFixed(2), rightColX + 130, dy);
      doc.text(st.ytdTaxSplit.prov.toFixed(2), rightColX + 190, dy);
      dy += 12;

      // Total deductions
      dy += 4;
      doc.line(rightColX, dy, rightColX + colWidth, dy);
      dy += 12;
      doc.setFont('helvetica', 'bold');
      doc.text('Total deductions', rightColX, dy);
      const curDed = st.re.cpp_employee + st.re.ei_employee + st.re.tax;
      const ytdDed = st.ytd.cpp + st.ytd.ei + st.ytd.tax;
      doc.text(curDed.toFixed(2), rightColX + 130, dy);
      doc.text(ytdDed.toFixed(2), rightColX + 190, dy);
      doc.setFont('helvetica', 'normal');

      // Deductions Summary Box (y = 440)
      let sy = tabY + 120;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor('#43474f');
      doc.text('Summary', rightColX, sy);
      doc.line(rightColX, sy + 4, rightColX + colWidth, sy + 4);
      
      doc.setFont('helvetica', 'normal');
      doc.setTextColor('#0b1c30');
      sy += 16;
      
      doc.text('Gross earnings', rightColX, sy);
      doc.text(st.re.gross_pay.toFixed(2), rightColX + 190, sy);
      sy += 12;
      
      doc.text('Deductions', rightColX, sy);
      doc.text(`-${curDed.toFixed(2)}`, rightColX + 190, sy);
      sy += 4;
      
      doc.line(rightColX, sy, rightColX + colWidth, sy);
      sy += 12;
      doc.setFont('helvetica', 'bold');
      doc.text('Net pay', rightColX, sy);
      doc.text(st.re.net_pay.toFixed(2), rightColX + 190, sy);
    });

    // Add page footers dynamically
    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, settings?.use_company_branding ? `${settings.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=pay_statement_${runId}_${employeeId}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 7. Remittance Report (quarterly/date range report)
router.get('/remittance-report', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const format = c.req.query('format');

    if (!startDate || !endDate) {
      return c.json({ error: 'Missing start_date or end_date query parameters' }, 400);
    }

    // Get company details
    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    // Query employee lines in finalized runs in this period
    const payments = await c.env.DB.prepare(`
      SELECT pre.*, emp.pay_interval, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount,
             emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount
      FROM payroll_run_employees pre
      JOIN payroll_runs pr ON pre.run_id = pr.id
      JOIN employees emp ON pre.employee_id = emp.id
      WHERE pr.company_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
        AND pr.run_date >= ? AND pr.run_date <= ?
    `).bind(companyId, startDate, endDate).all() as any;

    const list = payments.results || [];

    let totalCppEmployee = 0;
    let totalCppEmployer = 0;
    let totalEiEmployee = 0;
    let totalEiEmployer = 0;
    let totalFedTax = 0;
    let totalProvTax = 0;
    let totalGross = 0;
    let employeeIds = new Set<number>();

    let totalWsib = 0;
    let totalEht = 0;

    for (const re of list) {
      totalCppEmployee += re.cpp_employee;
      totalCppEmployer += re.cpp_employer;
      totalEiEmployee += re.ei_employee;
      totalEiEmployer += re.ei_employer;
      totalGross += re.gross_pay;
      employeeIds.add(re.employee_id);

      totalWsib += re.wsib_premium;
      totalEht += re.eht_premium;

      // split tax
      const split = splitTaxForEmployee(re.gross_pay, re.tax, re.pay_interval || cs.pay_period, re);
      totalFedTax += split.fed;
      totalProvTax += split.prov;
    }

    const federalPayable = totalCppEmployee + totalCppEmployer + totalEiEmployee + totalEiEmployer + totalFedTax;
    const reportData = {
      companyName: cs.legal_name,
      startDate,
      endDate,
      federal: {
        cpp: Math.round((totalCppEmployee + totalCppEmployer) * 100) / 100,
        ei: Math.round((totalEiEmployee + totalEiEmployer) * 100) / 100,
        fedTax: Math.round(totalFedTax * 100) / 100,
        amountPayable: Math.round(federalPayable * 100) / 100,
        grossPayroll: Math.round(totalGross * 100) / 100,
        employeeCount: employeeIds.size
      },
      provincialHealthTax: {
        name: 'EHT',
        ytdPayroll: Math.round(totalGross * 100) / 100,
        taxAmount: Math.round(totalEht * 100) / 100
      },
      provincialWorkersComp: {
        name: 'WSIB',
        assessableEarnings: Math.round(totalGross * 100) / 100, // assessable matches gross
        premium: Math.round(totalWsib * 100) / 100
      }
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    // Generate PDF
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Remittance period:', value: `${startDate} to ${endDate}` }
    ];
    drawReportHeader(doc, 'Remittance report', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();

    // Summary Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor('#0b1c30');
    doc.text('Summary (Federal & Quebec)', 50, y);
    y += 10;
    doc.setDrawColor('#0b1c30');
    doc.setLineWidth(1);
    doc.line(50, y, pageWidth - 50, y);
    y += 18;

    // Double Column Table (Federal vs Quebec)
    const midX = pageWidth / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Federal', 50, y);
    doc.text('Quebec', midX + 10, y);
    y += 8;
    doc.setDrawColor('#c3c6d1');
    doc.line(50, y, pageWidth - 50, y);
    y += 16;

    const printRemittanceRow = (labelLeft: string, valLeft: number | string, labelRight: string, valRight: number | string) => {
      doc.setFont('helvetica', 'normal');
      doc.text(labelLeft, 50, y);
      
      const leftValStr = typeof valLeft === 'number' ? formatReportCurrency(valLeft) : valLeft;
      doc.text(leftValStr, midX - 20, y, { align: 'right' });

      doc.text(labelRight, midX + 10, y);
      const rightValStr = typeof valRight === 'number' ? formatReportCurrency(valRight) : valRight;
      doc.text(rightValStr, pageWidth - 50, y, { align: 'right' });
      y += 14;
    };

    printRemittanceRow('CPP', reportData.federal.cpp, 'QPP (box B)', 0.0);
    printRemittanceRow('EI', reportData.federal.ei, 'QPIP (box D)', 0.0);
    printRemittanceRow('Federal income tax', reportData.federal.fedTax, 'Quebec income tax (box A)', 0.0);
    printRemittanceRow('', '', 'Health services fund (box C)', 0.0);
    printRemittanceRow('', '', 'CNESST/CSST (box F)', 0.0);
    
    // Amount payable
    y += 5;
    doc.setLineWidth(1.0);
    doc.line(50, y, midX - 20, y);
    doc.line(midX + 10, y, pageWidth - 50, y);
    y += 12;
    doc.setFont('helvetica', 'bold');
    printRemittanceRow('Amount payable', reportData.federal.amountPayable, 'Amount payable', 0.0);
    
    y += 8;
    doc.setFont('helvetica', 'normal');
    printRemittanceRow('Gross payroll', reportData.federal.grossPayroll, '', '');
    printRemittanceRow('No. of employees', reportData.federal.employeeCount.toString(), '', '');

    y += 15;

    // Provincial Health Tax Breakdown Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Provincial Health Tax Breakdown', 50, y);
    y += 10;
    doc.line(50, y, pageWidth - 50, y);
    y += 16;

    // Headers
    doc.setFontSize(8);
    doc.setTextColor('#43474f');
    doc.text('Province', 50, y);
    doc.text('Health Tax Name', 160, y);
    doc.text('YTD Payroll', 340, y, { align: 'right' });
    doc.text('Tax Amount', pageWidth - 50, y, { align: 'right' });
    y += 8;
    doc.line(50, y, pageWidth - 50, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#0b1c30');
    doc.text('Ontario', 50, y);
    doc.text(reportData.provincialHealthTax.name, 160, y);
    doc.text(formatReportCurrency(reportData.provincialHealthTax.ytdPayroll), 340, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.provincialHealthTax.taxAmount), pageWidth - 50, y, { align: 'right' });
    
    y += 20;

    // Provincial Workers Compensation Breakdown Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Provincial Workers Compensation Breakdown', 50, y);
    y += 10;
    doc.line(50, y, pageWidth - 50, y);
    y += 16;

    // Headers
    doc.setFontSize(8);
    doc.setTextColor('#43474f');
    doc.text('Province', 50, y);
    doc.text('Workers Comp Name', 160, y);
    doc.text('Assessable Earnings', 340, y, { align: 'right' });
    doc.text('Premium', pageWidth - 50, y, { align: 'right' });
    y += 8;
    doc.line(50, y, pageWidth - 50, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#0b1c30');
    doc.text('Ontario', 50, y);
    doc.text(reportData.provincialWorkersComp.name, 160, y);
    doc.text(formatReportCurrency(reportData.provincialWorkersComp.assessableEarnings), 340, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.provincialWorkersComp.premium), pageWidth - 50, y, { align: 'right' });

    // Add page footers dynamically
    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=remittance_report_${startDate}_to_${endDate}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 8. Provincial Health Tax Report (annual EHT summary)
router.get('/health-tax-report', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const year = c.req.query('tax_year');
    const format = c.req.query('format');

    if (!year) {
      return c.json({ error: 'Missing tax_year query parameter' }, 400);
    }

    // Get company details
    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // Query runs in this year
    const payments = await c.env.DB.prepare(`
      SELECT SUM(pre.gross_pay) as gross, SUM(pre.eht_premium) as eht
      FROM payroll_run_employees pre
      JOIN payroll_runs pr ON pre.run_id = pr.id
      WHERE pr.company_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
        AND pr.run_date >= ? AND pr.run_date <= ?
    `).bind(companyId, yearStart, yearEnd).first() as any;

    const ytdPayroll = payments?.gross || 0;
    const ytdTaxAccrued = payments?.eht || 0;

    const reportData = {
      companyName: cs.legal_name,
      year,
      ytdPayroll: Math.round(ytdPayroll * 100) / 100,
      ytdTaxAccrued: Math.round(ytdTaxAccrued * 100) / 100
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    // Generate PDF
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Tax Year:', value: year }
    ];
    drawReportHeader(doc, 'Provincial health tax', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();

    // Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor('#43474f');
    doc.text('Province', 50, y);
    doc.text('YTD payroll', 320, y, { align: 'right' });
    doc.text('YTD tax accrued', pageWidth - 50, y, { align: 'right' });

    y += 10;
    doc.setDrawColor('#c3c6d1');
    doc.setLineWidth(0.5);
    doc.line(50, y, pageWidth - 50, y);
    y += 18;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#0b1c30');
    doc.text('Ontario', 50, y);
    doc.text(formatReportCurrency(reportData.ytdPayroll), 320, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.ytdTaxAccrued), pageWidth - 50, y, { align: 'right' });
    y += 15;

    // Subtotal total line
    y += 4;
    doc.line(50, y, pageWidth - 50, y);
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.text('Total', 50, y);
    doc.text(formatReportCurrency(reportData.ytdPayroll), 320, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.ytdTaxAccrued), pageWidth - 50, y, { align: 'right' });
    
    doc.line(50, y + 4, pageWidth - 50, y + 4);
    doc.line(50, y + 6, pageWidth - 50, y + 6); // double underline

    // Add page footers dynamically
    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=health_tax_report_${year}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Helper for timezone-safe date formatting
function formatDateFull(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00Z');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const dayName = days[date.getUTCDay()];
  const monthName = months[date.getUTCMonth()];
  const dayNum = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  
  return `${dayName}, ${monthName} ${dayNum}, ${year}`;
}

// 6. Deductions & expenses summary report
router.get('/deductions-expenses-summary', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const payGroupsParam = c.req.query('pay_group_ids');
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const format = c.req.query('format');

    if (!startDate || !endDate) {
      return c.json({ error: 'Missing start_date or end_date' }, 400);
    }

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    let query = `
      SELECT pre.*, emp.first_name, emp.last_name, emp.pay_interval, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount, pr.period_start, pr.period_end, pr.company_id
      FROM payroll_run_employees pre
      JOIN payroll_runs pr ON pre.run_id = pr.id
      JOIN employees emp ON pre.employee_id = emp.id
      WHERE pr.company_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
        AND pr.period_start >= ? AND pr.period_end <= ?
    `;
    const params: any[] = [companyId, startDate, endDate];

    if (payGroupsParam && payGroupsParam !== 'all') {
      const ids = payGroupsParam.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length > 0) {
        query += ` AND pr.pay_group_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }

    const runEmployees = await c.env.DB.prepare(query).bind(...params).all() as any;
    const records = runEmployees.results || [];

    // Aggregate details
    let cppEmp = 0, cppEmpCount = new Set();
    let cppEmployerVal = 0, cppEmployerCount = new Set();
    let eiEmp = 0, eiEmpCount = new Set();
    let eiEmployerVal = 0, eiEmployerCount = new Set();
    let fedTax = 0, fedTaxCount = new Set();
    let provTax = 0, provTaxCount = new Set();

    for (const rec of records) {
      const payPeriod = (rec.pay_interval && rec.pay_interval !== 'company') ? rec.pay_interval : cs.pay_period;
      const taxSplit = splitTaxForEmployee(rec.gross_pay, rec.tax, payPeriod, rec);

      if (rec.cpp_employee > 0) {
        cppEmp += rec.cpp_employee;
        cppEmpCount.add(rec.employee_id);
      }
      if (rec.cpp_employer > 0) {
        cppEmployerVal += rec.cpp_employer;
        cppEmployerCount.add(rec.employee_id);
      }
      if (rec.ei_employee > 0) {
        eiEmp += rec.ei_employee;
        eiEmpCount.add(rec.employee_id);
      }
      if (rec.ei_employer > 0) {
        eiEmployerVal += rec.ei_employer;
        eiEmployerCount.add(rec.employee_id);
      }
      if (taxSplit.fed > 0) {
        fedTax += taxSplit.fed;
        fedTaxCount.add(rec.employee_id);
      }
      if (taxSplit.prov > 0) {
        provTax += taxSplit.prov;
        provTaxCount.add(rec.employee_id);
      }
    }

    // Standard rows matching pic 1
    const rows = [
      {
        name: 'CPP (employee contribution)',
        employee: Math.round(cppEmp * 100) / 100,
        employer: Math.round(cppEmployerVal * 100) / 100,
        total: Math.round((cppEmp + cppEmployerVal) * 100) / 100,
        employeeCount: cppEmpCount.size
      },
      {
        name: 'EI (employee contribution)',
        employee: Math.round(eiEmp * 100) / 100,
        employer: Math.round(eiEmployerVal * 100) / 100,
        total: Math.round((eiEmp + eiEmployerVal) * 100) / 100,
        employeeCount: eiEmpCount.size
      },
      {
        name: 'Ontario component of FIT',
        employee: Math.round(provTax * 100) / 100,
        employer: 0,
        total: Math.round(provTax * 100) / 100,
        employeeCount: provTaxCount.size
      },
      {
        name: 'Federal income tax',
        employee: Math.round(fedTax * 100) / 100,
        employer: 0,
        total: Math.round(fedTax * 100) / 100,
        employeeCount: fedTaxCount.size
      }
    ].filter(r => r.total > 0 || r.name.includes('FIT') || r.name.includes('Federal') || r.name.includes('CPP'));

    const statEmployeeTotal = rows.reduce((sum, r) => sum + r.employee, 0);
    const statEmployerTotal = rows.reduce((sum, r) => sum + r.employer, 0);
    const statTotalSum = statEmployeeTotal + statEmployerTotal;
    const uniqueEmployeesSet = new Set(records.map((r: any) => r.employee_id));
    const totalEmployees = uniqueEmployeesSet.size;

    const reportData = {
      companyName: cs.legal_name,
      startDate: formatDateFull(startDate),
      endDate: formatDateFull(endDate),
      rows,
      totals: {
        employee: Math.round(statEmployeeTotal * 100) / 100,
        employer: Math.round(statEmployerTotal * 100) / 100,
        total: Math.round(statTotalSum * 100) / 100,
        employeeCount: totalEmployees
      }
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Period:', value: `From ${reportData.startDate} to ${reportData.endDate}*` }
    ];
    drawReportHeader(doc, 'Deductions & expenses summary', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor('#43474f');
    doc.text('Deductions & expenses', 50, y);
    doc.text('Employee', 300, y, { align: 'right' });
    doc.text('Employer', 390, y, { align: 'right' });
    doc.text('Total', 480, y, { align: 'right' });
    doc.text('No. of\nemployees', pageWidth - 50, y - 5, { align: 'right' });

    y += 15;
    doc.setDrawColor('#c3c6d1');
    doc.setLineWidth(0.5);
    doc.line(50, y, pageWidth - 50, y);
    y += 15;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor('#0b1c30');
    doc.text('Statutory', 50, y);
    y += 15;

    doc.setFont('helvetica', 'normal');
    for (const r of reportData.rows) {
      doc.text(r.name, 50, y);
      doc.text(r.employee > 0 ? formatReportCurrency(r.employee) : '-', 300, y, { align: 'right' });
      doc.text(r.employer > 0 ? formatReportCurrency(r.employer) : '-', 390, y, { align: 'right' });
      doc.text(formatReportCurrency(r.total), 480, y, { align: 'right' });
      doc.text(String(r.employeeCount), pageWidth - 50, y, { align: 'right' });
      y += 15;
    }

    y += 5;
    doc.setLineWidth(1);
    doc.line(240, y, pageWidth - 50, y);
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.text('Statutory total', 50, y);
    doc.text(formatReportCurrency(reportData.totals.employee), 300, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.totals.employer), 390, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.totals.total), 480, y, { align: 'right' });
    doc.text(String(reportData.totals.employeeCount), pageWidth - 50, y, { align: 'right' });
    
    y += 10;
    doc.line(50, y, pageWidth - 50, y);
    y += 12;

    doc.text('Grand total', 50, y);
    doc.text(formatReportCurrency(reportData.totals.employee), 300, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.totals.employer), 390, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.totals.total), 480, y, { align: 'right' });
    doc.text(String(reportData.totals.employeeCount), pageWidth - 50, y, { align: 'right' });

    y += 5;
    doc.line(50, y, pageWidth - 50, y);
    doc.line(50, y + 2, pageWidth - 50, y + 2); // double underline
    
    y += 25;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor('#43474f');
    doc.text('[1] One or more calculated values in this transaction have been modified by a user', 50, y);

    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=deductions_expenses_summary.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 7. Employee information report
router.get('/employee-information', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const payGroupsParam = c.req.query('pay_group_ids');
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const format = c.req.query('format');

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    let query = `
      SELECT emp.*, pg.name as pay_group_name, pg.pay_frequency as pay_group_frequency
      FROM employees emp
      LEFT JOIN pay_groups pg ON emp.pay_group_id = pg.id
      WHERE emp.company_id = ?
    `;
    const params: any[] = [companyId];

    if (payGroupsParam && payGroupsParam !== 'all') {
      const ids = payGroupsParam.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length > 0) {
        query += ` AND emp.pay_group_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }

    const employeesData = await c.env.DB.prepare(query).bind(...params).all() as any;
    const employees = employeesData.results || [];

    const grouped: Record<string, any[]> = {};
    for (const emp of employees) {
      const gName = emp.pay_group_name || 'Unassigned';
      if (!grouped[gName]) grouped[gName] = [];
      grouped[gName].push(emp);
    }

    const groupsList = Object.entries(grouped).map(([gName, list]) => {
      list.sort((a, b) => {
        const nameA = `${a.last_name}, ${a.first_name}`.toLowerCase();
        const nameB = `${b.last_name}, ${b.first_name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });

      return {
        payGroupName: gName,
        employees: list.map(emp => {
          const sinPlain = emp.sin || '';
          const maskedSin = sinPlain.length > 3 ? '******' + sinPlain.substring(sinPlain.length - 3) : sinPlain;

          const addrParts = [
            emp.address_line1,
            emp.address_line2,
            emp.city,
            emp.province,
            emp.postal_code
          ].filter(Boolean);
          const fullAddress = addrParts.join(', ');

          const fedCredit = emp.override_fed_tax_credit === 1 ? formatReportCurrency(emp.fed_tax_credit_amount) : 'BPA *';
          const provCredit = emp.override_prov_tax_credit === 1 ? formatReportCurrency(emp.prov_tax_credit_amount) : 'BPA *';

          return {
            name: `${emp.last_name}, ${emp.first_name}`,
            code: 'N/A',
            sin: maskedSin,
            birthDate: emp.birth_date ? emp.birth_date.split('-').reverse().join('/') : '',
            startDate: emp.start_date ? emp.start_date.split('-').reverse().join('/') : '',
            status: emp.status ? emp.status.charAt(0).toUpperCase() + emp.status.slice(1) : 'Active',
            type: emp.role === 'full-time' ? 'Full time employee' : (emp.role || 'Full time employee'),
            phone: emp.phone || '',
            address: fullAddress,
            frequency: emp.pay_group_frequency ? emp.pay_group_frequency.charAt(0).toUpperCase() + emp.pay_group_frequency.slice(1) : 'Monthly',
            fedCredit,
            provCredit
          };
        })
      };
    });

    const reportData = {
      companyName: cs.legal_name,
      startDate: startDate ? formatDateFull(startDate) : null,
      endDate: endDate ? formatDateFull(endDate) : null,
      groups: groupsList
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const metadata = startDate && endDate ? [
      { label: 'Period:', value: `From ${reportData.startDate} to ${reportData.endDate}` }
    ] : [];
    
    drawReportHeader(doc, 'Employee information', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor('#43474f');
    
    doc.text('Employee', 50, y);
    doc.text('SIN', 170, y);
    doc.text('Birth date\n(MM/DD/YYYY)', 220, y - 5);
    doc.text('Start date\n(MM/DD/YYYY)', 280, y - 5);
    doc.text('Status', 340, y);
    doc.text('Type', 380, y);
    doc.text('Phone', 430, y);
    doc.text('Address', 490, y);
    doc.text('Frequency', 600, y);
    doc.text('Federal tax\ncredit', 655, y - 5);
    doc.text('Provincial tax\ncredit', 715, y - 5);

    y += 18;
    doc.setDrawColor('#c3c6d1');
    doc.setLineWidth(0.5);
    doc.line(50, y, pageWidth - 50, y);
    y += 15;

    for (const g of reportData.groups) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor('#0b1c30');
      doc.text(g.payGroupName, 50, y);
      y += 15;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      for (const emp of g.employees) {
        if (y > doc.internal.pageSize.getHeight() - 80) {
          doc.addPage();
          drawReportHeader(doc, 'Employee information', reportData.companyName, [], brandColor);
          y = 135;
          
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor('#43474f');
          doc.text('Employee', 50, y);
          doc.text('SIN', 170, y);
          doc.text('Birth date\n(MM/DD/YYYY)', 220, y - 5);
          doc.text('Start date\n(MM/DD/YYYY)', 280, y - 5);
          doc.text('Status', 340, y);
          doc.text('Type', 380, y);
          doc.text('Phone', 430, y);
          doc.text('Address', 490, y);
          doc.text('Frequency', 600, y);
          doc.text('Federal tax\ncredit', 655, y - 5);
          doc.text('Provincial tax\ncredit', 715, y - 5);
          
          y += 18;
          doc.line(50, y, pageWidth - 50, y);
          y += 15;
          doc.setFont('helvetica', 'normal');
        }

        const nameLines = [`${emp.name}`, `Code: ${emp.code}`];
        doc.text(nameLines, 50, y);
        doc.text(emp.sin, 170, y);
        doc.text(emp.birthDate, 220, y);
        doc.text(emp.startDate, 280, y);
        doc.text(emp.status, 340, y);
        doc.text(emp.type, 380, y);
        doc.text(emp.phone, 430, y);
        
        const addrLines = doc.splitTextToSize(emp.address, 100);
        doc.text(addrLines, 490, y);
        
        doc.text(emp.frequency, 600, y);
        doc.text(emp.fedCredit, 655, y);
        doc.text(emp.provCredit, 715, y);

        const rowHeight = Math.max(nameLines.length, addrLines.length) * 10 + 10;
        y += rowHeight;
      }
    }

    y += 15;
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = 60;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('* BPA is the basic personal amount for federal and provincial tax credits', 50, y);

    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=employee_information_report.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 8. Employee variance report
router.get('/employee-variance', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const runId = c.req.query('run_id');
    const employeeIdParam = c.req.query('employee_id');
    const format = c.req.query('format');

    if (!runId) return c.json({ error: 'Missing run_id parameter' }, 400);

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    const run = await c.env.DB.prepare(`
      SELECT pr.*, cs.legal_name, cs.pay_period as company_pay_period, pg.name as pay_group_name
      FROM payroll_runs pr
      JOIN company_settings cs ON pr.company_id = cs.id
      LEFT JOIN pay_groups pg ON pr.pay_group_id = pg.id
      WHERE pr.id = ? AND pr.company_id = ?
    `).bind(runId, companyId).first() as any;

    if (!run) return c.json({ error: 'Payroll run not found' }, 404);

    let query = `
      SELECT pre.*, emp.first_name, emp.last_name, emp.pay_type, emp.rate, emp.pay_interval, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount
      FROM payroll_run_employees pre
      JOIN employees emp ON pre.employee_id = emp.id
      WHERE pre.run_id = ?
    `;
    const queryParams: any[] = [runId];

    if (employeeIdParam && employeeIdParam !== 'all') {
      query += ` AND pre.employee_id = ?`;
      queryParams.push(Number(employeeIdParam));
    }

    const currentRunEmployees = await c.env.DB.prepare(query).bind(...queryParams).all() as any;
    const currentList = currentRunEmployees.results || [];

    const employeesCalculations: any[] = [];

    const grandTotals = {
      prev: { earnings: 0, cpp: 0, fedTax: 0, provTax: 0, taxTotal: 0, cppEmployer: 0, eiEmployer: 0, wsib: 0, eht: 0, otherExpTotal: 0, netPay: 0, salaryCost: 0 },
      curr: { earnings: 0, cpp: 0, fedTax: 0, provTax: 0, taxTotal: 0, cppEmployer: 0, eiEmployer: 0, wsib: 0, eht: 0, otherExpTotal: 0, netPay: 0, salaryCost: 0 },
      var: { earnings: 0, cpp: 0, fedTax: 0, provTax: 0, taxTotal: 0, cppEmployer: 0, eiEmployer: 0, wsib: 0, eht: 0, otherExpTotal: 0, netPay: 0, salaryCost: 0 }
    };

    for (const curRe of currentList) {
      const prevRe = await c.env.DB.prepare(`
        SELECT pre.*, emp.pay_type, emp.rate, emp.pay_interval, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount
        FROM payroll_run_employees pre
        JOIN payroll_runs pr ON pre.run_id = pr.id
        JOIN employees emp ON pre.employee_id = emp.id
        WHERE pre.employee_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
          AND (pr.run_date < ? OR (pr.run_date = ? AND pr.id < ?))
        ORDER BY pr.run_date DESC, pr.id DESC
        LIMIT 1
      `).bind(curRe.employee_id, run.run_date, run.run_date, run.id).first() as any;

      const payPeriod = (curRe.pay_interval && curRe.pay_interval !== 'company') ? curRe.pay_interval : run.company_pay_period;

      const curSalLine = curRe.pay_type === 'hourly' ? 0 : curRe.rate;
      const curHourlyLine = curRe.pay_type === 'hourly' ? (curRe.hours_worked || 0) * curRe.rate : 0;
      const curCommLine = curRe.pay_type === 'salary_commission' ? (curRe.additional_commission || 0) : 0;
      const curVacPaid = curRe.vacation_paid || 0;
      const curEarningsTotal = curSalLine + curHourlyLine + curCommLine + curVacPaid;

      const curTaxSplit = splitTaxForEmployee(curRe.gross_pay, curRe.tax, payPeriod, curRe);
      const curCpp = curRe.cpp_employee || 0;
      const curTaxTotal = curCpp + curTaxSplit.fed + curTaxSplit.prov;

      const curCppEmployer = curRe.cpp_employer || 0;
      const curEiEmployer = curRe.ei_employer || 0;
      const curWsib = curRe.wsib_premium || 0;
      const curEht = curRe.eht_premium || 0;
      const curOtherExpTotal = curCppEmployer + curEiEmployer + curWsib + curEht;

      const curNet = curRe.net_pay || 0;
      const curSalaryCost = curEarningsTotal + curOtherExpTotal;

      let prevSalLine = 0, prevHourlyLine = 0, prevCommLine = 0, prevVacPaid = 0, prevEarningsTotal = 0;
      let prevCpp = 0, prevFed = 0, prevProv = 0, prevTaxTotal = 0;
      let prevCppEmployer = 0, prevEiEmployer = 0, prevWsib = 0, prevEht = 0, prevOtherExpTotal = 0;
      let prevNet = 0, prevSalaryCost = 0;

      if (prevRe) {
        const prevPayPeriod = (prevRe.pay_interval && prevRe.pay_interval !== 'company') ? prevRe.pay_interval : run.company_pay_period;
        prevSalLine = prevRe.pay_type === 'hourly' ? 0 : prevRe.rate;
        prevHourlyLine = prevRe.pay_type === 'hourly' ? (prevRe.hours_worked || 0) * prevRe.rate : 0;
        prevCommLine = prevRe.pay_type === 'salary_commission' ? (prevRe.additional_commission || 0) : 0;
        prevVacPaid = prevRe.vacation_paid || 0;
        prevEarningsTotal = prevSalLine + prevHourlyLine + prevCommLine + prevVacPaid;

        const prevTaxSplit = splitTaxForEmployee(prevRe.gross_pay, prevRe.tax, prevPayPeriod, prevRe);
        prevCpp = prevRe.cpp_employee || 0;
        prevFed = prevTaxSplit.fed;
        prevProv = prevTaxSplit.prov;
        prevTaxTotal = prevCpp + prevFed + prevProv;

        prevCppEmployer = prevRe.cpp_employer || 0;
        prevEiEmployer = prevRe.ei_employer || 0;
        prevWsib = prevRe.wsib_premium || 0;
        prevEht = prevRe.eht_premium || 0;
        prevOtherExpTotal = prevCppEmployer + prevEiEmployer + prevWsib + prevEht;

        prevNet = prevRe.net_pay || 0;
        prevSalaryCost = prevEarningsTotal + prevOtherExpTotal;
      }

      const varSalLine = curSalLine - prevSalLine;
      const varHourlyLine = curHourlyLine - prevHourlyLine;
      const varCommLine = curCommLine - prevCommLine;
      const varVacPaid = curVacPaid - prevVacPaid;
      const varEarningsTotal = curEarningsTotal - prevEarningsTotal;

      const varCpp = curCpp - prevCpp;
      const varFed = curTaxSplit.fed - prevFed;
      const varProv = curTaxSplit.prov - prevProv;
      const varTaxTotal = curTaxTotal - prevTaxTotal;

      const varCppEmployer = curCppEmployer - prevCppEmployer;
      const varEiEmployer = curEiEmployer - prevEiEmployer;
      const varWsib = curWsib - prevWsib;
      const varEht = curEht - prevEht;
      const varOtherExpTotal = curOtherExpTotal - prevOtherExpTotal;

      const varNet = curNet - prevNet;
      const varSalaryCost = curSalaryCost - prevSalaryCost;

      grandTotals.prev.earnings += prevEarningsTotal;
      grandTotals.prev.cpp += prevCpp;
      grandTotals.prev.fedTax += prevFed;
      grandTotals.prev.provTax += prevProv;
      grandTotals.prev.taxTotal += prevTaxTotal;
      grandTotals.prev.cppEmployer += prevCppEmployer;
      grandTotals.prev.eiEmployer += prevEiEmployer;
      grandTotals.prev.wsib += prevWsib;
      grandTotals.prev.eht += prevEht;
      grandTotals.prev.otherExpTotal += prevOtherExpTotal;
      grandTotals.prev.netPay += prevNet;
      grandTotals.prev.salaryCost += prevSalaryCost;

      grandTotals.curr.earnings += curEarningsTotal;
      grandTotals.curr.cpp += curCpp;
      grandTotals.curr.fedTax += curTaxSplit.fed;
      grandTotals.curr.provTax += curTaxSplit.prov;
      grandTotals.curr.taxTotal += curTaxTotal;
      grandTotals.curr.cppEmployer += curCppEmployer;
      grandTotals.curr.eiEmployer += curEiEmployer;
      grandTotals.curr.wsib += curWsib;
      grandTotals.curr.eht += curEht;
      grandTotals.curr.otherExpTotal += curOtherExpTotal;
      grandTotals.curr.netPay += curNet;
      grandTotals.curr.salaryCost += curSalaryCost;

      grandTotals.var.earnings += varEarningsTotal;
      grandTotals.var.cpp += varCpp;
      grandTotals.var.fedTax += varFed;
      grandTotals.var.provTax += varProv;
      grandTotals.var.taxTotal += varTaxTotal;
      grandTotals.var.cppEmployer += varCppEmployer;
      grandTotals.var.eiEmployer += varEiEmployer;
      grandTotals.var.wsib += varWsib;
      grandTotals.var.eht += varEht;
      grandTotals.var.otherExpTotal += varOtherExpTotal;
      grandTotals.var.netPay += varNet;
      grandTotals.var.salaryCost += varSalaryCost;

      employeesCalculations.push({
        employeeName: `${curRe.last_name}, ${curRe.first_name}`,
        employeeCode: '',
        earnings: {
          salary: { prev: prevSalLine, curr: curSalLine, var: varSalLine },
          hourly: { prev: prevHourlyLine, curr: curHourlyLine, var: varHourlyLine },
          commission: { prev: prevCommLine, curr: curCommLine, var: varCommLine },
          vacation: { prev: prevVacPaid, curr: curVacPaid, var: varVacPaid },
          total: { prev: prevEarningsTotal, curr: curEarningsTotal, var: varEarningsTotal }
        },
        tax: {
          cpp: { prev: prevCpp, curr: curCpp, var: varCpp },
          fedTax: { prev: prevFed, curr: curTaxSplit.fed, var: varFed },
          provTax: { prev: prevProv, curr: curTaxSplit.prov, var: varProv },
          total: { prev: prevTaxTotal, curr: curTaxTotal, var: varTaxTotal }
        },
        otherExpenses: {
          cppEmployer: { prev: prevCppEmployer, curr: curCppEmployer, var: varCppEmployer },
          eiEmployer: { prev: prevEiEmployer, curr: curEiEmployer, var: varEiEmployer },
          wsib: { prev: prevWsib, curr: curWsib, var: varWsib },
          eht: { prev: prevEht, curr: curEht, var: varEht },
          total: { prev: prevOtherExpTotal, curr: curOtherExpTotal, var: varOtherExpTotal }
        },
        otherTotals: {
          netPay: { prev: prevNet, curr: curNet, var: varNet },
          salaryCost: { prev: prevSalaryCost, curr: curSalaryCost, var: varSalaryCost }
        }
      });
    }

    const reportData = {
      companyName: run.legal_name,
      payGroup: run.pay_group_name || 'Ad-hoc Run',
      periodStart: run.period_start,
      periodEnd: run.period_end,
      employees: employeesCalculations,
      grandTotals: {
        prev: {
          earnings: Math.round(grandTotals.prev.earnings * 100) / 100,
          cpp: Math.round(grandTotals.prev.cpp * 100) / 100,
          fedTax: Math.round(grandTotals.prev.fedTax * 100) / 100,
          provTax: Math.round(grandTotals.prev.provTax * 100) / 100,
          taxTotal: Math.round(grandTotals.prev.taxTotal * 100) / 100,
          cppEmployer: Math.round(grandTotals.prev.cppEmployer * 100) / 100,
          eiEmployer: Math.round(grandTotals.prev.eiEmployer * 100) / 100,
          wsib: Math.round(grandTotals.prev.wsib * 100) / 100,
          eht: Math.round(grandTotals.prev.eht * 100) / 100,
          otherExpTotal: Math.round(grandTotals.prev.otherExpTotal * 100) / 100,
          netPay: Math.round(grandTotals.prev.netPay * 100) / 100,
          salaryCost: Math.round(grandTotals.prev.salaryCost * 100) / 100
        },
        curr: {
          earnings: Math.round(grandTotals.curr.earnings * 100) / 100,
          cpp: Math.round(grandTotals.curr.cpp * 100) / 100,
          fedTax: Math.round(grandTotals.curr.fedTax * 100) / 100,
          provTax: Math.round(grandTotals.curr.provTax * 100) / 100,
          taxTotal: Math.round(grandTotals.curr.taxTotal * 100) / 100,
          cppEmployer: Math.round(grandTotals.curr.cppEmployer * 100) / 100,
          eiEmployer: Math.round(grandTotals.curr.eiEmployer * 100) / 100,
          wsib: Math.round(grandTotals.curr.wsib * 100) / 100,
          eht: Math.round(grandTotals.curr.eht * 100) / 100,
          otherExpTotal: Math.round(grandTotals.curr.otherExpTotal * 100) / 100,
          netPay: Math.round(grandTotals.curr.netPay * 100) / 100,
          salaryCost: Math.round(grandTotals.curr.salaryCost * 100) / 100
        },
        var: {
          earnings: Math.round(grandTotals.var.earnings * 100) / 100,
          cpp: Math.round(grandTotals.var.cpp * 100) / 100,
          fedTax: Math.round(grandTotals.var.fedTax * 100) / 100,
          provTax: Math.round(grandTotals.var.provTax * 100) / 100,
          taxTotal: Math.round(grandTotals.var.taxTotal * 100) / 100,
          cppEmployer: Math.round(grandTotals.var.cppEmployer * 100) / 100,
          eiEmployer: Math.round(grandTotals.var.eiEmployer * 100) / 100,
          wsib: Math.round(grandTotals.var.wsib * 100) / 100,
          eht: Math.round(grandTotals.var.eht * 100) / 100,
          otherExpTotal: Math.round(grandTotals.var.otherExpTotal * 100) / 100,
          netPay: Math.round(grandTotals.var.netPay * 100) / 100,
          salaryCost: Math.round(grandTotals.var.salaryCost * 100) / 100
        }
      }
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Pay run:', value: `${run.period_start} - ${run.period_end}` },
      { label: 'Pay group:', value: reportData.payGroup }
    ];
    drawReportHeader(doc, 'Employee variance', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();

    const drawVarianceTable = (doc: jsPDF, data: any, titleHeader: string, yStart: number) => {
      let cy = yStart;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor('#0b1c30');
      doc.text(titleHeader, 50, cy);
      
      doc.text('Previous period', 320, cy, { align: 'right' });
      doc.text('This pay period', 420, cy, { align: 'right' });
      doc.text('Variance', pageWidth - 50, cy, { align: 'right' });

      cy += 8;
      doc.setDrawColor('#0b1c30');
      doc.setLineWidth(1);
      doc.line(50, cy, pageWidth - 50, cy);
      cy += 14;

      const drawRow = (label: string, prev: number, curr: number, valVar: number, isBold: boolean = false) => {
        if (isBold) {
          doc.setFont('helvetica', 'bold');
          doc.setLineWidth(0.5);
          doc.line(260, cy - 8, pageWidth - 50, cy - 8);
        } else {
          doc.setFont('helvetica', 'normal');
        }
        doc.text(label, 50, cy);
        doc.text(formatReportCurrency(prev), 320, cy, { align: 'right' });
        doc.text(formatReportCurrency(curr), 420, cy, { align: 'right' });
        doc.text(formatReportCurrency(valVar), pageWidth - 50, cy, { align: 'right' });
        cy += 14;
      };

      doc.setFont('helvetica', 'bold');
      doc.text('Earnings', 50, cy);
      cy += 14;
      if (data.earnings.salary.curr > 0 || data.earnings.salary.prev > 0) {
        drawRow('Salary', data.earnings.salary.prev, data.earnings.salary.curr, data.earnings.salary.var);
      }
      if (data.earnings.hourly.curr > 0 || data.earnings.hourly.prev > 0) {
        drawRow('Hourly', data.earnings.hourly.prev, data.earnings.hourly.curr, data.earnings.hourly.var);
      }
      if (data.earnings.commission.curr > 0 || data.earnings.commission.prev > 0) {
        drawRow('Commission', data.earnings.commission.prev, data.earnings.commission.curr, data.earnings.commission.var);
      }
      if (data.earnings.vacation.curr > 0 || data.earnings.vacation.prev > 0) {
        drawRow('Vacation', data.earnings.vacation.prev, data.earnings.vacation.curr, data.earnings.vacation.var);
      }
      drawRow('Total earnings', data.earnings.total.prev, data.earnings.total.curr, data.earnings.total.var, true);
      cy += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('Tax', 50, cy);
      cy += 14;
      drawRow('CPP (employee contribution)', data.tax.cpp.prev, data.tax.cpp.curr, data.tax.cpp.var);
      drawRow('Federal income tax', data.tax.fedTax.prev, data.tax.fedTax.curr, data.tax.fedTax.var);
      drawRow('Ontario component of FIT', data.tax.provTax.prev, data.tax.provTax.curr, data.tax.provTax.var);
      drawRow('Total tax', data.tax.total.prev, data.tax.total.curr, data.tax.total.var, true);
      cy += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('Other expenses', 50, cy);
      cy += 14;
      drawRow('CPP (employer contribution)', data.otherExpenses.cppEmployer.prev, data.otherExpenses.cppEmployer.curr, data.otherExpenses.cppEmployer.var);
      if (data.otherExpenses.eiEmployer.curr > 0 || data.otherExpenses.eiEmployer.prev > 0) {
        drawRow('EI (employer contribution)', data.otherExpenses.eiEmployer.prev, data.otherExpenses.eiEmployer.curr, data.otherExpenses.eiEmployer.var);
      }
      if (data.otherExpenses.wsib.curr > 0 || data.otherExpenses.wsib.prev > 0) {
        drawRow('WSIB premium', data.otherExpenses.wsib.prev, data.otherExpenses.wsib.curr, data.otherExpenses.wsib.var);
      }
      if (data.otherExpenses.eht.curr > 0 || data.otherExpenses.eht.prev > 0) {
        drawRow('EHT premium', data.otherExpenses.eht.prev, data.otherExpenses.eht.curr, data.otherExpenses.eht.var);
      }
      drawRow('Total other expenses', data.otherExpenses.total.prev, data.otherExpenses.total.curr, data.otherExpenses.total.var, true);
      cy += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('Other totals', 50, cy);
      cy += 14;
      drawRow('Net pay', data.otherTotals.netPay.prev, data.otherTotals.netPay.curr, data.otherTotals.netPay.var);
      drawRow('Total salary cost', data.otherTotals.salaryCost.prev, data.otherTotals.salaryCost.curr, data.otherTotals.salaryCost.var, true);

      return cy;
    };

    for (let index = 0; index < reportData.employees.length; index++) {
      const emp = reportData.employees[index];
      if (index > 0) {
        doc.addPage();
        drawReportHeader(doc, 'Employee variance', reportData.companyName, metadata, brandColor);
        y = 135;
      }
      const titleStr = `Employee Code:   ${emp.employeeName} (${emp.employeeCode})`;
      y = drawVarianceTable(doc, emp, titleStr, y);
    }

    if (reportData.employees.length > 1) {
      doc.addPage();
      drawReportHeader(doc, 'Employee variance', reportData.companyName, metadata, brandColor);
      y = 135;

      const summaryData = {
        earnings: {
          salary: { prev: reportData.employees.reduce((s, e) => s + e.earnings.salary.prev, 0), curr: reportData.employees.reduce((s, e) => s + e.earnings.salary.curr, 0), var: reportData.employees.reduce((s, e) => s + e.earnings.salary.var, 0) },
          hourly: { prev: reportData.employees.reduce((s, e) => s + e.earnings.hourly.prev, 0), curr: reportData.employees.reduce((s, e) => s + e.earnings.hourly.curr, 0), var: reportData.employees.reduce((s, e) => s + e.earnings.hourly.var, 0) },
          commission: { prev: reportData.employees.reduce((s, e) => s + e.earnings.commission.prev, 0), curr: reportData.employees.reduce((s, e) => s + e.earnings.commission.curr, 0), var: reportData.employees.reduce((s, e) => s + e.earnings.commission.var, 0) },
          vacation: { prev: reportData.employees.reduce((s, e) => s + e.earnings.vacation.prev, 0), curr: reportData.employees.reduce((s, e) => s + e.earnings.vacation.curr, 0), var: reportData.employees.reduce((s, e) => s + e.earnings.vacation.var, 0) },
          total: { prev: reportData.grandTotals.prev.earnings, curr: reportData.grandTotals.curr.earnings, var: reportData.grandTotals.var.earnings }
        },
        tax: {
          cpp: { prev: reportData.grandTotals.prev.cpp, curr: reportData.grandTotals.curr.cpp, var: reportData.grandTotals.var.cpp },
          fedTax: { prev: reportData.grandTotals.prev.fedTax, curr: reportData.grandTotals.curr.fedTax, var: reportData.grandTotals.var.fedTax },
          provTax: { prev: reportData.grandTotals.prev.provTax, curr: reportData.grandTotals.curr.provTax, var: reportData.grandTotals.var.provTax },
          total: { prev: reportData.grandTotals.prev.taxTotal, curr: reportData.grandTotals.curr.taxTotal, var: reportData.grandTotals.var.taxTotal }
        },
        otherExpenses: {
          cppEmployer: { prev: reportData.grandTotals.prev.cppEmployer, curr: reportData.grandTotals.curr.cppEmployer, var: reportData.grandTotals.var.cppEmployer },
          eiEmployer: { prev: reportData.grandTotals.prev.eiEmployer, curr: reportData.grandTotals.curr.eiEmployer, var: reportData.grandTotals.var.eiEmployer },
          wsib: { prev: reportData.grandTotals.prev.wsib, curr: reportData.grandTotals.curr.wsib, var: reportData.grandTotals.var.wsib },
          eht: { prev: reportData.grandTotals.prev.eht, curr: reportData.grandTotals.curr.eht, var: reportData.grandTotals.var.eht },
          total: { prev: reportData.grandTotals.prev.otherExpTotal, curr: reportData.grandTotals.curr.otherExpTotal, var: reportData.grandTotals.var.otherExpTotal }
        },
        otherTotals: {
          netPay: { prev: reportData.grandTotals.prev.netPay, curr: reportData.grandTotals.curr.netPay, var: reportData.grandTotals.var.netPay },
          salaryCost: { prev: reportData.grandTotals.prev.salaryCost, curr: reportData.grandTotals.curr.salaryCost, var: reportData.grandTotals.var.salaryCost }
        }
      };

      y = drawVarianceTable(doc, summaryData, 'Grand Totals Summary', y);
    }

    y += 15;
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = 60;
    }
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text('¹ One or more calculated values in this transaction have been modified by a user', 50, y);

    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=employee_variance_report_${runId}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 9. Payroll detail report
router.get('/payroll-detail', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const payGroupsParam = c.req.query('pay_group_ids');
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const format = c.req.query('format');

    if (!startDate || !endDate) {
      return c.json({ error: 'Missing start_date or end_date' }, 400);
    }

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    let query = `
      SELECT pre.*, emp.first_name, emp.last_name, emp.pay_interval, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount,
             pr.run_date, pr.run_date AS payment_date, pr.period_start, pr.period_end, pg.name as pay_group_name
      FROM payroll_run_employees pre
      JOIN payroll_runs pr ON pre.run_id = pr.id
      JOIN employees emp ON pre.employee_id = emp.id
      LEFT JOIN pay_groups pg ON pr.pay_group_id = pg.id
      WHERE pr.company_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
        AND pr.period_start >= ? AND pr.period_end <= ?
    `;
    const params: any[] = [companyId, startDate, endDate];

    if (payGroupsParam && payGroupsParam !== 'all') {
      const ids = payGroupsParam.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length > 0) {
        query += ` AND pr.pay_group_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }

    query += ` ORDER BY pg.name, emp.last_name, emp.first_name, payment_date`;

    const detailData = await c.env.DB.prepare(query).bind(...params).all() as any;
    const records = detailData.results || [];

    const groups: Record<string, Record<number, { employeeName: string; runs: any[] }>> = {};

    for (const rec of records) {
      const gName = rec.pay_group_name || 'Ad-hoc Runs';
      if (!groups[gName]) groups[gName] = {};
      
      const empId = rec.employee_id;
      if (!groups[gName][empId]) {
        groups[gName][empId] = {
          employeeName: `${rec.last_name}, ${rec.first_name}`,
          runs: []
        };
      }

      const payPeriod = (rec.pay_interval && rec.pay_interval !== 'company') ? rec.pay_interval : cs.pay_period;
      const taxSplit = splitTaxForEmployee(rec.gross_pay, rec.tax, payPeriod, rec);

      groups[gName][empId].runs.push({
        payDate: rec.payment_date ? rec.payment_date.split('-').reverse().join('/') : '',
        details: (rec.payment_method || 'e-Transfer').toUpperCase(),
        hours: rec.hours_worked || 0,
        gross: rec.gross_pay || 0,
        cpp: rec.cpp_employee || 0,
        qpp: 0,
        ei: rec.ei_employee || 0,
        qpip: 0,
        tax: taxSplit.fed,
        provTax: taxSplit.prov,
        otherDed: 0,
        add: 0,
        netPay: rec.net_pay || 0
      });
    }

    const resultGroups = Object.entries(groups).map(([gName, empMap]) => {
      let groupHours = 0, groupGross = 0, groupCpp = 0, groupEi = 0, groupTax = 0, groupProv = 0, groupNet = 0;
      const uniqueGroupEmployees = Object.keys(empMap).length;

      const employeeList = Object.entries(empMap).map(([empId, empObj]) => {
        const subHours = empObj.runs.reduce((sum, r) => sum + r.hours, 0);
        const subGross = empObj.runs.reduce((sum, r) => sum + r.gross, 0);
        const subCpp = empObj.runs.reduce((sum, r) => sum + r.cpp, 0);
        const subEi = empObj.runs.reduce((sum, r) => sum + r.ei, 0);
        const subTax = empObj.runs.reduce((sum, r) => sum + r.tax, 0);
        const subProv = empObj.runs.reduce((sum, r) => sum + r.provTax, 0);
        const subNet = empObj.runs.reduce((sum, r) => sum + r.netPay, 0);

        groupHours += subHours;
        groupGross += subGross;
        groupCpp += subCpp;
        groupEi += subEi;
        groupTax += subTax;
        groupProv += subProv;
        groupNet += subNet;

        return {
          employeeId: Number(empId),
          employeeName: empObj.employeeName,
          runs: empObj.runs,
          subtotals: {
            hours: Math.round(subHours * 100) / 100,
            gross: Math.round(subGross * 100) / 100,
            cpp: Math.round(subCpp * 100) / 100,
            qpp: 0,
            ei: Math.round(subEi * 100) / 100,
            qpip: 0,
            tax: Math.round(subTax * 100) / 100,
            provTax: Math.round(subProv * 100) / 100,
            otherDed: 0,
            add: 0,
            netPay: Math.round(subNet * 100) / 100
          }
        };
      });

      return {
        payGroupName: gName,
        employees: employeeList,
        totals: {
          employeeCount: uniqueGroupEmployees,
          hours: Math.round(groupHours * 100) / 100,
          gross: Math.round(groupGross * 100) / 100,
          cpp: Math.round(groupCpp * 100) / 100,
          qpp: 0,
          ei: Math.round(groupEi * 100) / 100,
          qpip: 0,
          tax: Math.round(groupTax * 100) / 100,
          provTax: Math.round(groupProv * 100) / 100,
          otherDed: 0,
          add: 0,
          netPay: Math.round(groupNet * 100) / 100
        }
      };
    });

    const grandTotals = {
      employeeCount: new Set(records.map((r: any) => r.employee_id)).size,
      hours: Math.round(records.reduce((sum: number, r: any) => sum + (r.hours_worked || 0), 0) * 100) / 100,
      gross: Math.round(records.reduce((sum: number, r: any) => sum + (r.gross_pay || 0), 0) * 100) / 100,
      cpp: Math.round(records.reduce((sum: number, r: any) => sum + (r.cpp_employee || 0), 0) * 100) / 100,
      qpp: 0,
      ei: Math.round(records.reduce((sum: number, r: any) => sum + (r.ei_employee || 0), 0) * 100) / 100,
      qpip: 0,
      tax: Math.round(resultGroups.reduce((sum, g) => sum + g.totals.tax, 0) * 100) / 100,
      provTax: Math.round(resultGroups.reduce((sum, g) => sum + g.totals.provTax, 0) * 100) / 100,
      otherDed: 0,
      add: 0,
      netPay: Math.round(records.reduce((sum: number, r: any) => sum + (r.net_pay || 0), 0) * 100) / 100
    };

    const reportData = {
      companyName: cs.legal_name,
      startDate: formatDateFull(startDate),
      endDate: formatDateFull(endDate),
      groups: resultGroups,
      grandTotals
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Period:', value: `From ${reportData.startDate} to ${reportData.endDate}` }
    ];
    drawReportHeader(doc, 'Payroll detail', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();

    const drawTableHeader = (cy: number) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor('#43474f');
      doc.text('Pay date\n(MM/DD/YYYY)', 50, cy - 5);
      doc.text('Details', 110, cy);
      doc.text('Hours', 170, cy, { align: 'right' });
      doc.text('Gross', 230, cy, { align: 'right' });
      doc.text('CPP', 280, cy, { align: 'right' });
      doc.text('QPP', 330, cy, { align: 'right' });
      doc.text('EI', 380, cy, { align: 'right' });
      doc.text('QPIP', 430, cy, { align: 'right' });
      doc.text('Tax', 485, cy, { align: 'right' });
      doc.text('Prov. tax', 545, cy, { align: 'right' });
      doc.text('Other ded.', 615, cy, { align: 'right' });
      doc.text('Add.', 675, cy, { align: 'right' });
      doc.text('Net pay', pageWidth - 50, cy, { align: 'right' });

      cy += 12;
      doc.setDrawColor('#c3c6d1');
      doc.setLineWidth(0.5);
      doc.line(50, cy, pageWidth - 50, cy);
      return cy + 12;
    };

    y = drawTableHeader(y);

    for (const g of reportData.groups) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor('#0b1c30');
      doc.text(g.payGroupName, 50, y);
      y += 15;

      for (const emp of g.employees) {
        if (y > doc.internal.pageSize.getHeight() - 80) {
          doc.addPage();
          drawReportHeader(doc, 'Payroll detail', reportData.companyName, metadata, brandColor);
          y = drawTableHeader(135);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(emp.employeeName, 50, y);
        y += 12;

        doc.setFont('helvetica', 'normal');
        for (const r of emp.runs) {
          if (y > doc.internal.pageSize.getHeight() - 80) {
            doc.addPage();
            drawReportHeader(doc, 'Payroll detail', reportData.companyName, metadata, brandColor);
            y = drawTableHeader(135);
            doc.setFont('helvetica', 'bold');
            doc.text(`${emp.employeeName} (continued)`, 50, y);
            y += 12;
            doc.setFont('helvetica', 'normal');
          }

          doc.text(r.payDate, 50, y);
          doc.text(r.details, 110, y);
          doc.text(r.hours > 0 ? (Math.round(r.hours * 100) / 100).toFixed(2) : '0.00', 170, y, { align: 'right' });
          doc.text(formatReportCurrency(r.gross), 230, y, { align: 'right' });
          doc.text(formatReportCurrency(r.cpp), 280, y, { align: 'right' });
          doc.text(formatReportCurrency(r.qpp), 330, y, { align: 'right' });
          doc.text(formatReportCurrency(r.ei), 380, y, { align: 'right' });
          doc.text(formatReportCurrency(r.qpip), 430, y, { align: 'right' });
          doc.text(formatReportCurrency(r.tax), 485, y, { align: 'right' });
          doc.text(formatReportCurrency(r.provTax), 545, y, { align: 'right' });
          doc.text(formatReportCurrency(r.otherDed), 615, y, { align: 'right' });
          doc.text(formatReportCurrency(r.add), 675, y, { align: 'right' });
          doc.text(formatReportCurrency(r.netPay), pageWidth - 50, y, { align: 'right' });
          y += 12;
        }

        if (emp.runs.length > 1) {
          y += 5;
          doc.setLineWidth(0.5);
          doc.line(140, y, pageWidth - 50, y);
          y += 12;
          doc.setFont('helvetica', 'bold');
          doc.text('Subtotal', 110, y);
          
          doc.text(emp.subtotals.hours > 0 ? (Math.round(emp.subtotals.hours * 100) / 100).toFixed(2) : '0.00', 170, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.gross), 230, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.cpp), 280, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.qpp), 330, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.ei), 380, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.qpip), 430, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.tax), 485, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.provTax), 545, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.otherDed), 615, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.add), 675, y, { align: 'right' });
          doc.text(formatReportCurrency(emp.subtotals.netPay), pageWidth - 50, y, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          y += 15;
        } else {
          y += 5;
        }
      }

      y += 5;
      doc.setLineWidth(1);
      doc.line(50, y, pageWidth - 50, y);
      y += 12;
      doc.setFont('helvetica', 'bold');
      doc.text(`${g.payGroupName} Total`, 50, y);
      
      doc.text(g.totals.hours > 0 ? (Math.round(g.totals.hours * 100) / 100).toFixed(2) : '0.00', 170, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.gross), 230, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.cpp), 280, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.qpp), 330, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.ei), 380, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.qpip), 430, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.tax), 485, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.provTax), 545, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.otherDed), 615, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.add), 675, y, { align: 'right' });
      doc.text(formatReportCurrency(g.totals.netPay), pageWidth - 50, y, { align: 'right' });

      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(`Employees: ${g.totals.employeeCount}`, 110, y);
      y += 20;
    }

    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      drawReportHeader(doc, 'Payroll detail', reportData.companyName, metadata, brandColor);
      y = drawTableHeader(135);
    }
    
    y += 5;
    doc.setLineWidth(1.5);
    doc.line(50, y, pageWidth - 50, y);
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.text('Grand Total', 50, y);
    
    doc.text(reportData.grandTotals.hours > 0 ? (Math.round(reportData.grandTotals.hours * 100) / 100).toFixed(2) : '0.00', 170, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.gross), 230, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.cpp), 280, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.qpp), 330, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.ei), 380, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.qpip), 430, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.tax), 485, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.provTax), 545, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.otherDed), 615, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.add), 675, y, { align: 'right' });
    doc.text(formatReportCurrency(reportData.grandTotals.netPay), pageWidth - 50, y, { align: 'right' });

    y += 12;
    doc.text(`Employees: ${reportData.grandTotals.employeeCount}`, 110, y);
    
    y += 8;
    doc.line(50, y, pageWidth - 50, y);
    doc.line(50, y + 2, pageWidth - 50, y + 2); // double underline

    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=payroll_detail_report.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 10. Payroll variance report
router.get('/payroll-variance', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const runId = c.req.query('run_id');
    const format = c.req.query('format');

    if (!runId) return c.json({ error: 'Missing run_id parameter' }, 400);

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    const run = await c.env.DB.prepare(`
      SELECT pr.*, cs.legal_name, cs.pay_period as company_pay_period, pg.name as pay_group_name
      FROM payroll_runs pr
      JOIN company_settings cs ON pr.company_id = cs.id
      LEFT JOIN pay_groups pg ON pr.pay_group_id = pg.id
      WHERE pr.id = ? AND pr.company_id = ?
    `).bind(runId, companyId).first() as any;

    if (!run) return c.json({ error: 'Payroll run not found' }, 404);

    const currentRunEmployees = await c.env.DB.prepare(`
      SELECT pre.*, emp.first_name, emp.last_name, emp.pay_type, emp.rate, emp.pay_interval, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount
      FROM payroll_run_employees pre
      JOIN employees emp ON pre.employee_id = emp.id
      WHERE pre.run_id = ?
    `).bind(run.id).all() as any;
    const currentList = currentRunEmployees.results || [];

    const prevRun = await c.env.DB.prepare(`
      SELECT pr.*
      FROM payroll_runs pr
      WHERE pr.company_id = ? AND pr.pay_group_id = ? AND (pr.status = 'finalized' OR pr.status = 'paid')
        AND (pr.run_date < ? OR (pr.run_date = ? AND pr.id < ?))
      ORDER BY pr.run_date DESC, pr.id DESC
      LIMIT 1
    `).bind(companyId, run.pay_group_id, run.run_date, run.run_date, run.id).first() as any;

    let prevList: any[] = [];
    if (prevRun) {
      const prevRunEmployees = await c.env.DB.prepare(`
        SELECT pre.*, emp.first_name, emp.last_name, emp.pay_type, emp.rate, emp.pay_interval, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount
        FROM payroll_run_employees pre
        JOIN employees emp ON pre.employee_id = emp.id
        WHERE pre.run_id = ?
      `).bind(prevRun.id).all() as any;
      prevList = prevRunEmployees.results || [];
    }

    const payPeriod = run.company_pay_period;

    const getListTotals = (list: any[]) => {
      let salary = 0, hourly = 0, commission = 0, vacation = 0, earningsTotal = 0;
      let cpp = 0, fedTax = 0, provTax = 0, taxTotal = 0;
      let cppEmployer = 0, eiEmployer = 0, wsib = 0, eht = 0, otherExpTotal = 0;
      let netPay = 0, salaryCost = 0;

      for (const re of list) {
        const rePeriod = (re.pay_interval && re.pay_interval !== 'company') ? re.pay_interval : payPeriod;
        
        const salLine = re.pay_type === 'hourly' ? 0 : re.rate;
        const hourlyLine = re.pay_type === 'hourly' ? (re.hours_worked || 0) * re.rate : 0;
        const commLine = re.pay_type === 'salary_commission' ? (re.additional_commission || 0) : 0;
        const vacPaid = re.vacation_paid || 0;
        
        const eTotal = salLine + hourlyLine + commLine + vacPaid;
        const taxSplit = splitTaxForEmployee(re.gross_pay, re.tax, rePeriod, re);

        salary += salLine;
        hourly += hourlyLine;
        commission += commLine;
        vacation += vacPaid;
        earningsTotal += eTotal;

        cpp += re.cpp_employee || 0;
        fedTax += taxSplit.fed;
        provTax += taxSplit.prov;
        taxTotal += (re.cpp_employee || 0) + taxSplit.fed + taxSplit.prov;

        cppEmployer += re.cpp_employer || 0;
        eiEmployer += re.ei_employer || 0;
        wsib += re.wsib_premium || 0;
        eht += re.eht_premium || 0;
        otherExpTotal += (re.cpp_employer || 0) + (re.ei_employer || 0) + (re.wsib_premium || 0) + (re.eht_premium || 0);

        netPay += re.net_pay || 0;
        salaryCost += eTotal + (re.cpp_employer || 0) + (re.ei_employer || 0) + (re.wsib_premium || 0) + (re.eht_premium || 0);
      }

      return {
        salary, hourly, commission, vacation, earningsTotal,
        cpp, fedTax, provTax, taxTotal,
        cppEmployer, eiEmployer, wsib, eht, otherExpTotal,
        netPay, salaryCost
      };
    };

    const currTotals = getListTotals(currentList);
    const prevTotals = getListTotals(prevList);

    const reportData = {
      companyName: run.legal_name,
      payGroup: run.pay_group_name || 'Ad-hoc Run',
      periodStart: run.period_start,
      periodEnd: run.period_end,
      totals: {
        prev: {
          salary: Math.round(prevTotals.salary * 100) / 100,
          hourly: Math.round(prevTotals.hourly * 100) / 100,
          commission: Math.round(prevTotals.commission * 100) / 100,
          vacation: Math.round(prevTotals.vacation * 100) / 100,
          earningsTotal: Math.round(prevTotals.earningsTotal * 100) / 100,
          cpp: Math.round(prevTotals.cpp * 100) / 100,
          fedTax: Math.round(prevTotals.fedTax * 100) / 100,
          provTax: Math.round(prevTotals.provTax * 100) / 100,
          taxTotal: Math.round(prevTotals.taxTotal * 100) / 100,
          cppEmployer: Math.round(prevTotals.cppEmployer * 100) / 100,
          eiEmployer: Math.round(prevTotals.eiEmployer * 100) / 100,
          wsib: Math.round(prevTotals.wsib * 100) / 100,
          eht: Math.round(prevTotals.eht * 100) / 100,
          otherExpTotal: Math.round(prevTotals.otherExpTotal * 100) / 100,
          netPay: Math.round(prevTotals.netPay * 100) / 100,
          salaryCost: Math.round(prevTotals.salaryCost * 100) / 100
        },
        curr: {
          salary: Math.round(currTotals.salary * 100) / 100,
          hourly: Math.round(currTotals.hourly * 100) / 100,
          commission: Math.round(currTotals.commission * 100) / 100,
          vacation: Math.round(currTotals.vacation * 100) / 100,
          earningsTotal: Math.round(currTotals.earningsTotal * 100) / 100,
          cpp: Math.round(currTotals.cpp * 100) / 100,
          fedTax: Math.round(currTotals.fedTax * 100) / 100,
          provTax: Math.round(currTotals.provTax * 100) / 100,
          taxTotal: Math.round(currTotals.taxTotal * 100) / 100,
          cppEmployer: Math.round(currTotals.cppEmployer * 100) / 100,
          eiEmployer: Math.round(currTotals.eiEmployer * 100) / 100,
          wsib: Math.round(currTotals.wsib * 100) / 100,
          eht: Math.round(currTotals.eht * 100) / 100,
          otherExpTotal: Math.round(currTotals.otherExpTotal * 100) / 100,
          netPay: Math.round(currTotals.netPay * 100) / 100,
          salaryCost: Math.round(currTotals.salaryCost * 100) / 100
        },
        var: {
          salary: Math.round((currTotals.salary - prevTotals.salary) * 100) / 100,
          hourly: Math.round((currTotals.hourly - prevTotals.hourly) * 100) / 100,
          commission: Math.round((currTotals.commission - prevTotals.commission) * 100) / 100,
          vacation: Math.round((currTotals.vacation - prevTotals.vacation) * 100) / 100,
          earningsTotal: Math.round((currTotals.earningsTotal - prevTotals.earningsTotal) * 100) / 100,
          cpp: Math.round((currTotals.cpp - prevTotals.cpp) * 100) / 100,
          fedTax: Math.round((currTotals.fedTax - prevTotals.fedTax) * 100) / 100,
          provTax: Math.round((currTotals.provTax - prevTotals.provTax) * 100) / 100,
          taxTotal: Math.round((currTotals.taxTotal - prevTotals.taxTotal) * 100) / 100,
          cppEmployer: Math.round((currTotals.cppEmployer - prevTotals.cppEmployer) * 100) / 100,
          eiEmployer: Math.round((currTotals.eiEmployer - prevTotals.eiEmployer) * 100) / 100,
          wsib: Math.round((currTotals.wsib - prevTotals.wsib) * 100) / 100,
          eht: Math.round((currTotals.eht - prevTotals.eht) * 100) / 100,
          otherExpTotal: Math.round((currTotals.otherExpTotal - prevTotals.otherExpTotal) * 100) / 100,
          netPay: Math.round((currTotals.netPay - prevTotals.netPay) * 100) / 100,
          salaryCost: Math.round((currTotals.salaryCost - prevTotals.salaryCost) * 100) / 100
        }
      }
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const metadata = [
      { label: 'Pay run start:', value: run.period_start },
      { label: 'Pay run end:', value: run.period_end },
      { label: 'Pay group:', value: reportData.payGroup }
    ];
    drawReportHeader(doc, 'Payroll variance', reportData.companyName, metadata, brandColor);

    let y = 135;
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor('#43474f');
    doc.text('Previous period', 320, y, { align: 'right' });
    doc.text('This period', 420, y, { align: 'right' });
    doc.text('Variance', pageWidth - 50, y, { align: 'right' });

    y += 8;
    doc.setDrawColor('#0b1c30');
    doc.setLineWidth(1);
    doc.line(50, y, pageWidth - 50, y);
    y += 14;

    const drawRow = (label: string, prev: number, curr: number, valVar: number, isBold: boolean = false) => {
      if (isBold) {
        doc.setFont('helvetica', 'bold');
        doc.setLineWidth(0.5);
        doc.line(260, y - 8, pageWidth - 50, y - 8);
      } else {
        doc.setFont('helvetica', 'normal');
      }
      doc.text(label, 50, y);
      doc.text(formatReportCurrency(prev), 320, y, { align: 'right' });
      doc.text(formatReportCurrency(curr), 420, y, { align: 'right' });
      doc.text(formatReportCurrency(valVar), pageWidth - 50, y, { align: 'right' });
      y += 14;
    };

    const d = reportData.totals;

    doc.setFont('helvetica', 'bold');
    doc.text('Earnings', 50, y);
    y += 14;
    if (d.curr.salary > 0 || d.prev.salary > 0) {
      drawRow('Salary', d.prev.salary, d.curr.salary, d.var.salary);
    }
    if (d.curr.hourly > 0 || d.prev.hourly > 0) {
      drawRow('Hourly', d.prev.hourly, d.curr.hourly, d.var.hourly);
    }
    if (d.curr.commission > 0 || d.prev.commission > 0) {
      drawRow('Commission', d.prev.commission, d.curr.commission, d.var.commission);
    }
    if (d.curr.vacation > 0 || d.prev.vacation > 0) {
      drawRow('Vacation', d.prev.vacation, d.curr.vacation, d.var.vacation);
    }
    drawRow('Total earnings', d.prev.earningsTotal, d.curr.earningsTotal, d.var.earningsTotal, true);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Tax', 50, y);
    y += 14;
    drawRow('CPP (employee contribution)', d.prev.cpp, d.curr.cpp, d.var.cpp);
    drawRow('Federal income tax', d.prev.fedTax, d.curr.fedTax, d.var.fedTax);
    drawRow('Ontario component of FIT', d.prev.provTax, d.curr.provTax, d.var.provTax);
    drawRow('Total tax', d.prev.taxTotal, d.curr.taxTotal, d.var.taxTotal, true);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Other expenses', 50, y);
    y += 14;
    drawRow('CPP (employer contribution)', d.prev.cppEmployer, d.curr.cppEmployer, d.var.cppEmployer);
    if (d.curr.eiEmployer > 0 || d.prev.eiEmployer > 0) {
      drawRow('EI (employer contribution)', d.prev.eiEmployer, d.curr.eiEmployer, d.var.eiEmployer);
    }
    if (d.curr.wsib > 0 || d.prev.wsib > 0) {
      drawRow('WSIB premium', d.prev.wsib, d.curr.wsib, d.var.wsib);
    }
    if (d.curr.eht > 0 || d.prev.eht > 0) {
      drawRow('EHT premium', d.prev.eht, d.curr.eht, d.var.eht);
    }
    drawRow('Total other expenses', d.prev.otherExpTotal, d.curr.otherExpTotal, d.var.otherExpTotal, true);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Other totals', 50, y);
    y += 14;
    drawRow('Net pay', d.prev.netPay, d.curr.netPay, d.var.netPay);
    drawRow('Total salary cost', d.prev.salaryCost, d.curr.salaryCost, d.var.salaryCost, true);

    y += 15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('* Indicates the period where YTD values have been captured.', 50, y);
    y += 12;
    doc.setFont('helvetica', 'italic');
    doc.text('¹ One or more calculated values in this transaction have been modified by a user', 50, y);

    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=payroll_variance_report_${runId}.pdf`
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// 11. Year to Date Detail report
router.get('/ytd-detail', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);
    
    const userPayload = c.get('jwtPayload') as any;
    const userEmail = userPayload?.email || 'unknown';

    const yearParam = c.req.query('tax_year');
    const payGroupsParam = c.req.query('pay_group_ids');
    const employeeIdParam = c.req.query('employee_id');
    const format = c.req.query('format');

    if (!yearParam) {
      return c.json({ error: 'Missing tax_year parameter' }, 400);
    }
    const year = Number(yearParam);

    const cs = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?').bind(companyId).first() as any;
    if (!cs) return c.json({ error: 'Company settings not found' }, 404);
    const brandColor = cs.use_company_branding ? cs.brand_color : null;

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    let query = `
      SELECT pre.*, emp.first_name, emp.last_name, emp.pay_type, emp.rate, emp.pay_interval, emp.start_date, emp.tax_exempt, emp.fit_exempt, emp.fit_withholding_amount, emp.override_fed_tax_credit, emp.fed_tax_credit_amount, emp.override_prov_tax_credit, emp.prov_tax_credit_amount,
             pr.run_date, pr.run_date AS payment_date, pr.period_start, pr.period_end, pg.name as pay_group_name, pg.id as pay_group_id
      FROM payroll_run_employees pre
      JOIN payroll_runs pr ON pre.run_id = pr.id
      JOIN employees emp ON pre.employee_id = emp.id
      LEFT JOIN pay_groups pg ON pr.pay_group_id = pg.id
      WHERE pr.company_id = ? AND (pre.status = 'finalized' OR pre.status = 'paid')
        AND pr.run_date >= ? AND pr.run_date <= ?
    `;
    const params: any[] = [companyId, yearStart, yearEnd];

    if (payGroupsParam && payGroupsParam !== 'all') {
      const ids = payGroupsParam.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length > 0) {
        query += ` AND pr.pay_group_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }

    if (employeeIdParam && employeeIdParam !== 'all') {
      query += ` AND pre.employee_id = ?`;
      params.push(Number(employeeIdParam));
    }

    const runEmployees = await c.env.DB.prepare(query).bind(...params).all() as any;
    const records = runEmployees.results || [];

    const aggregateRecords = (recs: any[]) => {
      const earnings = {
        salary: Array(12).fill(0),
        hourly: Array(12).fill(0),
        commission: Array(12).fill(0),
        vacation: Array(12).fill(0)
      };
      const tax = {
        cpp: Array(12).fill(0),
        ei: Array(12).fill(0),
        fed: Array(12).fill(0),
        prov: Array(12).fill(0)
      };
      const otherExpenses = {
        cppEmployer: Array(12).fill(0),
        eiEmployer: Array(12).fill(0),
        wsib: Array(12).fill(0),
        eht: Array(12).fill(0)
      };
      const otherTotals = {
        netPay: Array(12).fill(0),
        salaryCost: Array(12).fill(0)
      };

      for (const rec of recs) {
        const month = Number(rec.run_date.split('-')[1]) - 1;
        if (month < 0 || month > 11) continue;

        const payPeriod = (rec.pay_interval && rec.pay_interval !== 'company') ? rec.pay_interval : cs.pay_period;
        const taxSplit = splitTaxForEmployee(rec.gross_pay, rec.tax, payPeriod, rec);

        const salaryVal = rec.pay_type === 'hourly' ? 0 : rec.rate;
        const hourlyVal = rec.pay_type === 'hourly' ? (rec.hours_worked || 0) * rec.rate : 0;
        const commissionVal = rec.pay_type === 'salary_commission' ? (rec.additional_commission || 0) : 0;
        const vacationVal = rec.vacation_paid || 0;

        earnings.salary[month] += salaryVal;
        earnings.hourly[month] += hourlyVal;
        earnings.commission[month] += commissionVal;
        earnings.vacation[month] += vacationVal;

        tax.cpp[month] += rec.cpp_employee || 0;
        tax.ei[month] += rec.ei_employee || 0;
        tax.fed[month] += taxSplit.fed || 0;
        tax.prov[month] += taxSplit.prov || 0;

        otherExpenses.cppEmployer[month] += rec.cpp_employer || 0;
        otherExpenses.eiEmployer[month] += rec.ei_employer || 0;
        otherExpenses.wsib[month] += rec.wsib_premium || 0;
        otherExpenses.eht[month] += rec.eht_premium || 0;

        otherTotals.netPay[month] += rec.net_pay || 0;
        otherTotals.salaryCost[month] += (rec.gross_pay || 0) + (rec.cpp_employer || 0) + (rec.ei_employer || 0) + (rec.wsib_premium || 0) + (rec.eht_premium || 0);
      }

      const makeRow = (name: string, arr: number[]) => {
        const monthly = arr.map(v => Math.round(v * 100) / 100);
        const total = Math.round(arr.reduce((sum, v) => sum + v, 0) * 100) / 100;
        return { name, monthly, total };
      };

      const earningsRows = [
        makeRow('Salary', earnings.salary),
        makeRow('Hourly Wages', earnings.hourly),
        makeRow('Commission', earnings.commission),
        makeRow('Vacation Paid Out', earnings.vacation)
      ].filter(r => r.total > 0 || r.name === 'Salary');

      const taxRows = [
        makeRow('CPP (employee contribution)', tax.cpp),
        makeRow('EI (employee contribution)', tax.ei),
        makeRow('Federal income tax', tax.fed),
        makeRow('Ontario component of FIT', tax.prov)
      ].filter(r => r.total > 0 || r.name.includes('CPP') || r.name.includes('Federal') || r.name.includes('FIT'));

      const expenseRows = [
        makeRow('CPP (employer contribution)', otherExpenses.cppEmployer),
        makeRow('EI (employer contribution)', otherExpenses.eiEmployer),
        makeRow('WSIB premium', otherExpenses.wsib),
        makeRow('EHT premium', otherExpenses.eht)
      ].filter(r => r.total > 0 || r.name.includes('CPP'));

      const earningsTotal = makeRow('Total earnings', Array(12).fill(0).map((_, m) => 
        earningsRows.reduce((sum, r) => sum + r.monthly[m], 0)
      ));
      
      const taxTotal = makeRow('Total tax', Array(12).fill(0).map((_, m) => 
        taxRows.reduce((sum, r) => sum + r.monthly[m], 0)
      ));

      const otherExpensesTotal = makeRow('Total other expenses', Array(12).fill(0).map((_, m) => 
        expenseRows.reduce((sum, r) => sum + r.monthly[m], 0)
      ));

      const netPayRow = makeRow('Net pay', otherTotals.netPay);
      const salaryCostRow = makeRow('Total salary cost', otherTotals.salaryCost);

      return {
        earnings: earningsRows,
        earningsTotal,
        tax: taxRows,
        taxTotal,
        otherExpenses: expenseRows,
        otherExpensesTotal,
        netPay: netPayRow,
        salaryCost: salaryCostRow
      };
    };

    const employeesData: any[] = [];
    const groupedByEmp: Record<number, any[]> = {};
    for (const rec of records) {
      if (!groupedByEmp[rec.employee_id]) groupedByEmp[rec.employee_id] = [];
      groupedByEmp[rec.employee_id].push(rec);
    }

    const empIds = Object.keys(groupedByEmp).map(Number);
    const empDetailsMap: Record<number, { name: string; code: string; startDate: string }> = {};
    for (const rec of records) {
      empDetailsMap[rec.employee_id] = {
        name: `${rec.last_name}, ${rec.first_name}`,
        code: rec.employee_id ? 'EMP-' + String(rec.employee_id).padStart(3, '0') : 'N/A',
        startDate: rec.start_date ? rec.start_date.split('-').reverse().join('/') : ''
      };
    }

    const sortedEmpIds = empIds.sort((a, b) => 
      empDetailsMap[a].name.localeCompare(empDetailsMap[b].name)
    );

    for (const empId of sortedEmpIds) {
      const empRecs = groupedByEmp[empId];
      const details = empDetailsMap[empId];
      const aggregated = aggregateRecords(empRecs);
      employeesData.push({
        employeeId: empId,
        employeeName: details.name,
        employeeCode: details.code,
        startDate: details.startDate,
        ...aggregated
      });
    }

    const payGroupTotals: any[] = [];
    const groupedByPg: Record<string, any[]> = {};
    for (const rec of records) {
      const pgName = rec.pay_group_name || 'Ad-hoc Runs';
      if (!groupedByPg[pgName]) groupedByPg[pgName] = [];
      groupedByPg[pgName].push(rec);
    }

    for (const [pgName, pgRecs] of Object.entries(groupedByPg)) {
      const aggregated = aggregateRecords(pgRecs);
      payGroupTotals.push({
        payGroupName: pgName,
        ...aggregated
      });
    }

    const reportTotals = aggregateRecords(records);

    let payGroupSelection = 'All pay groups';
    if (payGroupsParam && payGroupsParam !== 'all') {
      const ids = payGroupsParam.split(',');
      if (ids.length === 1) {
        const pg = await c.env.DB.prepare('SELECT name FROM pay_groups WHERE id = ?').bind(Number(ids[0])).first() as any;
        if (pg) payGroupSelection = pg.name;
      } else {
        payGroupSelection = 'Multiple groups';
      }
    }

    let employeeSelection = 'All employees';
    if (employeeIdParam && employeeIdParam !== 'all') {
      const emp = await c.env.DB.prepare('SELECT first_name, last_name FROM employees WHERE id = ?').bind(Number(employeeIdParam)).first() as any;
      if (emp) employeeSelection = `${emp.last_name}, ${emp.first_name}`;
    }

    const reportData = {
      companyName: cs.legal_name,
      year,
      payGroupSelection,
      employeeSelection,
      employees: employeesData,
      payGroupTotals,
      reportTotals
    };

    if (format !== 'pdf') {
      return c.json(reportData);
    }

    // Generate jsPDF landscape report
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    
    let isFirstPage = true;

    const drawSheet = (
      title: string,
      details: { name: string; code?: string; startDate?: string },
      data: any
    ) => {
      if (!isFirstPage) {
        doc.addPage();
      }
      isFirstPage = false;

      drawReportHeader(doc, 'Year to date detail', reportData.companyName, [
        { label: 'Tax Year:', value: String(year) },
        { label: 'Pay Group:', value: reportData.payGroupSelection },
        { label: 'Employee selection:', value: reportData.employeeSelection }
      ], brandColor);

      let y = 135;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor('#1e1f22');

      if (details.code) {
        doc.text(`Employee code: ${details.code}`, 50, y);
      }
      doc.text(`${title}: ${details.name}`, 220, y);
      if (details.startDate) {
        doc.text(`Start date: ${details.startDate}`, 50, y + 15);
      }
      y += 30;

      // Draw table header box
      doc.setFillColor('#f4f4f7');
      doc.rect(40, y, 712, 16, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor('#43474f');
      doc.text('Pay component', 45, y + 11);

      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      for (let m = 0; m < 12; m++) {
        doc.text(months[m], 40 + 180 + m * 38 + 35, y + 11, { align: 'right' });
      }
      doc.text('Total', 792 - 45, y + 11, { align: 'right' });

      doc.setDrawColor('#c4c7c5');
      doc.setLineWidth(0.5);
      doc.line(40, y + 16, 752, y + 16);
      y += 24;

      const drawRow = (rowName: string, monthly: number[], total: number, isBold = false) => {
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setFontSize(7);
        doc.setTextColor(isBold ? '#1e1f22' : '#43474f');
        
        const indent = isBold ? 45 : 55;
        doc.text(rowName, indent, y);

        for (let m = 0; m < 12; m++) {
          doc.text(formatReportCurrency(monthly[m]), 40 + 180 + m * 38 + 35, y, { align: 'right' });
        }
        doc.text(formatReportCurrency(total), 792 - 45, y, { align: 'right' });

        if (isBold) {
          doc.setDrawColor('#e3e3e3');
          doc.line(40, y + 3, 752, y + 3);
        }
        y += 12;
      };

      const drawSection = (sectionName: string, rows: any[], totalRow: any) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor('#1e1f22');
        doc.text(sectionName, 45, y);
        y += 12;

        for (const row of rows) {
          drawRow(row.name, row.monthly, row.total, false);
        }
        drawRow(totalRow.name, totalRow.monthly, totalRow.total, true);
        y += 4;
      };

      drawSection('Earnings', data.earnings, data.earningsTotal);
      drawSection('Tax', data.tax, data.taxTotal);
      drawSection('Other expenses', data.otherExpenses, data.otherExpensesTotal);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor('#1e1f22');
      doc.text('Other totals', 45, y);
      y += 12;

      drawRow(data.netPay.name, data.netPay.monthly, data.netPay.total, false);
      
      drawRow(data.salaryCost.name, data.salaryCost.monthly, data.salaryCost.total, true);
      doc.line(40, y - 8, 752, y - 8);
      doc.line(40, y - 6, 752, y - 6);

      y += 10;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor('#74777f');
      doc.text('* Indicates the period where YTD values have been captured.', 45, y);
    };

    // Draw employee sheets
    for (const emp of reportData.employees) {
      drawSheet('Employee name', { name: emp.employeeName, code: emp.employeeCode, startDate: emp.startDate }, emp);
    }

    // Draw pay group totals sheets
    for (const pg of reportData.payGroupTotals) {
      drawSheet('Pay group total', { name: pg.payGroupName }, pg);
    }

    // Draw report totals sheet
    if (reportData.employees.length > 1) {
      drawSheet('Report totals', { name: '' }, reportData.reportTotals);
    }

    const totalPages = (doc as any).internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawReportFooter(doc, userEmail, i, totalPages, cs?.use_company_branding ? `${cs.legal_name} Payroll` : 'Gitpaid Payroll', brandColor);
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=ytd_detail_report_${year}.pdf`
      }
    });

  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;


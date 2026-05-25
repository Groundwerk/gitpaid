import { Hono } from 'hono';
import { jsPDF } from 'jspdf';
import { decryptText } from '../utils/crypto';

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

  // --- Header ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor('#001e40');
  doc.text(settings.legal_name, 50, 60);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#43474f');
  doc.text(`CRA BN: ${settings.business_number}`, 50, 80);
  doc.text(`${settings.address_line1 || ''}, ${settings.city || ''}, ${settings.postal_code || ''}`, 50, 94);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor('#0059bb');
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
  doc.setTextColor('#001e40');
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
  doc.setTextColor('#001e40');
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

export default router;


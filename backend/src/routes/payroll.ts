import { Hono } from 'hono';
import { calculatePayrollDeductions, TaxInputs } from '../services/taxEngine';

const router = new Hono<{
  Bindings: {
    DB: D1Database;
  };
}>();

// Helper to get companyId from request
function getCompanyId(c: any): number {
  const payload = c.get('jwtPayload');
  return payload?.companyId;
}

// Helper to advance pay schedule on finalization
async function advancePayScheduleIfNeeded(db: any, payScheduleId: number) {
  // 1. Get current schedule
  const schedule = await db.prepare('SELECT * FROM pay_schedules WHERE id = ?')
    .bind(payScheduleId)
    .first() as any;
  if (!schedule) return;

  // 2. Get pay group
  const group = await db.prepare('SELECT * FROM pay_groups WHERE id = ?')
    .bind(schedule.pay_group_id)
    .first() as any;
  if (!group) return;

  // Parse current dates as UTC to avoid local timezone offsets
  const parseDate = (dStr: string) => {
    const [year, month, day] = dStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  };
  
  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const currentStart = parseDate(schedule.period_start);
  const currentEnd = parseDate(schedule.period_end);
  const currentPayment = parseDate(schedule.payment_date);

  const offsetTime = currentPayment.getTime() - currentEnd.getTime();
  const offsetDays = Math.round(offsetTime / (1000 * 60 * 60 * 24));

  let nextStart = new Date(currentStart.getTime());
  let nextEnd = new Date(currentEnd.getTime());
  let nextPayment = new Date(currentPayment.getTime());

  const payFrequency = group.pay_frequency;

  if (payFrequency === 'weekly') {
    nextStart.setUTCDate(nextStart.getUTCDate() + 7);
    nextEnd.setUTCDate(nextEnd.getUTCDate() + 7);
    nextPayment.setUTCDate(nextPayment.getUTCDate() + 7);
  } else if (payFrequency === 'bi-weekly') {
    nextStart.setUTCDate(nextStart.getUTCDate() + 14);
    nextEnd.setUTCDate(nextEnd.getUTCDate() + 14);
    nextPayment.setUTCDate(nextPayment.getUTCDate() + 14);
  } else if (payFrequency === 'semi-monthly') {
    const startDay = nextStart.getUTCDate();
    const startMonth = nextStart.getUTCMonth();
    const startYear = nextStart.getUTCFullYear();

    if (startDay === 1) {
      nextStart = new Date(Date.UTC(startYear, startMonth, 16));
      nextEnd = new Date(Date.UTC(startYear, startMonth + 1, 0)); // last day of month
    } else if (startDay === 16) {
      nextStart = new Date(Date.UTC(startYear, startMonth + 1, 1));
      nextEnd = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth(), 15));
    } else {
      // Fallback for custom semi-monthly days: alternate adding 15/16 days
      // Query count of schedules to get the alternating offset
      const countResult = await db.prepare('SELECT COUNT(*) as count FROM pay_schedules WHERE pay_group_id = ?')
        .bind(schedule.pay_group_id)
        .first() as any;
      const count = countResult?.count || 1;
      const daysToAdd = (count % 2 === 0) ? 15 : 16;
      nextStart.setUTCDate(nextStart.getUTCDate() + daysToAdd);
      nextEnd.setUTCDate(nextEnd.getUTCDate() + daysToAdd);
    }
    // Recompute payment date with offset
    nextPayment = new Date(nextEnd.getTime());
    nextPayment.setUTCDate(nextPayment.getUTCDate() + offsetDays);
  } else if (payFrequency === 'monthly') {
    nextStart.setUTCMonth(nextStart.getUTCMonth() + 1);
    
    const endDay = nextEnd.getUTCDate();
    const endMonth = nextEnd.getUTCMonth();
    const endYear = nextEnd.getUTCFullYear();
    const isLastDay = new Date(Date.UTC(endYear, endMonth, endDay + 1)).getUTCDate() === 1;

    if (isLastDay) {
      nextEnd = new Date(Date.UTC(endYear, endMonth + 2, 0));
    } else {
      nextEnd.setUTCMonth(nextEnd.getUTCMonth() + 1);
    }
    
    nextPayment = new Date(nextEnd.getTime());
    nextPayment.setUTCDate(nextPayment.getUTCDate() + offsetDays);
  }

  const nextStartStr = formatDate(nextStart);
  const nextEndStr = formatDate(nextEnd);
  const nextPaymentStr = formatDate(nextPayment);

  // Check if it already exists
  const exists = await db.prepare(
    'SELECT id FROM pay_schedules WHERE pay_group_id = ? AND period_start = ? AND period_end = ?'
  ).bind(schedule.pay_group_id, nextStartStr, nextEndStr).first();

  if (!exists) {
    await db.prepare(
      'INSERT INTO pay_schedules (pay_group_id, period_start, period_end, payment_date, status) VALUES (?, ?, ?, ?, \'open\')'
    ).bind(schedule.pay_group_id, nextStartStr, nextEndStr, nextPaymentStr).run();
  }
}

// Helper to roll back pay schedule on reversal
async function rollbackPayScheduleIfNeeded(db: any, payScheduleId: number) {
  const schedule = await db.prepare('SELECT * FROM pay_schedules WHERE id = ?')
    .bind(payScheduleId)
    .first() as any;
  if (!schedule) return;

  // Delete any subsequent open schedules for this pay group
  await db.prepare(
    'DELETE FROM pay_schedules WHERE pay_group_id = ? AND period_start > ? AND status = \'open\''
  ).bind(schedule.pay_group_id, schedule.period_start).run();
}

// GET /api/payroll-runs
router.get('/', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { results } = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE company_id = ? ORDER BY run_date DESC')
      .bind(companyId)
      .all();

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/payroll-runs/:id
router.get('/:id', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    const { results: employees } = await c.env.DB.prepare(
      `SELECT pre.*, e.first_name, e.last_name, e.email, e.role, e.department, e.avatar, e.pay_type, e.rate
       FROM payroll_run_employees pre
       JOIN employees e ON pre.employee_id = e.id
       WHERE pre.run_id = ? AND e.company_id = ?`
    ).bind(id, companyId).all();

    return c.json({ ...run, employees });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/payroll-runs/calculate
router.post('/calculate', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { employeesInput } = await c.req.json(); // Array of { employee_id, hours_worked, additional_commission, vacation_payout_amount }
    
    // Get company settings
    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;

    if (!settings) {
      return c.json({ error: 'Company settings not found' }, 404);
    }

    // Get current company YTD gross
    const ytdResult = await c.env.DB.prepare('SELECT SUM(ytd_gross) as total FROM employees WHERE company_id = ?')
      .bind(companyId)
      .first() as any;
    const companyYtd = ytdResult?.total || 0;

    let totalGross = 0;
    let totalNet = 0;
    let totalCppEmployee = 0;
    let totalCppEmployer = 0;
    let totalEiEmployee = 0;
    let totalEiEmployer = 0;
    let totalTax = 0;
    let totalWsib = 0;
    let totalEht = 0;
    let totalVacationAccrued = 0;

    const calculationResults = [];

    for (const input of employeesInput) {
      const emp = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
        .bind(input.employee_id, companyId)
        .first() as any;
      if (!emp) continue;

      let grossPay = 0;
      if (emp.pay_type === 'hourly') {
        const hours = parseFloat(input.hours_worked || 0);
        grossPay = hours * emp.rate;
      } else if (emp.pay_type === 'salary_commission') {
        const commission = parseFloat(input.additional_commission || 0);
        grossPay = emp.rate + commission;
      } else {
        // salary
        grossPay = emp.rate;
      }

      // Add vacation payout if specified
      const vacationPayout = parseFloat(input.vacation_payout_amount || 0);
      grossPay += vacationPayout;

      const taxInputs: TaxInputs = {
        gross: grossPay,
        ytdGross: emp.ytd_gross,
        ytdCpp: emp.ytd_cpp,
        ytdEi: emp.ytd_ei,
        ytdTax: emp.ytd_tax,
        cppExempt: emp.cpp_exempt === 1,
        eiExempt: emp.ei_exempt === 1,
        taxExempt: emp.tax_exempt === 1,
        payPeriod: (emp.pay_interval && emp.pay_interval !== 'company') ? emp.pay_interval : settings.pay_period,
        wsibRate: settings.wsib_rate,
        ehtExempt: settings.eht_exempt === 1,
        ehtRate: settings.eht_rate,
        vacationRate: settings.vacation_rate,
        companyYtdGross: companyYtd + totalGross,
        fitExempt: emp.fit_exempt === 1,
        fitWithholdingAmount: emp.fit_withholding_amount || 0.0,
        overrideFedTaxCredit: emp.override_fed_tax_credit === 1,
        fedTaxCreditAmount: emp.fed_tax_credit_amount || 15705.0,
        overrideProvTaxCredit: emp.override_prov_tax_credit === 1,
        provTaxCreditAmount: emp.prov_tax_credit_amount || 12399.0,
        wcbExempt: emp.wcb_exempt === 1,
        wcbRate: emp.wcb_rate || 0.0,
        overrideEiEmployerRate: settings.override_ei_employer_rate !== undefined ? settings.override_ei_employer_rate : 1.4
      };

      const deductions = calculatePayrollDeductions(taxInputs);

      calculationResults.push({
        employee_id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        role: emp.role,
        department: emp.department,
        avatar: emp.avatar,
        pay_type: emp.pay_type,
        rate: emp.rate,
        hours_worked: input.hours_worked || 0,
        additional_commission: input.additional_commission || 0,
        vacation_payout_amount: vacationPayout,
        gross_pay: grossPay,
        net_pay: deductions.netPay,
        cpp_employee: deductions.cppEmployee,
        cpp_employer: deductions.cppEmployer,
        ei_employee: deductions.eiEmployee,
        ei_employer: deductions.eiEmployer,
        tax: deductions.incomeTax,
        wsib_premium: deductions.wsibPremium,
        eht_premium: deductions.ehtPremium,
        vacation_accrued: deductions.vacationAccrued,
        vacation_paid: vacationPayout
      });

      totalGross += grossPay;
      totalNet += deductions.netPay;
      totalCppEmployee += deductions.cppEmployee;
      totalCppEmployer += deductions.cppEmployer;
      totalEiEmployee += deductions.eiEmployee;
      totalEiEmployer += deductions.eiEmployer;
      totalTax += deductions.incomeTax;
      totalWsib += deductions.wsibPremium;
      totalEht += deductions.ehtPremium;
      totalVacationAccrued += deductions.vacationAccrued;
    }

    return c.json({
      employees: calculationResults,
      totals: {
        totalGross: Math.round(totalGross * 100) / 100,
        totalNet: Math.round(totalNet * 100) / 100,
        totalCppEmployee: Math.round(totalCppEmployee * 100) / 100,
        totalCppEmployer: Math.round(totalCppEmployer * 100) / 100,
        totalEiEmployee: Math.round(totalEiEmployee * 100) / 100,
        totalEiEmployer: Math.round(totalEiEmployer * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        totalWsib: Math.round(totalWsib * 100) / 100,
        totalEht: Math.round(totalEht * 100) / 100,
        totalVacationAccrued: Math.round(totalVacationAccrued * 100) / 100
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/payroll-runs (Submit and pay)
router.post('/', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const {
      period_start,
      period_end,
      payment_method,
      employeesInput,
      pay_schedule_id = null,
      pay_group_id = null
    } = await c.req.json();

    // Get company settings
    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;

    if (!settings) {
      return c.json({ error: 'Company settings not found' }, 404);
    }

    // Get current company YTD gross
    const ytdResult = await c.env.DB.prepare('SELECT SUM(ytd_gross) as total FROM employees WHERE company_id = ?')
      .bind(companyId)
      .first() as any;
    const companyYtd = ytdResult?.total || 0;

    let totalGross = 0;
    let totalNet = 0;
    let totalCppEmployee = 0;
    let totalCppEmployer = 0;
    let totalEiEmployee = 0;
    let totalEiEmployer = 0;
    let totalTax = 0;
    let totalWsib = 0;
    let totalEht = 0;
    let totalVacationAccrued = 0;

    const calculatedEmployees = [];

    // Calculate deductions
    for (const input of employeesInput) {
      const emp = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
        .bind(input.employee_id, companyId)
        .first() as any;
      if (!emp) continue;

      let grossPay = 0;
      if (emp.pay_type === 'hourly') {
        const hours = parseFloat(input.hours_worked || 0);
        grossPay = hours * emp.rate;
      } else if (emp.pay_type === 'salary_commission') {
        const commission = parseFloat(input.additional_commission || 0);
        grossPay = emp.rate + commission;
      } else {
        // salary
        grossPay = emp.rate;
      }

      // Add vacation payout if specified
      const vacationPayout = parseFloat(input.vacation_payout_amount || 0);
      grossPay += vacationPayout;

      const taxInputs: TaxInputs = {
        gross: grossPay,
        ytdGross: emp.ytd_gross,
        ytdCpp: emp.ytd_cpp,
        ytdEi: emp.ytd_ei,
        ytdTax: emp.ytd_tax,
        cppExempt: emp.cpp_exempt === 1,
        eiExempt: emp.ei_exempt === 1,
        taxExempt: emp.tax_exempt === 1,
        payPeriod: (emp.pay_interval && emp.pay_interval !== 'company') ? emp.pay_interval : settings.pay_period,
        wsibRate: settings.wsib_rate,
        ehtExempt: settings.eht_exempt === 1,
        ehtRate: settings.eht_rate,
        vacationRate: settings.vacation_rate,
        companyYtdGross: companyYtd + totalGross,
        fitExempt: emp.fit_exempt === 1,
        fitWithholdingAmount: emp.fit_withholding_amount || 0.0,
        overrideFedTaxCredit: emp.override_fed_tax_credit === 1,
        fedTaxCreditAmount: emp.fed_tax_credit_amount || 15705.0,
        overrideProvTaxCredit: emp.override_prov_tax_credit === 1,
        provTaxCreditAmount: emp.prov_tax_credit_amount || 12399.0,
        wcbExempt: emp.wcb_exempt === 1,
        wcbRate: emp.wcb_rate || 0.0,
        overrideEiEmployerRate: settings.override_ei_employer_rate !== undefined ? settings.override_ei_employer_rate : 1.4
      };

      const deductions = calculatePayrollDeductions(taxInputs);

      calculatedEmployees.push({
        employee_id: emp.id,
        gross_pay: grossPay,
        net_pay: deductions.netPay,
        cpp_employee: deductions.cppEmployee,
        cpp_employer: deductions.cppEmployer,
        ei_employee: deductions.eiEmployee,
        ei_employer: deductions.eiEmployer,
        tax: deductions.incomeTax,
        wsib_premium: deductions.wsibPremium,
        eht_premium: deductions.ehtPremium,
        vacation_accrued: deductions.vacationAccrued,
        vacation_paid: vacationPayout,
        hours_worked: input.hours_worked || 0,
        payment_method: input.payment_method || emp.payment_method || payment_method || 'e-Transfer'
      });

      totalGross += grossPay;
      totalNet += deductions.netPay;
      totalCppEmployee += deductions.cppEmployee;
      totalCppEmployer += deductions.cppEmployer;
      totalEiEmployee += deductions.eiEmployee;
      totalEiEmployer += deductions.eiEmployer;
      totalTax += deductions.incomeTax;
      totalWsib += deductions.wsibPremium;
      totalEht += deductions.ehtPremium;
      totalVacationAccrued += deductions.vacationAccrued;
    }

    // 1. Insert the main payroll_runs record
    const runDate = new Date().toISOString().split('T')[0];
    const runResult = await c.env.DB.prepare(`
      INSERT INTO payroll_runs (
        company_id, run_date, period_start, period_end, total_gross, total_net,
        total_cpp_employee, total_cpp_employer, total_ei_employee, total_ei_employer,
        total_tax, total_wsib, total_eht, total_vacation_accrued, payment_method, status,
        pay_schedule_id, pay_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).bind(
      companyId,
      runDate,
      period_start,
      period_end,
      totalGross,
      totalNet,
      totalCppEmployee,
      totalCppEmployer,
      totalEiEmployee,
      totalEiEmployer,
      totalTax,
      totalWsib,
      totalEht,
      totalVacationAccrued,
      payment_method,
      pay_schedule_id ? parseInt(pay_schedule_id) : null,
      pay_group_id ? parseInt(pay_group_id) : null
    ).run();

    const runId = runResult.meta.last_row_id;
    if (!runId) {
      throw new Error('Failed to create payroll run record');
    }

    // 2. Perform D1 Batch update for employee records & junctions
    const dbStatements = [];

    for (const calEmp of calculatedEmployees) {
      dbStatements.push(
        c.env.DB.prepare(`
          INSERT INTO payroll_run_employees (
            run_id, employee_id, gross_pay, net_pay, cpp_employee, cpp_employer,
            ei_employee, ei_employer, tax, wsib_premium, eht_premium, vacation_accrued, vacation_paid, hours_worked, status, payment_method
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
        `).bind(
          runId,
          calEmp.employee_id,
          calEmp.gross_pay,
          calEmp.net_pay,
          calEmp.cpp_employee,
          calEmp.cpp_employer,
          calEmp.ei_employee,
          calEmp.ei_employer,
          calEmp.tax,
          calEmp.wsib_premium,
          calEmp.eht_premium,
          calEmp.vacation_accrued,
          calEmp.vacation_paid,
          calEmp.hours_worked,
          calEmp.payment_method
        )
      );    }

    if (dbStatements.length > 0) {
      await c.env.DB.batch(dbStatements);
    }

    return c.json({ id: runId, message: 'Payroll run successfully processed' }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/payroll-runs/:id/finalize
router.put('/:id/finalize', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first() as any;

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    if (run.status !== 'draft') {
      return c.json({ error: `Only draft payroll runs can be finalized. Current status is ${run.status}.` }, 400);
    }

    // Get all draft employees to update their YTD accumulators
    const draftEmployees = await c.env.DB.prepare('SELECT * FROM payroll_run_employees WHERE run_id = ? AND status = \'draft\'')
      .bind(id)
      .all() as any;

    const dbStatements = [];

    // 1. Mark parent run as finalized
    dbStatements.push(
      c.env.DB.prepare('UPDATE payroll_runs SET status = \'finalized\' WHERE id = ?').bind(id)
    );

    // If linked to a pay schedule, mark it as processed
    if (run.pay_schedule_id) {
      dbStatements.push(
        c.env.DB.prepare('UPDATE pay_schedules SET status = \'processed\' WHERE id = ?').bind(run.pay_schedule_id)
      );
    }

    // 2. Mark draft employees in this run as finalized
    dbStatements.push(
      c.env.DB.prepare('UPDATE payroll_run_employees SET status = \'finalized\' WHERE run_id = ? AND status = \'draft\'').bind(id)
    );

    // 3. Add to employee YTD accumulators
    for (const re of draftEmployees.results) {
      dbStatements.push(
        c.env.DB.prepare(`
          UPDATE employees SET
            ytd_gross = ytd_gross + ?,
            ytd_net = ytd_net + ?,
            ytd_cpp = ytd_cpp + ?,
            ytd_cpp_employer = ytd_cpp_employer + ?,
            ytd_ei = ytd_ei + ?,
            ytd_ei_employer = ytd_ei_employer + ?,
            ytd_tax = ytd_tax + ?,
            ytd_wsib = ytd_wsib + ?,
            ytd_eht = ytd_eht + ?,
            ytd_vacation_accrued = ytd_vacation_accrued + ?,
            ytd_vacation_paid = ytd_vacation_paid + ?
          WHERE id = ? AND company_id = ?
        `).bind(
          re.gross_pay,
          re.net_pay,
          re.cpp_employee,
          re.cpp_employer,
          re.ei_employee,
          re.ei_employer,
          re.tax,
          re.wsib_premium,
          re.eht_premium,
          re.vacation_accrued,
          re.vacation_paid,
          re.employee_id,
          companyId
        )
      );
    }

    await c.env.DB.batch(dbStatements);

    if (run.pay_schedule_id) {
      try {
        await advancePayScheduleIfNeeded(c.env.DB, run.pay_schedule_id);
      } catch (err) {
        console.error('Failed to advance pay schedule:', err);
      }
    }

    return c.json({ message: 'Payroll run successfully finalized' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/payroll-runs/:id/employees/:employeeId/finalize
router.put('/:id/employees/:employeeId/finalize', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    const employeeId = c.req.param('employeeId');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first() as any;

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    if (run.status !== 'draft') {
      return c.json({ error: `Only draft payroll runs can have individual payments finalized. Current status is ${run.status}.` }, 400);
    }

    const re = await c.env.DB.prepare(
      'SELECT * FROM payroll_run_employees WHERE run_id = ? AND employee_id = ?'
    ).bind(id, employeeId).first() as any;

    if (!re) {
      return c.json({ error: 'Employee payroll record not found for this run' }, 404);
    }

    if (re.status !== 'draft') {
      return c.json({ error: `This employee payment is already finalized or reversed. Current status is ${re.status}.` }, 400);
    }

    // Get count of remaining draft employees in this run (before finalizing this one)
    const draftCountResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM payroll_run_employees WHERE run_id = ? AND status = \'draft\''
    ).bind(id).first() as any;
    const draftCount = draftCountResult?.count || 0;

    const dbStatements = [];

    // 1. Mark the individual employee record as finalized
    dbStatements.push(
      c.env.DB.prepare('UPDATE payroll_run_employees SET status = \'finalized\' WHERE run_id = ? AND employee_id = ?')
        .bind(id, employeeId)
    );

    // 2. Add to employee's YTD accumulators
    dbStatements.push(
      c.env.DB.prepare(`
        UPDATE employees SET
          ytd_gross = ytd_gross + ?,
          ytd_net = ytd_net + ?,
          ytd_cpp = ytd_cpp + ?,
          ytd_cpp_employer = ytd_cpp_employer + ?,
          ytd_ei = ytd_ei + ?,
          ytd_ei_employer = ytd_ei_employer + ?,
          ytd_tax = ytd_tax + ?,
          ytd_wsib = ytd_wsib + ?,
          ytd_eht = ytd_eht + ?,
          ytd_vacation_accrued = ytd_vacation_accrued + ?,
          ytd_vacation_paid = ytd_vacation_paid + ?
        WHERE id = ? AND company_id = ?
      `).bind(
        re.gross_pay,
        re.net_pay,
        re.cpp_employee,
        re.cpp_employer,
        re.ei_employee,
        re.ei_employer,
        re.tax,
        re.wsib_premium,
        re.eht_premium,
        re.vacation_accrued,
        re.vacation_paid,
        employeeId,
        companyId
      )
    );

    // 3. If this is the last draft employee, mark the run itself as finalized
    if (draftCount <= 1) {
      dbStatements.push(
        c.env.DB.prepare('UPDATE payroll_runs SET status = \'finalized\' WHERE id = ?').bind(id)
      );
      if (run.pay_schedule_id) {
        dbStatements.push(
          c.env.DB.prepare('UPDATE pay_schedules SET status = \'processed\' WHERE id = ?').bind(run.pay_schedule_id)
        );
      }
    }

    await c.env.DB.batch(dbStatements);

    if (draftCount <= 1 && run.pay_schedule_id) {
      try {
        await advancePayScheduleIfNeeded(c.env.DB, run.pay_schedule_id);
      } catch (err) {
        console.error('Failed to advance pay schedule:', err);
      }
    }

    return c.json({ message: 'Employee payroll record successfully finalized' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/payroll-runs/:id/reverse
router.put('/:id/reverse', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first() as any;

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    if (run.status !== 'finalized') {
      return c.json({ error: `Only finalized payroll runs can be reversed. Current status is ${run.status}.` }, 400);
    }

    // Active period check: today's date must be within (before or equal to) the pay period end
    const todayStr = new Date().toISOString().split('T')[0];
    if (todayStr > run.period_end) {
      return c.json({ error: `Cannot reverse a payroll run outside the active pay period. Period ended on ${run.period_end}.` }, 400);
    }

    // Get active employee lines in this run to reverse their YTDs (skip already reversed ones)
    const runEmployees = await c.env.DB.prepare('SELECT * FROM payroll_run_employees WHERE run_id = ? AND status = \'finalized\'')
      .bind(id)
      .all() as any;

    const dbStatements = [];

    // Mark the run as draft (do NOT set totals to 0)
    dbStatements.push(
      c.env.DB.prepare(`
        UPDATE payroll_runs SET 
          status = 'draft'
        WHERE id = ?
      `).bind(id)
    );

    // If linked to a pay schedule, mark it as open
    if (run.pay_schedule_id) {
      dbStatements.push(
        c.env.DB.prepare('UPDATE pay_schedules SET status = \'open\' WHERE id = ?').bind(run.pay_schedule_id)
      );
    }

    // Mark all employee run records as draft
    dbStatements.push(
      c.env.DB.prepare('UPDATE payroll_run_employees SET status = \'draft\' WHERE run_id = ?').bind(id)
    );

    // Subtract each active employee's YTD values
    for (const re of runEmployees.results) {
      dbStatements.push(
        c.env.DB.prepare(`
          UPDATE employees SET
            ytd_gross = ytd_gross - ?,
            ytd_net = ytd_net - ?,
            ytd_cpp = ytd_cpp - ?,
            ytd_cpp_employer = ytd_cpp_employer - ?,
            ytd_ei = ytd_ei - ?,
            ytd_ei_employer = ytd_ei_employer - ?,
            ytd_tax = ytd_tax - ?,
            ytd_wsib = ytd_wsib - ?,
            ytd_eht = ytd_eht - ?,
            ytd_vacation_accrued = ytd_vacation_accrued - ?,
            ytd_vacation_paid = ytd_vacation_paid - ?
          WHERE id = ? AND company_id = ?
        `).bind(
          re.gross_pay,
          re.net_pay,
          re.cpp_employee,
          re.cpp_employer,
          re.ei_employee,
          re.ei_employer,
          re.tax,
          re.wsib_premium,
          re.eht_premium,
          re.vacation_accrued,
          re.vacation_paid,
          re.employee_id,
          companyId
        )
      );
    }

    await c.env.DB.batch(dbStatements);

    if (run.pay_schedule_id) {
      try {
        await rollbackPayScheduleIfNeeded(c.env.DB, run.pay_schedule_id);
      } catch (err) {
        console.error('Failed to rollback pay schedule:', err);
      }
    }

    return c.json({ message: 'Payroll run successfully reversed' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/payroll-runs/:id/employees/:employeeId/reverse
router.put('/:id/employees/:employeeId/reverse', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    const employeeId = c.req.param('employeeId');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first() as any;

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    if (run.status !== 'finalized' && run.status !== 'draft') {
      return c.json({ error: `Only draft or finalized payroll runs can have employee payments reversed. Current status is ${run.status}.` }, 400);
    }

    // Active period check: today's date must be within (before or equal to) the pay period end
    const todayStr = new Date().toISOString().split('T')[0];
    if (todayStr > run.period_end) {
      return c.json({ error: `Cannot reverse employee payment outside the active pay period. Period ended on ${run.period_end}.` }, 400);
    }

    const re = await c.env.DB.prepare(
      'SELECT * FROM payroll_run_employees WHERE run_id = ? AND employee_id = ?'
    ).bind(id, employeeId).first() as any;

    if (!re) {
      return c.json({ error: 'Employee payroll record not found for this run' }, 404);
    }

    if (re.status !== 'finalized') {
      return c.json({ error: `Only finalized employee payments can be reversed. Current status is ${re.status}.` }, 400);
    }

    const dbStatements = [];

    // 1. Mark the individual employee record as draft
    dbStatements.push(
      c.env.DB.prepare('UPDATE payroll_run_employees SET status = \'draft\' WHERE run_id = ? AND employee_id = ?')
        .bind(id, employeeId)
    );

    // 2. Subtract from employee's YTD accumulators
    dbStatements.push(
      c.env.DB.prepare(`
        UPDATE employees SET
          ytd_gross = ytd_gross - ?,
          ytd_net = ytd_net - ?,
          ytd_cpp = ytd_cpp - ?,
          ytd_cpp_employer = ytd_cpp_employer - ?,
          ytd_ei = ytd_ei - ?,
          ytd_ei_employer = ytd_ei_employer - ?,
          ytd_tax = ytd_tax - ?,
          ytd_wsib = ytd_wsib - ?,
          ytd_eht = ytd_eht - ?,
          ytd_vacation_accrued = ytd_vacation_accrued - ?,
          ytd_vacation_paid = ytd_vacation_paid - ?
        WHERE id = ? AND company_id = ?
      `).bind(
        re.gross_pay,
        re.net_pay,
        re.cpp_employee,
        re.cpp_employer,
        re.ei_employee,
        re.ei_employer,
        re.tax,
        re.wsib_premium,
        re.eht_premium,
        re.vacation_accrued,
        re.vacation_paid,
        employeeId,
        companyId
      )
    );

    // 3. Mark the run itself as draft (since it now contains a draft payment)
    dbStatements.push(
      c.env.DB.prepare('UPDATE payroll_runs SET status = \'draft\' WHERE id = ?').bind(id)
    );

    // If linked to a pay schedule, mark it as open
    if (run.pay_schedule_id) {
      dbStatements.push(
        c.env.DB.prepare('UPDATE pay_schedules SET status = \'open\' WHERE id = ?').bind(run.pay_schedule_id)
      );
    }

    await c.env.DB.batch(dbStatements);

    if (run.pay_schedule_id) {
      try {
        await rollbackPayScheduleIfNeeded(c.env.DB, run.pay_schedule_id);
      } catch (err) {
        console.error('Failed to rollback pay schedule:', err);
      }
    }

    return c.json({ message: 'Employee payroll record successfully reversed' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/payroll-runs/:id/employees/:employeeId (Edit draft payment)
router.put('/:id/employees/:employeeId', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    const employeeId = c.req.param('employeeId');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first() as any;

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    if (run.status !== 'draft') {
      return c.json({ error: 'Only draft payroll runs can be edited' }, 400);
    }

    const re = await c.env.DB.prepare(
      'SELECT * FROM payroll_run_employees WHERE run_id = ? AND employee_id = ?'
    ).bind(id, employeeId).first() as any;

    if (!re) {
      return c.json({ error: 'Employee payroll record not found for this run' }, 404);
    }

    if (re.status !== 'draft') {
      return c.json({ error: 'Only draft employee payments can be edited' }, 400);
    }

    const emp = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(employeeId, companyId)
      .first() as any;

    if (!emp) {
      return c.json({ error: 'Employee not found' }, 404);
    }

    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first() as any;

    if (!settings) {
      return c.json({ error: 'Company settings not found' }, 404);
    }

    const { hours_worked, additional_commission, vacation_payout_amount, payment_method } = await c.req.json();

    let grossPay = 0;
    if (emp.pay_type === 'hourly') {
      const hours = parseFloat(hours_worked || 0);
      grossPay = hours * emp.rate;
    } else if (emp.pay_type === 'salary_commission') {
      const commission = parseFloat(additional_commission || 0);
      grossPay = emp.rate + commission;
    } else {
      // salary
      grossPay = emp.rate;
    }

    // Add vacation payout if specified
    const vacationPayout = parseFloat(vacation_payout_amount || 0);
    grossPay += vacationPayout;

    // Get current company YTD gross
    const ytdResult = await c.env.DB.prepare('SELECT SUM(ytd_gross) as total FROM employees WHERE company_id = ?')
      .bind(companyId)
      .first() as any;
    const companyYtd = ytdResult?.total || 0;

    const taxInputs: TaxInputs = {
      gross: grossPay,
      ytdGross: emp.ytd_gross,
      ytdCpp: emp.ytd_cpp,
      ytdEi: emp.ytd_ei,
      ytdTax: emp.ytd_tax,
      cppExempt: emp.cpp_exempt === 1,
      eiExempt: emp.ei_exempt === 1,
      taxExempt: emp.tax_exempt === 1,
      payPeriod: (emp.pay_interval && emp.pay_interval !== 'company') ? emp.pay_interval : settings.pay_period,
      wsibRate: settings.wsib_rate,
      ehtExempt: settings.eht_exempt === 1,
      ehtRate: settings.eht_rate,
      vacationRate: settings.vacation_rate,
      companyYtdGross: companyYtd,
      fitExempt: emp.fit_exempt === 1,
      fitWithholdingAmount: emp.fit_withholding_amount || 0.0,
      overrideFedTaxCredit: emp.override_fed_tax_credit === 1,
      fedTaxCreditAmount: emp.fed_tax_credit_amount || 15705.0,
      overrideProvTaxCredit: emp.override_prov_tax_credit === 1,
      provTaxCreditAmount: emp.prov_tax_credit_amount || 12399.0,
      wcbExempt: emp.wcb_exempt === 1,
      wcbRate: emp.wcb_rate || 0.0,
      overrideEiEmployerRate: settings.override_ei_employer_rate !== undefined ? settings.override_ei_employer_rate : 1.4
    };

    const deductions = calculatePayrollDeductions(taxInputs);

    const dbStatements = [];

    // 1. Update individual payment record
    dbStatements.push(
      c.env.DB.prepare(`
        UPDATE payroll_run_employees SET
          gross_pay = ?,
          net_pay = ?,
          cpp_employee = ?,
          cpp_employer = ?,
          ei_employee = ?,
          ei_employer = ?,
          tax = ?,
          wsib_premium = ?,
          eht_premium = ?,
          vacation_accrued = ?,
          vacation_paid = ?,
          hours_worked = ?,
          payment_method = ?
        WHERE run_id = ? AND employee_id = ?
      `).bind(
        grossPay,
        deductions.netPay,
        deductions.cppEmployee,
        deductions.cppEmployer,
        deductions.eiEmployee,
        deductions.eiEmployer,
        deductions.incomeTax,
        deductions.wsibPremium,
        deductions.ehtPremium,
        deductions.vacationAccrued,
        vacationPayout,
        parseFloat(hours_worked || 0),
        payment_method !== undefined ? payment_method : re.payment_method,
        id,
        employeeId
      )
    );

    await c.env.DB.batch(dbStatements);

    // 2. Recalculate parent run totals
    const totals = await c.env.DB.prepare(`
      SELECT 
        SUM(gross_pay) as total_gross,
        SUM(net_pay) as total_net,
        SUM(cpp_employee) as total_cpp_employee,
        SUM(cpp_employer) as total_cpp_employer,
        SUM(ei_employee) as total_ei_employee,
        SUM(ei_employer) as total_ei_employer,
        SUM(tax) as total_tax,
        SUM(wsib_premium) as total_wsib,
        SUM(eht_premium) as total_eht,
        SUM(vacation_accrued) as total_vacation_accrued
      FROM payroll_run_employees
      WHERE run_id = ?
    `).bind(id).first() as any;

    await c.env.DB.prepare(`
      UPDATE payroll_runs SET
        total_gross = ?,
        total_net = ?,
        total_cpp_employee = ?,
        total_cpp_employer = ?,
        total_ei_employee = ?,
        total_ei_employer = ?,
        total_tax = ?,
        total_wsib = ?,
        total_eht = ?,
        total_vacation_accrued = ?
      WHERE id = ?
    `).bind(
      totals.total_gross || 0,
      totals.total_net || 0,
      totals.total_cpp_employee || 0,
      totals.total_cpp_employer || 0,
      totals.total_ei_employee || 0,
      totals.total_ei_employer || 0,
      totals.total_tax || 0,
      totals.total_wsib || 0,
      totals.total_eht || 0,
      totals.total_vacation_accrued || 0,
      id
    ).run();

    return c.json({ message: 'Employee payroll record successfully updated' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// DELETE /api/payroll-runs/:id (Delete draft run)
router.delete('/:id', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first() as any;

    if (!run) {
      return c.json({ error: 'Payroll run not found' }, 404);
    }

    if (run.status !== 'draft') {
      return c.json({ error: 'Only draft payroll runs can be deleted' }, 400);
    }

    // Verify all employee records in this run have status 'draft'
    const nonDraftCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM payroll_run_employees WHERE run_id = ? AND status != \'draft\''
    ).bind(id).first() as any;

    if (nonDraftCount && nonDraftCount.count > 0) {
      return c.json({ error: 'Cannot delete payroll run because some payments are finalized' }, 400);
    }

    const dbStatements = [
      c.env.DB.prepare('DELETE FROM payroll_run_employees WHERE run_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM payroll_runs WHERE id = ?').bind(id)
    ];

    await c.env.DB.batch(dbStatements);

    return c.json({ message: 'Payroll run successfully deleted' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;

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
      `SELECT pre.*, e.first_name, e.last_name, e.email, e.role, e.department, e.avatar
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
        payPeriod: settings.pay_period,
        wsibRate: settings.wsib_rate,
        ehtExempt: settings.eht_exempt === 1,
        ehtRate: settings.eht_rate,
        vacationRate: settings.vacation_rate,
        companyYtdGross: companyYtd + totalGross
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
      employeesInput
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
        payPeriod: settings.pay_period,
        wsibRate: settings.wsib_rate,
        ehtExempt: settings.eht_exempt === 1,
        ehtRate: settings.eht_rate,
        vacationRate: settings.vacation_rate,
        companyYtdGross: companyYtd + totalGross
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
        hours_worked: input.hours_worked || 0
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
        total_tax, total_wsib, total_eht, total_vacation_accrued, payment_method, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')
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
      payment_method
    ).run();

    const runId = runResult.meta.last_row_id;
    if (!runId) {
      throw new Error('Failed to create payroll run record');
    }

    // 2. Perform D1 Batch update for employee records & junctions
    const dbStatements = [];

    for (const calEmp of calculatedEmployees) {
      // Statement to insert individual record
      dbStatements.push(
        c.env.DB.prepare(`
          INSERT INTO payroll_run_employees (
            run_id, employee_id, gross_pay, net_pay, cpp_employee, cpp_employer,
            ei_employee, ei_employer, tax, wsib_premium, eht_premium, vacation_accrued, vacation_paid, hours_worked
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          calEmp.hours_worked
        )
      );

      // Statement to update employee YTD accumulators
      dbStatements.push(
        c.env.DB.prepare(`
          UPDATE employees SET
            ytd_gross = ytd_gross + ?,
            ytd_net = ytd_net + ?,
            ytd_cpp = ytd_cpp + ?,
            ytd_ei = ytd_ei + ?,
            ytd_tax = ytd_tax + ?,
            ytd_wsib = ytd_wsib + ?,
            ytd_eht = ytd_eht + ?,
            ytd_vacation_accrued = ytd_vacation_accrued + ?,
            ytd_vacation_paid = ytd_vacation_paid + ?
          WHERE id = ? AND company_id = ?
        `).bind(
          calEmp.gross_pay,
          calEmp.net_pay,
          calEmp.cpp_employee,
          calEmp.ei_employee,
          calEmp.tax,
          calEmp.wsib_premium,
          calEmp.eht_premium,
          calEmp.vacation_accrued,
          calEmp.vacation_paid,
          calEmp.employee_id,
          companyId
        )
      );
    }

    if (dbStatements.length > 0) {
      await c.env.DB.batch(dbStatements);
    }

    return c.json({ id: runId, message: 'Payroll run successfully processed' }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;

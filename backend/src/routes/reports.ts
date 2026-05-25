import { Hono } from 'hono';
import PDFDocument from 'pdfkit';
import { create } from 'xmlbuilder2';

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
        SUM(ytd_ei) as totalEi,
        SUM(ytd_tax) as totalTax,
        SUM(ytd_wsib) as totalWsib,
        SUM(ytd_eht) as totalEht,
        SUM(ytd_vacation_accrued) as totalVacationAccrued,
        SUM(ytd_vacation_paid) as totalVacationPaid
      FROM employees
      WHERE company_id = ?
    `).bind(companyId).first() as any;

    const gross = summary?.totalGross || 0;
    const net = summary?.totalNet || 0;
    const cpp = summary?.totalCpp || 0;
    const ei = summary?.totalEi || 0;
    const tax = summary?.totalTax || 0;
    const wsib = summary?.totalWsib || 0;
    const eht = summary?.totalEht || 0;

    const craRemittance = (cpp * 2) + (ei * 2.4) + tax;

    return c.json({
      totalGross: Math.round(gross * 100) / 100,
      totalNet: Math.round(net * 100) / 100,
      totalCpp: Math.round(cpp * 100) / 100,
      totalEi: Math.round(ei * 100) / 100,
      totalTax: Math.round(tax * 100) / 100,
      totalWsib: Math.round(wsib * 100) / 100,
      totalEht: Math.round(eht * 100) / 100,
      craRemittance: Math.round(craRemittance * 100) / 100
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

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
      `SELECT pre.*, pr.run_date, pr.period_start, pr.period_end, pr.payment_method
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

    // Build PDF Buffer asynchronously
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers: any[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        // --- Header ---
        doc.fillColor('#001e40')
           .font('Helvetica-Bold')
           .fontSize(20)
           .text(settings.legal_name, 50, 50);
        
        doc.fillColor('#43474f')
           .font('Helvetica')
           .fontSize(10)
           .text(`CRA BN: ${settings.business_number}`)
           .text(`${settings.address_line1 || ''}, ${settings.city || ''}, ${settings.postal_code || ''}`)
           .moveDown(1.5);

        // Title
        doc.fillColor('#0059bb')
           .font('Helvetica-Bold')
           .fontSize(14)
           .text('STATEMENT OF EARNINGS & DEDUCTIONS', { align: 'center' })
           .moveDown(1.5);

        // Meta Grid
        doc.fillColor('#0b1c30').font('Helvetica');
        const startY = doc.y;
        
        doc.text(`Employee: ${emp.first_name} ${emp.last_name}`, 50, startY)
           .text(`Role: ${emp.role || ''}`)
           .text(`Department: ${emp.department || ''}`);
        
        doc.text(`Pay Date: ${payrollInfo.run_date}`, 350, startY)
           .text(`Pay Period: ${payrollInfo.period_start} to ${payrollInfo.period_end}`)
           .text(`Payment Method: ${payrollInfo.payment_method}`)
           .moveDown(2);

        const tableTop = doc.y;

        // --- Table Headers ---
        doc.rect(50, tableTop, 512, 20).fill('#e5eeff');
        doc.fillColor('#001e40').font('Helvetica-Bold').fontSize(9);
        doc.text('DESCRIPTION', 60, tableTop + 6)
           .text('CURRENT RATE', 200, tableTop + 6)
           .text('CURRENT AMOUNT', 320, tableTop + 6)
           .text('YTD AMOUNT', 440, tableTop + 6);

        let rowY = tableTop + 20;
        doc.font('Helvetica').fillColor('#0b1c30');

        const addRow = (desc: string, rate: string, current: number, ytd: number) => {
          doc.rect(50, rowY, 512, 20).stroke('#c3c6d1');
          doc.text(desc, 60, rowY + 6)
             .text(rate, 200, rowY + 6)
             .text(`$${current.toFixed(2)}`, 320, rowY + 6)
             .text(`$${ytd.toFixed(2)}`, 440, rowY + 6);
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
        doc.moveDown(1.5);
        doc.rect(50, doc.y, 512, 40).fill('#dce9ff');
        doc.fillColor('#001e40')
           .font('Helvetica-Bold')
           .fontSize(12)
           .text('NET PAY DEPOSITED', 60, doc.y + 14)
           .fontSize(16)
           .text(`$${payrollInfo.net_pay.toFixed(2)}`, 380, doc.y - 12, { align: 'right' });

        // --- Employer Contributions Info (Bottom) ---
        doc.moveDown(3.5);
        doc.fillColor('#737780')
           .font('Helvetica-Bold')
           .fontSize(9)
           .text('Employer Contributions (For Reference / Compliance Reporting Only)', 50, doc.y);
        
        doc.font('Helvetica').fillColor('#43474f');
        doc.text(`Employer CPP Match (1:1): $${payrollInfo.cpp_employer.toFixed(2)}`)
           .text(`Employer EI Match (1.4x): $${payrollInfo.ei_employer.toFixed(2)}`)
           .text(`WSIB Premium (${settings.wsib_rate}%): $${payrollInfo.wsib_premium.toFixed(2)}`)
           .text(`Employer Health Tax (EHT): $${payrollInfo.eht_premium.toFixed(2)}`);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=paystub-${employeeId}-${runId}.pdf`
      }
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

    // Create CRA T4 XML using xmlbuilder2
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Submission', {
        xmlns: 'http://www.cra-arc.gc.ca/xmlns/sdt/2024',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance'
      });

    root.ele('T4TaxesTransmitter')
      .ele('TransmitterCompany')
        .ele('CompanyName').txt(settings.legal_name).up()
        .ele('BusinessNumber').txt(settings.business_number).up()
      .up()
      .ele('PayrollSettings')
        .ele('WSIBNumber').txt(settings.wsib_number || '').up()
      .up();

    const slips = root.ele('T4Slips');

    for (const emp of employees as any[]) {
      slips.ele('T4Slip')
        .ele('EmployeeName')
          .ele('FirstName').txt(emp.first_name).up()
          .ele('LastName').txt(emp.last_name).up()
        .up()
        .ele('EmployeeEmail').txt(emp.email).up()
        .ele('Box12_SIN').txt('000000000').up()
        .ele('Box14_GrossEarnings').txt(emp.ytd_gross.toFixed(2)).up()
        .ele('Box16_EmployeeCPP').txt(emp.ytd_cpp.toFixed(2)).up()
        .ele('Box18_EmployeeEI').txt(emp.ytd_ei.toFixed(2)).up()
        .ele('Box22_IncomeTax').txt(emp.ytd_tax.toFixed(2)).up()
        .ele('Box24_EIInsurableEarnings').txt(emp.ytd_gross.toFixed(2)).up()
        .ele('Box26_CPPPensionableEarnings').txt(Math.min(emp.ytd_gross, 68500).toFixed(2)).up()
        .ele('Box50_WSIBEarnings').txt(emp.ytd_wsib.toFixed(2)).up()
        .ele('Box52_EHTEarnings').txt(emp.ytd_eht.toFixed(2)).up();
    }

    const xmlString = root.end({ prettyPrint: true });

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

export default router;

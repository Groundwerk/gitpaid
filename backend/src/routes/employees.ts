import { Hono } from 'hono';

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

// GET /api/employees
router.get('/', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { results } = await c.env.DB.prepare('SELECT * FROM employees WHERE company_id = ? ORDER BY first_name ASC')
      .bind(companyId)
      .all();

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/employees/:id
router.get('/:id', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const employee = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();

    if (!employee) {
      return c.json({ error: 'Employee not found' }, 404);
    }

    return c.json(employee);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/employees
router.post('/', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const {
      first_name,
      last_name,
      email,
      role,
      department,
      pay_type,
      rate,
      status,
      cpp_exempt,
      ei_exempt,
      tax_exempt,
      avatar,
      ytd_gross = 0,
      ytd_net = 0,
      ytd_cpp = 0,
      ytd_ei = 0,
      ytd_tax = 0,
      ytd_wsib = 0,
      ytd_eht = 0,
      ytd_vacation_accrued = 0,
      ytd_vacation_paid = 0
    } = await c.req.json();

    if (!first_name || !last_name || !email || !pay_type || rate === undefined) {
      return c.json({ error: 'Missing required employee fields' }, 400);
    }

    const initials = first_name.substring(0, 1) + last_name.substring(0, 1);
    const result = await c.env.DB.prepare(`
      INSERT INTO employees (
        company_id, first_name, last_name, email, role, department, pay_type, rate, status,
        cpp_exempt, ei_exempt, tax_exempt, avatar,
        ytd_gross, ytd_net, ytd_cpp, ytd_ei, ytd_tax, ytd_wsib, ytd_eht,
        ytd_vacation_accrued, ytd_vacation_paid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      companyId,
      first_name,
      last_name,
      email,
      role || null,
      department || 'Engineering',
      pay_type,
      parseFloat(rate),
      status || 'active',
      cpp_exempt ? 1 : 0,
      ei_exempt ? 1 : 0,
      tax_exempt ? 1 : 0,
      avatar || initials,
      parseFloat(ytd_gross),
      parseFloat(ytd_net),
      parseFloat(ytd_cpp),
      parseFloat(ytd_ei),
      parseFloat(ytd_tax),
      parseFloat(ytd_wsib),
      parseFloat(ytd_eht),
      parseFloat(ytd_vacation_accrued),
      parseFloat(ytd_vacation_paid)
    ).run();

    const created = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(result.meta.last_row_id, companyId)
      .first();

    return c.json(created, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/employees/:id
router.put('/:id', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const current: any = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();

    if (!current) {
      return c.json({ error: 'Employee not found' }, 404);
    }

    const body = await c.req.json();
    
    await c.env.DB.prepare(`
      UPDATE employees SET
        first_name = ?,
        last_name = ?,
        email = ?,
        role = ?,
        department = ?,
        pay_type = ?,
        rate = ?,
        status = ?,
        cpp_exempt = ?,
        ei_exempt = ?,
        tax_exempt = ?,
        avatar = ?,
        ytd_gross = ?,
        ytd_net = ?,
        ytd_cpp = ?,
        ytd_ei = ?,
        ytd_tax = ?,
        ytd_wsib = ?,
        ytd_eht = ?,
        ytd_vacation_accrued = ?,
        ytd_vacation_paid = ?
      WHERE id = ? AND company_id = ?
    `).bind(
      body.first_name !== undefined ? body.first_name : current.first_name,
      body.last_name !== undefined ? body.last_name : current.last_name,
      body.email !== undefined ? body.email : current.email,
      body.role !== undefined ? body.role : current.role,
      body.department !== undefined ? body.department : current.department,
      body.pay_type !== undefined ? body.pay_type : current.pay_type,
      body.rate !== undefined ? parseFloat(body.rate) : current.rate,
      body.status !== undefined ? body.status : current.status,
      body.cpp_exempt !== undefined ? (body.cpp_exempt ? 1 : 0) : current.cpp_exempt,
      body.ei_exempt !== undefined ? (body.ei_exempt ? 1 : 0) : current.ei_exempt,
      body.tax_exempt !== undefined ? (body.tax_exempt ? 1 : 0) : current.tax_exempt,
      body.avatar !== undefined ? body.avatar : current.avatar,
      body.ytd_gross !== undefined ? parseFloat(body.ytd_gross) : current.ytd_gross,
      body.ytd_net !== undefined ? parseFloat(body.ytd_net) : current.ytd_net,
      body.ytd_cpp !== undefined ? parseFloat(body.ytd_cpp) : current.ytd_cpp,
      body.ytd_ei !== undefined ? parseFloat(body.ytd_ei) : current.ytd_ei,
      body.ytd_tax !== undefined ? parseFloat(body.ytd_tax) : current.ytd_tax,
      body.ytd_wsib !== undefined ? parseFloat(body.ytd_wsib) : current.ytd_wsib,
      body.ytd_eht !== undefined ? parseFloat(body.ytd_eht) : current.ytd_eht,
      body.ytd_vacation_accrued !== undefined ? parseFloat(body.ytd_vacation_accrued) : current.ytd_vacation_accrued,
      body.ytd_vacation_paid !== undefined ? parseFloat(body.ytd_vacation_paid) : current.ytd_vacation_paid,
      id,
      companyId
    ).run();

    const updated = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();

    return c.json(updated);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// DELETE /api/employees/:id
router.delete('/:id', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const employee = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();

    if (!employee) {
      return c.json({ error: 'Employee not found' }, 404);
    }

    await c.env.DB.prepare('DELETE FROM employees WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .run();

    return c.json({ message: 'Employee successfully deleted' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;

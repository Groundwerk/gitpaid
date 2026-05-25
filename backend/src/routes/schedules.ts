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

// Helper to generate schedules
function generateSchedules(
  payGroupId: number,
  payFrequency: string,
  firstStart: string, // YYYY-MM-DD
  firstEnd: string,   // YYYY-MM-DD
  firstPayment: string, // YYYY-MM-DD
  numPeriods: number
) {
  const periods = [];
  
  // Parse inputs as UTC to avoid local timezone offsets
  const parseDate = (dStr: string) => {
    const [year, month, day] = dStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  };
  
  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  let currentStart = parseDate(firstStart);
  let currentEnd = parseDate(firstEnd);
  let currentPayment = parseDate(firstPayment);

  // Compute offset in days between period end and payment date
  const offsetTime = currentPayment.getTime() - currentEnd.getTime();
  const offsetDays = Math.round(offsetTime / (1000 * 60 * 60 * 24));

  for (let i = 0; i < numPeriods; i++) {
    periods.push({
      pay_group_id: payGroupId,
      period_start: formatDate(currentStart),
      period_end: formatDate(currentEnd),
      payment_date: formatDate(currentPayment),
      status: 'open'
    });

    if (i === numPeriods - 1) break; // Don't advance on the last one

    if (payFrequency === 'weekly') {
      currentStart.setUTCDate(currentStart.getUTCDate() + 7);
      currentEnd.setUTCDate(currentEnd.getUTCDate() + 7);
      currentPayment.setUTCDate(currentPayment.getUTCDate() + 7);
    } else if (payFrequency === 'bi-weekly') {
      currentStart.setUTCDate(currentStart.getUTCDate() + 14);
      currentEnd.setUTCDate(currentEnd.getUTCDate() + 14);
      currentPayment.setUTCDate(currentPayment.getUTCDate() + 14);
    } else if (payFrequency === 'semi-monthly') {
      const startDay = currentStart.getUTCDate();
      const startMonth = currentStart.getUTCMonth();
      const startYear = currentStart.getUTCFullYear();

      if (startDay === 1) {
        currentStart = new Date(Date.UTC(startYear, startMonth, 16));
        currentEnd = new Date(Date.UTC(startYear, startMonth + 1, 0)); // last day of month
      } else if (startDay === 16) {
        currentStart = new Date(Date.UTC(startYear, startMonth + 1, 1));
        currentEnd = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth(), 15));
      } else {
        // Fallback for custom semi-monthly days: alternate adding 15/16 days
        const daysToAdd = (i % 2 === 0) ? 15 : 16;
        currentStart.setUTCDate(currentStart.getUTCDate() + daysToAdd);
        currentEnd.setUTCDate(currentEnd.getUTCDate() + daysToAdd);
      }
      // Recompute payment date with offset
      currentPayment = new Date(currentEnd.getTime());
      currentPayment.setUTCDate(currentPayment.getUTCDate() + offsetDays);
    } else if (payFrequency === 'monthly') {
      // Move both start and end by exactly 1 month
      currentStart.setUTCMonth(currentStart.getUTCMonth() + 1);
      
      // For end date: if it's the last day of the month, make it the last day of the next month
      const endDay = currentEnd.getUTCDate();
      const endMonth = currentEnd.getUTCMonth();
      const endYear = currentEnd.getUTCFullYear();
      const isLastDay = new Date(Date.UTC(endYear, endMonth, endDay + 1)).getUTCDate() === 1;

      if (isLastDay) {
        currentEnd = new Date(Date.UTC(endYear, endMonth + 2, 0));
      } else {
        currentEnd.setUTCMonth(currentEnd.getUTCMonth() + 1);
      }
      
      currentPayment = new Date(currentEnd.getTime());
      currentPayment.setUTCDate(currentPayment.getUTCDate() + offsetDays);
    }
  }

  return periods;
}

// GET /api/pay-groups
router.get('/', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { results } = await c.env.DB.prepare(`
      SELECT pg.*, COUNT(e.id) as employee_count
      FROM pay_groups pg
      LEFT JOIN employees e ON pg.id = e.pay_group_id
      WHERE pg.company_id = ?
      GROUP BY pg.id
      ORDER BY pg.name ASC
    `).bind(companyId).all();

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/pay-groups/upcoming-schedules
router.get('/upcoming-schedules', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { results } = await c.env.DB.prepare(`
      SELECT ps.*, pg.name as pay_group_name, pg.pay_frequency
      FROM pay_schedules ps
      JOIN pay_groups pg ON ps.pay_group_id = pg.id
      WHERE pg.company_id = ? 
        AND ps.status = 'open'
        AND ps.id = (
          SELECT MIN(ps2.id) 
          FROM pay_schedules ps2 
          WHERE ps2.pay_group_id = ps.pay_group_id AND ps2.status = 'open'
        )
      ORDER BY ps.payment_date ASC
    `).bind(companyId).all();

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/pay-groups/:id/schedules
router.get('/:id/schedules', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    // Verify ownership
    const pg = await c.env.DB.prepare('SELECT id FROM pay_groups WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();
    if (!pg) return c.json({ error: 'Pay Group not found' }, 404);

    const { results } = await c.env.DB.prepare(`
      SELECT * FROM pay_schedules WHERE pay_group_id = ? ORDER BY period_start ASC
    `).bind(id).all();

    return c.json(results);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/pay-groups
router.post('/', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const { name, pay_frequency, first_period_start, first_period_end, first_payment_date, num_periods = 1 } = await c.req.json();

    if (!name || !pay_frequency || !first_period_start || !first_period_end || !first_payment_date) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    // Insert group
    const groupResult = await c.env.DB.prepare(`
      INSERT INTO pay_groups (company_id, name, pay_frequency)
      VALUES (?, ?, ?)
    `).bind(companyId, name, pay_frequency).run();

    const groupId = groupResult.meta.last_row_id;
    if (!groupId) throw new Error('Failed to create Pay Group');

    // Generate schedules
    const schedules = generateSchedules(
      groupId,
      pay_frequency,
      first_period_start,
      first_period_end,
      first_payment_date,
      parseInt(num_periods)
    );

    const dbStatements = [];
    for (const s of schedules) {
      dbStatements.push(
        c.env.DB.prepare(`
          INSERT INTO pay_schedules (pay_group_id, period_start, period_end, payment_date, status)
          VALUES (?, ?, ?, ?, 'open')
        `).bind(groupId, s.period_start, s.period_end, s.payment_date)
      );
    }

    if (dbStatements.length > 0) {
      await c.env.DB.batch(dbStatements);
    }

    return c.json({ id: groupId, message: 'Pay Group and schedules created successfully' }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/pay-groups/:id/generate-schedules
router.post('/:id/generate-schedules', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    // Verify ownership and get group frequency
    const pg: any = await c.env.DB.prepare('SELECT id, pay_frequency FROM pay_groups WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();
    if (!pg) return c.json({ error: 'Pay Group not found' }, 404);

    const { first_period_start, first_period_end, first_payment_date, num_periods = 1 } = await c.req.json();

    if (!first_period_start || !first_period_end || !first_payment_date) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    // Generate schedules
    const schedules = generateSchedules(
      pg.id,
      pg.pay_frequency,
      first_period_start,
      first_period_end,
      first_payment_date,
      parseInt(num_periods)
    );

    const dbStatements = [];
    for (const s of schedules) {
      dbStatements.push(
        c.env.DB.prepare(`
          INSERT INTO pay_schedules (pay_group_id, period_start, period_end, payment_date, status)
          VALUES (?, ?, ?, ?, 'open')
        `).bind(pg.id, s.period_start, s.period_end, s.payment_date)
      );
    }

    if (dbStatements.length > 0) {
      await c.env.DB.batch(dbStatements);
    }

    return c.json({ message: 'Schedules generated successfully' }, 201);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// DELETE /api/pay-groups/:id
router.delete('/:id', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const id = c.req.param('id');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    const pg = await c.env.DB.prepare('SELECT id FROM pay_groups WHERE id = ? AND company_id = ?')
      .bind(id, companyId)
      .first();
    if (!pg) return c.json({ error: 'Pay Group not found' }, 404);

    // Check for processed schedules
    const processed = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM pay_schedules WHERE pay_group_id = ? AND status = 'processed'
    `).bind(id).first() as any;

    if (processed && processed.count > 0) {
      return c.json({ error: 'Cannot delete pay group because it has already processed payroll periods.' }, 400);
    }

    // Cascade delete schedules
    await c.env.DB.prepare('DELETE FROM pay_groups WHERE id = ?').bind(id).run();

    return c.json({ message: 'Pay Group successfully deleted' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/pay-groups/:groupId/schedules/:scheduleId
router.put('/:groupId/schedules/:scheduleId', async (c) => {
  try {
    const companyId = getCompanyId(c);
    const groupId = c.req.param('groupId');
    const scheduleId = c.req.param('scheduleId');
    if (!companyId) return c.json({ error: 'Unauthorized' }, 401);

    // Verify ownership of the pay group
    const pg = await c.env.DB.prepare('SELECT id FROM pay_groups WHERE id = ? AND company_id = ?')
      .bind(groupId, companyId)
      .first();
    if (!pg) return c.json({ error: 'Pay Group not found or unauthorized' }, 404);

    const { period_start, period_end, payment_date } = await c.req.json();
    if (!period_start || !period_end || !payment_date) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    // Verify schedule exists, belongs to this group and is open
    const schedule = await c.env.DB.prepare('SELECT * FROM pay_schedules WHERE id = ? AND pay_group_id = ?')
      .bind(scheduleId, groupId)
      .first() as any;
    if (!schedule) return c.json({ error: 'Schedule period not found' }, 404);

    if (schedule.status !== 'open') {
      return c.json({ error: 'Only open schedule periods can be edited.' }, 400);
    }

    await c.env.DB.prepare(`
      UPDATE pay_schedules
      SET period_start = ?, period_end = ?, payment_date = ?
      WHERE id = ?
    `).bind(period_start, period_end, payment_date, scheduleId).run();

    return c.json({ message: 'Schedule period updated successfully' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;

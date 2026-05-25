import { Hono } from 'hono';
import { sign } from 'hono/jwt';

const router = new Hono<{
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
  };
}>();

// GET /api/settings
router.get('/', async (c) => {
  try {
    const payload = c.get('jwtPayload' as any) as any;
    const companyId = payload?.companyId;

    if (!companyId) {
      return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    }

    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
      .bind(companyId)
      .first();

    if (!settings) {
      return c.json({ error: 'Settings not found' }, 404);
    }

    return c.json(settings);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/settings (Onboarding) or PUT /api/settings (Update)
const saveSettings = async (c: any) => {
  try {
    const payload = c.get('jwtPayload' as any) as any;
    const email = payload?.email;
    let companyId = payload?.companyId;

    const {
      legal_name,
      operating_name,
      business_number,
      address_line1,
      city,
      postal_code,
      contact_name,
      contact_email,
      wsib_number,
      wsib_rate,
      eht_exempt,
      eht_rate,
      vacation_rate,
      pay_period
    } = await c.req.json();

    if (!legal_name || !business_number) {
      return c.json({ error: 'Legal Name and Business Number are mandatory' }, 400);
    }

    if (!companyId) {
      // 1. First-time onboarding setup
      const result = await c.env.DB.prepare(`
        INSERT INTO company_settings (
          legal_name, operating_name, business_number, address_line1, city, postal_code,
          contact_name, contact_email, wsib_number, wsib_rate, eht_exempt, eht_rate, vacation_rate, pay_period
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        legal_name,
        operating_name || null,
        business_number,
        address_line1 || null,
        city || null,
        postal_code || null,
        contact_name || null,
        contact_email || null,
        wsib_number || null,
        parseFloat(wsib_rate) || 2.5,
        eht_exempt ? 1 : 0,
        parseFloat(eht_rate) || 1.95,
        parseFloat(vacation_rate) || 4.0,
        pay_period || 'bi-weekly'
      ).run();

      // Retrieve the newly created ID
      // D1 .run() returns meta or lastRowId? For D1, result.meta.last_row_id is standard!
      // D1 Database result: { success: true, meta: { last_row_id: number, ... } }
      const newCompanyId = result.meta.last_row_id;
      if (!newCompanyId) {
        throw new Error('Failed to generate company ID');
      }

      // 2. Associate the company ID with the logged-in user
      await c.env.DB.prepare('UPDATE users SET company_id = ? WHERE email = ?')
        .bind(newCompanyId, email)
        .run();

      // 3. Issue a new session token with the updated companyId
      const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      const newToken = await sign({
        email,
        name: payload.name,
        companyId: newCompanyId,
        exp
      }, c.env.JWT_SECRET, 'HS256');

      return c.json({
        token: newToken,
        companyId: newCompanyId,
        message: 'Onboarding settings successfully saved'
      });
    } else {
      // Update existing settings
      await c.env.DB.prepare(`
        UPDATE company_settings SET
          legal_name = ?,
          operating_name = ?,
          business_number = ?,
          address_line1 = ?,
          city = ?,
          postal_code = ?,
          contact_name = ?,
          contact_email = ?,
          wsib_number = ?,
          wsib_rate = ?,
          eht_exempt = ?,
          eht_rate = ?,
          vacation_rate = ?,
          pay_period = ?
        WHERE id = ?
      `).bind(
        legal_name,
        operating_name,
        business_number,
        address_line1,
        city,
        postal_code,
        contact_name,
        contact_email,
        wsib_number,
        parseFloat(wsib_rate),
        eht_exempt ? 1 : 0,
        parseFloat(eht_rate),
        parseFloat(vacation_rate),
        pay_period,
        companyId
      ).run();

      const updated = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = ?')
        .bind(companyId)
        .first();

      return c.json(updated);
    }
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

router.post('/', saveSettings);
router.put('/', saveSettings);

export default router;

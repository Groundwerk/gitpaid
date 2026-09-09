import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { validateOpenings } from '../services/solePropEngine';

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
      pay_period,
      owner_sin = null,
      business_type = null,
      remittance_frequency = 'monthly',
      contact_phone = null,
      address_line2 = null,
      province = 'ON',
      override_ei_employer_rate = 1.4,
      logo_url = null,
      brand_color = null,
      use_company_branding = 0,
      account_type = 'company',
      sole_prop_start_date = null,
      sole_prop_business_number = null,
      sole_prop_ytd_pensionable = 0,
      sole_prop_ytd_cpp = 0,
      sole_prop_ytd_cpp2 = 0
    } = await c.req.json();

    const accountType = account_type === 'sole_prop' ? 'sole_prop' : 'company';

    if (!companyId) {
      // Mandatory fields apply to first-time onboarding only; updates
      // carry partial payloads (e.g. sole-prop name edit without BN).
      if (accountType === 'sole_prop') {
        if (!legal_name) {
          return c.json({ error: 'Legal Name is mandatory' }, 400);
        }
      } else if (!legal_name || !business_number) {
        return c.json({ error: 'Legal Name and Business Number are mandatory' }, 400);
      }
      // 1. First-time onboarding setup
      const result = await c.env.DB.prepare(`
        INSERT INTO company_settings (
          legal_name, operating_name, business_number, address_line1, city, postal_code,
          contact_name, contact_email, wsib_number, wsib_rate, eht_exempt, eht_rate, vacation_rate, pay_period,
          owner_sin, business_type, remittance_frequency, contact_phone, address_line2, province, override_ei_employer_rate,
          logo_url, brand_color, use_company_branding, account_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        legal_name,
        operating_name || null,
        business_number || '',
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
        pay_period || 'bi-weekly',
        owner_sin || null,
        business_type || null,
        remittance_frequency || 'monthly',
        contact_phone || null,
        address_line2 || null,
        province || 'ON',
        parseFloat(override_ei_employer_rate) || 1.4,
        logo_url || null,
        brand_color || null,
        use_company_branding ? 1 : 0,
        accountType
      ).run();

      // Retrieve the newly created ID
      const newCompanyId = result.meta.last_row_id;
      if (!newCompanyId) {
        throw new Error('Failed to generate company ID');
      }

      // Seed the 4 default pay groups and their first open schedule period
      const defaultGroups = [
        { name: 'Default Weekly Group', frequency: 'weekly' },
        { name: 'Default Bi-Weekly Group', frequency: 'bi-weekly' },
        { name: 'Default Semi-Monthly Group', frequency: 'semi-monthly' },
        { name: 'Default Monthly Group', frequency: 'monthly' }
      ];

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const date = now.getUTCDate();
      const day = now.getUTCDay();

      // Monday of the current week (UTC)
      const currentMonday = new Date(Date.UTC(year, month, date - ((day + 6) % 7)));
      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      const statements = [];

      // Sole proprietors have no pay groups; the empty loop below naturally skips seeding.
      for (const group of (accountType === 'sole_prop' ? [] : defaultGroups)) {
        // Insert group
        const pgResult = await c.env.DB.prepare(`
          INSERT INTO pay_groups (company_id, name, pay_frequency)
          VALUES (?, ?, ?)
        `).bind(newCompanyId, group.name, group.frequency).run();

        const pgId = pgResult.meta.last_row_id;
        if (!pgId) {
          throw new Error(`Failed to generate pay group ID for ${group.name}`);
        }

        // Calculate schedule dates (most recently completed pay periods)
        let pStart: Date, pEnd: Date, pPayment: Date;

        if (group.frequency === 'weekly') {
          pStart = new Date(Date.UTC(currentMonday.getUTCFullYear(), currentMonday.getUTCMonth(), currentMonday.getUTCDate() - 7));
          pEnd = new Date(Date.UTC(pStart.getUTCFullYear(), pStart.getUTCMonth(), pStart.getUTCDate() + 6));
          pPayment = new Date(Date.UTC(pEnd.getUTCFullYear(), pEnd.getUTCMonth(), pEnd.getUTCDate() + 5)); // Friday following end
        } else if (group.frequency === 'bi-weekly') {
          pStart = new Date(Date.UTC(currentMonday.getUTCFullYear(), currentMonday.getUTCMonth(), currentMonday.getUTCDate() - 14));
          pEnd = new Date(Date.UTC(pStart.getUTCFullYear(), pStart.getUTCMonth(), pStart.getUTCDate() + 13));
          pPayment = new Date(Date.UTC(pEnd.getUTCFullYear(), pEnd.getUTCMonth(), pEnd.getUTCDate() + 5)); // Friday following end
        } else if (group.frequency === 'semi-monthly') {
          if (date <= 15) {
            pStart = new Date(Date.UTC(year, month - 1, 16));
            pEnd = new Date(Date.UTC(year, month, 0)); // last day of previous month
            pPayment = new Date(Date.UTC(year, month, 5)); // 5th of current month
          } else {
            pStart = new Date(Date.UTC(year, month, 1));
            pEnd = new Date(Date.UTC(year, month, 15));
            pPayment = new Date(Date.UTC(year, month, 20)); // 20th of current month
          }
        } else { // monthly
          pStart = new Date(Date.UTC(year, month - 1, 1));
          pEnd = new Date(Date.UTC(year, month, 0)); // last day of previous month
          pPayment = new Date(Date.UTC(year, month, 15)); // 15th of current month
        }

        // Add statement to create the first open schedule period
        statements.push(
          c.env.DB.prepare(`
            INSERT INTO pay_schedules (pay_group_id, period_start, period_end, payment_date, status)
            VALUES (?, ?, ?, ?, 'open')
          `).bind(pgId, formatDate(pStart), formatDate(pEnd), formatDate(pPayment))
        );
      }

      if (statements.length > 0) {
        await c.env.DB.batch(statements);
      }
      if (accountType === 'sole_prop') {
        const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(sole_prop_start_date || ''))
          ? String(sole_prop_start_date)
          : new Date().toISOString().split('T')[0];
        const bnDigits = String(sole_prop_business_number ?? business_number ?? '').replace(/\D/g, '');
        const initPens = Number(sole_prop_ytd_pensionable) || 0;
        const initCpp = Number(sole_prop_ytd_cpp) || 0;
        const initCpp2 = Number(sole_prop_ytd_cpp2) || 0;
        const openingsError = validateOpenings(initPens, initCpp, initCpp2);
        if (openingsError) {
          return c.json({ error: openingsError }, 400);
        }
        await c.env.DB.prepare(`
          INSERT INTO sole_prop_profile
            (company_id, business_number, start_date, province, ytd_pensionable_opening, ytd_cpp_opening, ytd_cpp2_opening, instalment_mode)
          VALUES (?, ?, ?, 'ON', ?, ?, ?, 'quarterly')
        `).bind(
          newCompanyId,
          bnDigits.length === 9 ? bnDigits : null,
          startDate,
          initPens,
          initCpp,
          initCpp2
        ).run();
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
          pay_period = ?,
          owner_sin = ?,
          business_type = ?,
          remittance_frequency = ?,
          contact_phone = ?,
          address_line2 = ?,
          province = ?,
          override_ei_employer_rate = ?,
          logo_url = ?,
          brand_color = ?,
          use_company_branding = ?
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
        owner_sin,
        business_type,
        remittance_frequency,
        contact_phone,
        address_line2,
        province,
        parseFloat(override_ei_employer_rate),
        logo_url || null,
        brand_color || null,
        use_company_branding ? 1 : 0,
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

// DELETE /api/settings/gmail (Disconnect Gmail)
router.delete('/gmail', async (c) => {
  try {
    const payload = c.get('jwtPayload' as any) as any;
    const companyId = payload?.companyId;

    if (!companyId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await c.env.DB.prepare(`
      UPDATE company_settings
      SET gmail_refresh_token = NULL, gmail_email = NULL
      WHERE id = ?
    `).bind(companyId).run();

    return c.json({ message: 'Gmail integration disconnected successfully' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;

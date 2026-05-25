import { Hono } from 'hono';
import { sign } from 'hono/jwt';

const router = new Hono<{
  Bindings: {
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    JWT_SECRET: string;
  };
}>();

// POST /api/auth/google
router.post('/google', async (c) => {
  try {
    const { idToken } = await c.req.json();
    if (!idToken) {
      return c.json({ error: 'ID Token is required' }, 400);
    }

    let email = '';
    let name = '';
    let avatar = '';

    // Mock Token Bypass for Testing and local verification
    if (idToken.startsWith('mock-google-token-')) {
      const slug = idToken.replace('mock-google-token-', '');
      email = `${slug}@company.com`.toLowerCase();
      name = slug.charAt(0).toUpperCase() + slug.slice(1);
      avatar = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDXCvSWyqkjVdQTxx9R9ACeVjYDJUrHq22kErweBgdhf5apGd9ezG5NTJDVv9EJHRA0y8cg4nUg3f97pGe7kuIKuoFyAtqx8AwxxajHdB5ncW2AYTMLYsuv9ujO8VnZRHO88Qz7sjp2Faru7AruA7_W1VrtKjGW9m_Qtl1OWOS0UZ1KFvI7Ji50llX5K7UdvQIiz5AHSD_QWnkIzreEIB0GP3aJbESfi_qFT0dT8TpPoMCPk0Y3JE25JW4n03Ha5fp27ltehwykP-8';
    } else {
      // Live Google tokeninfo verification fetch
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (!res.ok) {
        return c.json({ error: 'Invalid Google signature or token expired' }, 401);
      }
      const data: any = await res.json();
      
      // Verify audience matches ours
      if (data.aud !== c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_ID !== '123456789-placeholder.apps.googleusercontent.com') {
        return c.json({ error: 'Audience mismatch' }, 401);
      }

      email = data.email.toLowerCase();
      name = data.name || 'Google User';
      avatar = data.picture || '';
    }

    // Check if user exists in database
    let user: any = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first();

    let needsOnboarding = true;

    if (!user) {
      // Create user record
      await c.env.DB.prepare('INSERT INTO users (email, name, avatar, company_id) VALUES (?, ?, ?, NULL)')
        .bind(email, name, avatar)
        .run();
    } else {
      needsOnboarding = user.company_id === null;
    }

    // Load updated user details
    user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first();

    // Create session JWT
    const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours expiry
    const payload = {
      email: user.email,
      name: user.name,
      companyId: user.company_id,
      exp
    };

    const token = await sign(payload, c.env.JWT_SECRET, 'HS256');

    return c.json({
      token,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      companyId: user.company_id,
      needsOnboarding
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;

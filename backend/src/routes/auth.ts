import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { encryptText } from '../utils/crypto';

const router = new Hono<{
  Bindings: {
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    GMAIL_CLIENT_SECRET?: string;
    JWT_SECRET: string;
  };
}>();

// GET /api/auth/config
router.get('/config', async (c) => {
  return c.json({
    clientId: c.env.GOOGLE_CLIENT_ID || '123456789-placeholder.apps.googleusercontent.com'
  });
});

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

// GET /api/auth/google/login-url
router.get('/google/login-url', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized: Missing Authorization header' }, 401);
    }
    const token = authHeader.substring(7);
    let payload;
    try {
      payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    } catch (e) {
      return c.json({ error: 'Unauthorized: Invalid token' }, 401);
    }
    const companyId = payload.companyId;
    if (!companyId) {
      return c.json({ error: 'Unauthorized: Missing company association' }, 401);
    }

    const origin = c.req.query('origin') || 'http://localhost:5173';
    
    // Create state token containing companyId and origin, valid for 15m
    const statePayload = {
      companyId,
      origin,
      exp: Math.floor(Date.now() / 1000) + 15 * 60
    };
    const stateToken = await sign(statePayload, c.env.JWT_SECRET, 'HS256');

    const requestUrl = new URL(c.req.url);
    const backendOrigin = requestUrl.origin;
    const redirectUri = `${backendOrigin}/api/auth/google/callback`;

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email https://www.googleapis.com/auth/gmail.send',
      access_type: 'offline',
      prompt: 'consent',
      state: stateToken
    }).toString();

    return c.json({ url: googleAuthUrl });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/auth/google/callback
router.get('/google/callback', async (c) => {
  let targetOrigin = 'http://localhost:5173';
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    
    if (!state) {
      throw new Error('OAuth state is missing');
    }

    let payload: any;
    try {
      payload = await verify(state, c.env.JWT_SECRET, 'HS256');
    } catch (e) {
      throw new Error('OAuth state verification failed');
    }

    const { companyId, origin } = payload;
    if (origin) targetOrigin = origin;

    if (!code) {
      throw new Error('OAuth authorization code is missing from Google');
    }

    const requestUrl = new URL(c.req.url);
    const backendOrigin = requestUrl.origin;
    const redirectUri = `${backendOrigin}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GMAIL_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      throw new Error(`Google token exchange failed: ${errText}`);
    }

    const tokenData = await tokenResponse.json() as any;
    const { refresh_token, access_token } = tokenData;
    console.log('[CALLBACK] Scopes returned from Google token exchange:', tokenData.scope);

    if (!refresh_token) {
      throw new Error('Google did not return a refresh token. Please disconnect and reconnect your account to force consent.');
    }

    // Get user info to retrieve authorized email address
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    
    let gmailEmail = 'Connected Account';
    if (userinfoResponse.ok) {
      const userinfo = await userinfoResponse.json() as any;
      if (userinfo.email) gmailEmail = userinfo.email;
    }

    // Encrypt the refresh token
    const encryptedToken = await encryptText(refresh_token, c.env.JWT_SECRET);

    // Save to company settings
    await c.env.DB.prepare(`
      UPDATE company_settings
      SET gmail_refresh_token = ?, gmail_email = ?
      WHERE id = ?
    `).bind(encryptedToken, gmailEmail, companyId).run();

    return c.redirect(`${targetOrigin}?gmail_success=true`);
  } catch (error: any) {
    console.error('Google OAuth callback error:', error);
    return c.redirect(`${targetOrigin}?gmail_error=${encodeURIComponent(error.message)}`);
  }
});

export default router;


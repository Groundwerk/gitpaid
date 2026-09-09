import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import authRouter from './routes/auth';
import settingsRouter from './routes/settings';
import solepropRouter from './routes/soleprop';
import employeesRouter from './routes/employees';
import payrollRouter from './routes/payroll';
import reportsRouter from './routes/reports';
import schedulesRouter from './routes/schedules';

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    GMAIL_CLIENT_SECRET?: string;
    JWT_SECRET: string;
    ALLOW_MOCK_LOGIN?: string;
    ASSETS: Fetcher;
  };
}>();

// Structured request log: streams into Workers Logs (Observability)
// once [observability.logs] is enabled in wrangler.toml. One line per
// request keeps volume predictable; no bodies, tokens, or PII.
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const status = c.res.status;
  console.log(JSON.stringify({
    msg: 'request',
    method: c.req.method,
    path: c.req.path,
    status,
    ms: Date.now() - start,
  }));
});

// Global CORS Configuration
app.use('*', cors({
  origin: '*', // For local development. Can be locked down for production.
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Disposition']
}));

// Global JWT Authentication Middleware
app.use('/api/*', async (c, next) => {
  // Bypass JWT verification for authentication routes and health check
  if (c.req.path === '/api/health' || c.req.path.startsWith('/api/auth/')) {
    return await next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization header is required' }, 401);
  }

  if (!c.env.JWT_SECRET) {
    return c.json({ error: 'JWT_SECRET environment variable is missing on the server. Please set it using wrangler secret put JWT_SECRET.' }, 500);
  }

  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

// Routes hookup
app.route('/api/auth', authRouter);
app.route('/api/soleprop', solepropRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/employees', employeesRouter);
app.route('/api/payroll-runs', payrollRouter);
app.route('/api/reports', reportsRouter);
app.route('/api/pay-groups', schedulesRouter);

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    worker: 'Cloudflare',
    timestamp: new Date().toISOString(),
    config: {
      jwtSecretSet: !!c.env.JWT_SECRET,
      googleClientIdSet: !!c.env.GOOGLE_CLIENT_ID,
      gmailClientSecretSet: !!c.env.GMAIL_CLIENT_SECRET
    }
  });
});

// SPA catch-all: serve index.html for any non-API route
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
  }
  return c.json({ error: 'Not found' }, 404);
});

export default app;

// Daily Wise auto-sync cron (see [triggers] in wrangler.toml). Attached to
// the Hono instance so existing `import app from './index'` test imports
// keep working; the Workers runtime reads fetch + scheduled off it.
import { runWiseAutoSync } from './routes/soleprop';
Object.assign(app, {
  scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil(runWiseAutoSync(env));
  },
});

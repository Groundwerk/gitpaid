import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import authRouter from './routes/auth';
import settingsRouter from './routes/settings';
import employeesRouter from './routes/employees';
import payrollRouter from './routes/payroll';
import reportsRouter from './routes/reports';
import schedulesRouter from './routes/schedules';

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    JWT_SECRET: string;
  };
}>();

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

  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

// Routes hookup
app.route('/api/auth', authRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/employees', employeesRouter);
app.route('/api/payroll-runs', payrollRouter);
app.route('/api/reports', reportsRouter);
app.route('/api/pay-groups', schedulesRouter);

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'healthy', worker: 'Cloudflare', timestamp: new Date().toISOString() });
});

export default app;

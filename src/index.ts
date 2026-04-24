import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import telemetry from './routes/telemetry';

/**
 * Request-scoped values set via c.set(...) in middleware (e.g. an authenticated user).
 * Add fields here as middleware is introduced.
 */
type Variables = {};

/**
 * The global `Env` type is generated from wrangler.jsonc by `npm run cf-typegen`.
 * Re-run that script after adding vars, secrets, or bindings in wrangler.jsonc.
 */
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', logger());
app.use(
	'*',
	cors({
		origin: '*',
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	}),
);

app.get('/', (c) => c.text('ShelfAware API'));

app.get('/health', (c) =>
	c.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
	}),
);

app.route('/', telemetry);

app.onError((err, c) => {
	if (err instanceof HTTPException) {
		return err.getResponse();
	}
	console.error(err);
	return c.json({ error: 'Internal Server Error' }, 500);
});

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

export default app;

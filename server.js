const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const crypto = require('crypto');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

let schemaPromise;
function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id BIGSERIAL PRIMARY KEY,
        spent_on DATE NOT NULL,
        item VARCHAR(120) NOT NULL,
        category VARCHAR(60) NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS expenses_spent_on_idx ON expenses (spent_on DESC);
      CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses (category);
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

const COOKIE_NAME = 'expense_auth';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function configuredPassword() {
  return process.env.APP_PASSWORD || '';
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(expiresAt) {
  return crypto.createHmac('sha256', configuredPassword()).update(String(expiresAt)).digest('hex');
}

function validToken(token = '') {
  if (!configuredPassword()) return false;
  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature || Number(expiresAt) < Date.now()) return false;
  return safeEqual(signature, signToken(expiresAt));
}

function requireAuth(req, res, next) {
  if (!validToken(req.cookies[COOKIE_NAME])) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  if (!configuredPassword()) return res.status(503).json({ error: 'APP_PASSWORD 환경변수가 설정되지 않았습니다.' });
  const submitted = typeof req.body.password === 'string' ? req.body.password : '';
  if (!safeEqual(submitted, configuredPassword())) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  const expiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000;
  res.cookie(COOKIE_NAME, `${expiresAt}.${signToken(expiresAt)}`, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/'
  });
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
  res.status(204).end();
});

app.get('/api/auth/status', (req, res) => res.json({ authenticated: validToken(req.cookies[COOKIE_NAME]) }));

function parseExpense(body) {
  const spentOn = typeof body.spentOn === 'string' ? body.spentOn : '';
  const item = typeof body.item === 'string' ? body.item.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const amount = Number(body.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || !item || item.length > 120 || !category || category.length > 60 || !Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }
  return { spentOn, item, category, amount };
}

app.use('/api', requireAuth, async (_req, res, next) => {
  try { await ensureSchema(); next(); } catch (error) { next(error); }
});

app.get('/api/expenses', async (req, res, next) => {
  try {
    const values = [];
    const where = [];
    if (req.query.date) { values.push(req.query.date); where.push(`spent_on = $${values.length}`); }
    if (req.query.month) { values.push(`${req.query.month}-01`); where.push(`spent_on >= $${values.length}::date AND spent_on < ($${values.length}::date + INTERVAL '1 month')`); }
    const { rows } = await pool.query(`SELECT id, spent_on::text AS "spentOn", item, category, amount FROM expenses ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY spent_on DESC, id DESC`, values);
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/expenses', async (req, res, next) => {
  const expense = parseExpense(req.body);
  if (!expense) return res.status(400).json({ error: '입력값을 확인해 주세요.' });
  try {
    const { rows } = await pool.query('INSERT INTO expenses (spent_on, item, category, amount) VALUES ($1, $2, $3, $4) RETURNING id, spent_on::text AS "spentOn", item, category, amount', [expense.spentOn, expense.item, expense.category, expense.amount]);
    res.status(201).json(rows[0]);
  } catch (error) { next(error); }
});

app.put('/api/expenses/:id', async (req, res, next) => {
  const expense = parseExpense(req.body);
  if (!expense || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: '입력값을 확인해 주세요.' });
  try {
    const { rows } = await pool.query('UPDATE expenses SET spent_on=$1, item=$2, category=$3, amount=$4, updated_at=NOW() WHERE id=$5 RETURNING id, spent_on::text AS "spentOn", item, category, amount', [expense.spentOn, expense.item, expense.category, expense.amount, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: '내역을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

app.delete('/api/expenses/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: '잘못된 ID입니다.' });
  try {
    const result = await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: '내역을 찾을 수 없습니다.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/stats', async (req, res, next) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  try {
    const [monthly, categories] = await Promise.all([
      pool.query("SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM expenses WHERE spent_on >= $1::date AND spent_on < ($1::date + INTERVAL '1 month')", [`${month}-01`]),
      pool.query("SELECT category, SUM(amount)::bigint AS total FROM expenses WHERE spent_on >= $1::date AND spent_on < ($1::date + INTERVAL '1 month') GROUP BY category ORDER BY SUM(amount) DESC", [`${month}-01`])
    ]);
    res.json({ month, monthlyTotal: Number(monthly.rows[0].total), categories: categories.rows.map(row => ({ category: row.category, total: Number(row.total) })) });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*splat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`가계부가 http://localhost:${port} 에서 실행 중입니다.`));
}

module.exports = app;

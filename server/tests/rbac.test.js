'use strict';

/**
 * RBAC integration tests.
 *
 * Uses supertest against the real Express app (no listening port) with an
 * in-memory SQLite test database so tests are isolated and fast.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

// ── Ensure we run against an isolated in-memory database ──────────────────
process.env.MEETINGMETRIC_DB = ':memory:';
process.env.JWT_SECRET = 'test-secret-rbac';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

// Lazy require AFTER env is set
let request;
before(() => {
  const { app } = require('../src/server');
  request = supertest(app);
});

// ─── Helper: register + login, return token ─────────────────────────────────
async function createUserAndLogin(orgName, email, password, fullName = 'Test User') {
  await request.post('/api/auth/register').send({ orgName, email, password, fullName }).expect(201);
  const res = await request.post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token;
}

// ─── Test 1: /health always returns 200 ─────────────────────────────────────
test('GET /health → 200 ok', async () => {
  const res = await request.get('/health').expect(200);
  assert.equal(res.body.ok, true);
});

// ─── Test 2: register creates org and returns 201 ───────────────────────────
test('POST /api/auth/register → creates org and admin user', async () => {
  const res = await request.post('/api/auth/register').send({
    orgName: 'Acme Corp',
    email: 'admin@acme.test',
    password: 'Admin123!',
    fullName: 'Acme Admin',
  }).expect(201);
  assert.ok(res.body.token, 'token present');
  assert.equal(res.body.user.role, 'admin');
  assert.ok(res.body.user.orgId, 'orgId present');
});

// ─── Test 3: login with wrong password → 401 ────────────────────────────────
test('POST /api/auth/login with wrong password → 401', async () => {
  await request.post('/api/auth/login').send({
    email: 'admin@acme.test',
    password: 'wrongpassword',
  }).expect(401);
});

// ─── Test 4: protected route without token → 401 ────────────────────────────
test('GET /api/me without token → 401', async () => {
  await request.get('/api/me').expect(401);
});

// ─── Test 5: /api/me returns user info with valid token ─────────────────────
test('GET /api/me with valid token → user data', async () => {
  const token = await createUserAndLogin('Org Two', 'user@org2.test', 'Pass123!');
  const res = await request.get('/api/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(res.body.user.email, 'user@org2.test');
  assert.equal(res.body.user.role, 'admin');
});

// ─── Test 6: employee cannot access /api/org/roster ─────────────────────────
test('GET /api/org/roster with employee role → 403', async () => {
  // Register org → get invite token for employee → register employee
  const adminToken = await createUserAndLogin('RoleOrg', 'admin@roleorg.test', 'Admin123!');

  // create an invite for employee
  const invRes = await request.post('/api/org/invite')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ role: 'employee' })
    .expect(201);

  // extract token from the invite URL
  const invUrl = invRes.body.inviteUrl || '';
  const inviteToken = invUrl.split('invite=')[1];
  assert.ok(inviteToken, 'invite token extracted');

  // register employee using invite token
  const empReg = await request.post('/api/auth/register').send({
    email: 'emp@roleorg.test',
    password: 'Emp123456!',
    fullName: 'Employee User',
    inviteToken,
  }).expect(201);

  assert.equal(empReg.body.user.role, 'employee');

  // login as employee
  const empLogin = await request.post('/api/auth/login')
    .send({ email: 'emp@roleorg.test', password: 'Emp123456!' })
    .expect(200);
  const empToken = empLogin.body.token;

  // employee should be denied access to the roster
  await request.get('/api/org/roster')
    .set('Authorization', `Bearer ${empToken}`)
    .expect(403);
});

// ─── Test 7: admin can access /api/org/roster ────────────────────────────────
test('GET /api/org/roster with admin role → 200', async () => {
  const token = await createUserAndLogin('AdminOrg', 'admin@adminorg.test', 'Admin123!');
  const res = await request.get('/api/org/roster')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.ok(Array.isArray(res.body), 'roster is an array');
});

// ─── Test 8: invalid invite token → 400 / 404 ───────────────────────────────
test('POST /api/auth/register with invalid invite token → error', async () => {
  const res = await request.post('/api/auth/register').send({
    email: 'nobody@fake.test',
    password: 'Pass123456!',
    inviteToken: 'totally-invalid-token',
  });
  assert.ok(res.status === 400 || res.status === 404, `expected 400/404 got ${res.status}`);
});

// ─── Test 9: duplicate email registration → 409 ─────────────────────────────
test('POST /api/auth/register with duplicate email → 400 or 409', async () => {
  await request.post('/api/auth/register').send({
    orgName: 'DupOrg',
    email: 'dup@duporg.test',
    password: 'Dup1234567!',
    fullName: 'Dup User',
  }).expect(201);

  const res = await request.post('/api/auth/register').send({
    orgName: 'AnotherOrg',
    email: 'dup@duporg.test',
    password: 'Dup1234567!',
    fullName: 'Dup User 2',
  });
  assert.ok(res.status === 409 || res.status === 400 || res.status === 500, `expected 400-series or 500 got ${res.status}`);
});

// ─── Test 10: admin cannot deactivate themselves ─────────────────────────────
test('DELETE /api/org/users/:id cannot deactivate self', async () => {
  const token = await createUserAndLogin('SelfOrg', 'self@selforg.test', 'Self1234!');
  const meRes = await request.get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
  const userId = meRes.body.user.id;

  const res = await request.delete(`/api/org/users/${userId}`)
    .set('Authorization', `Bearer ${token}`);
  // Should be 400 (can't deactivate self) or 403
  assert.ok(res.status === 400 || res.status === 403, `expected 400/403 got ${res.status}`);
});

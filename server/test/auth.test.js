'use strict';

// Point the DB at a throwaway temp file BEFORE requiring anything that opens it.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.MEETINGMETRIC_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'mm-test-')),
  'test.db'
);
process.env.JWT_SECRET = 'test-secret';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  createUser,
  getUserByEmail,
} = require('../src/lib/auth');

test('password hashing round-trips and rejects the wrong password', () => {
  const hash = hashPassword('Sup3rSecret!');
  assert.notEqual(hash, 'Sup3rSecret!', 'must not store plaintext');
  assert.ok(verifyPassword('Sup3rSecret!', hash));
  assert.ok(!verifyPassword('wrong-password', hash));
});

test('JWT sign/verify round-trips and rejects a tampered token', () => {
  const token = signToken(42, 'user@example.com');
  const payload = verifyToken(token);
  assert.equal(payload.sub, 42);
  assert.equal(payload.email, 'user@example.com');
  assert.equal(verifyToken('not-a-real-token'), null);
});

test('createUser persists a user that getUserByEmail reads back (case-insensitive)', () => {
  const created = createUser('Test.User@Example.com', 'pw123456', { fullName: 'Test User' });
  assert.ok(created.id > 0);
  const fetched = getUserByEmail('test.user@example.com');
  assert.ok(fetched, 'user should be found regardless of email casing');
  assert.equal(fetched.email, 'test.user@example.com');
  assert.ok(verifyPassword('pw123456', fetched.password_hash));
});

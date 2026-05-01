import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Stub prisma so importing app.ts doesn't try to talk to a real DB
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    $connect = vi.fn();
    $disconnect = vi.fn();
    $on = vi.fn();
    $use = vi.fn();
  },
  Prisma: {},
}));

// Stub redis for the same reason
vi.mock('ioredis', () => ({
  default: class {
    on = vi.fn();
    connect = vi.fn();
    quit = vi.fn();
  },
}));

const { default: app } = await import('../app');

describe('GET /api/health', () => {
  it('returns 200 with status payload', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /api/auth/login validation', () => {
  it('rejects empty body with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('rejects malformed email with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('Unknown /api routes', () => {
  it('returns 404 JSON for unknown api path', async () => {
    const res = await request(app).get('/api/this-does-not-exist');
    expect(res.status).toBe(404);
  });
});

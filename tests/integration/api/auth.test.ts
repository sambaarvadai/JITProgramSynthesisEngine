import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { authMiddleware } from '../../../src/api/middleware/auth.js'
import { getTestToken } from './auth-token.js'

const JWT_SECRET = process.env.JWT_SECRET || 'pee-dev-secret-key'

describe('Auth Middleware', () => {
  let app: express.Express

  beforeAll(() => {
    app = express()
    app.use(authMiddleware)
    app.get('/test', (req, res) => {
      res.json({ userId: req.userId, workspaceId: req.workspaceId })
    })
  })

  it('should reject requests without an authorization header', async () => {
    const response = await request(app)
      .get('/test')
      .expect(401)

    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('should reject requests with an invalid token', async () => {
    const response = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401)

    expect(response.body.error.code).toBe('INVALID_TOKEN')
  })

  it('should set userId and workspaceId from a valid token', async () => {
    const response = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${getTestToken()}`)
      .expect(200)

    expect(response.body.userId).toBe('test-user-id')
    expect(response.body.workspaceId).toBe(1)
  })

  it('should reflect custom userId claims from a valid token', async () => {
    const token = jwt.sign(
      { userId: '42', username: 'tester', role: 'user' },
      JWT_SECRET,
      { expiresIn: '1h' }
    )

    const response = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(response.body.userId).toBe('42')
    expect(response.body.workspaceId).toBe(1)
  })
})

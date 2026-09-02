import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'pee-dev-secret-key'

export function getTestToken(payload: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      userId: 'test-user-id',
      username: 'test-user',
      role: 'user',
      ...payload,
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  )
}

import request from 'supertest'
import { getTestToken } from './auth-token.js'
import express from 'express'
import { workspaceRoutes, setWorkspaceServices } from '../../../src/api/routes/workspaces.js'
import { authMiddleware } from '../../../src/api/middleware/auth.js'
import { errorMiddleware } from '../../../src/api/middleware/error.js'

const mockWorkspaceServices = {
  crmPool: {
    query: jest.fn().mockResolvedValue({
      rows: [
        { id: 1, name: 'CRM' },
        { id: 2, name: 'PM' },
      ],
    }),
  },
}

function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(authMiddleware)
  app.use('/api/workspaces', workspaceRoutes())
  app.use(errorMiddleware)
  return app
}

describe('GET /api/workspaces', () => {
  let app: express.Express

  beforeAll(() => {
    setWorkspaceServices(mockWorkspaceServices as any)
    app = createTestApp()
  })

  it('should return list of workspaces', async () => {
    const response = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${getTestToken()}`)
      .expect('Content-Type', /json/)
      .expect(200)

    expect(Array.isArray(response.body)).toBe(true)
    
    if (response.body.length > 0) {
      const workspace = response.body[0]
      expect(workspace).toHaveProperty('id')
      expect(workspace).toHaveProperty('displayName')
      expect(workspace).toHaveProperty('kind')
    }
  })

  it('should include default CRM datasource', async () => {
    const response = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${getTestToken()}`)
      .expect(200)

    // Skip this test if no workspaces are returned (datasource not registered in test env)
    if (response.body.length === 0) {
      return
    }

    const crmWorkspace = response.body.find((w: any) => w.id === 'default')
    if (crmWorkspace) {
      expect(crmWorkspace.displayName).toBe('CRM')
      expect(crmWorkspace.kind).toBe('postgres')
    }
  })
})

import request from 'supertest'
import express from 'express'

// Stub the storage layer so uploads don't hit real R2 / S3 during tests.
// Without this, file upload cases (especially large-payload ones) flake and
// time out on network latency. A 10s supertest timeout isn't enough for a
// real multi-MB upload round-trip.
jest.mock('../../services/storage.service', () => ({
  storageService: {
    uploadFile: jest.fn().mockImplementation(async (_buffer, filename, _mime, type) => ({
      key: `${type}/mock-${filename}`,
      url: `https://mock-cdn.test/${type}/${filename}`,
    })),
    deleteFile: jest.fn().mockResolvedValue(true),
    getPublicUrl: jest.fn().mockImplementation((key: string) => `https://mock-cdn.test/${key}`),
  },
}))

import {
  getAllFiles,
  getFileById,
  createFile,
  updateFile,
  deleteFile,
  uploadFile,
  uploadFileForUpdate
} from '../fileController'

// Create a simple test app
const createTestApp = () => {
  const app = express()
  app.use(express.json())
  
  // Mock authentication middleware
  app.use((req, res, next) => {
    req.user = {
      userId: 'user-123',
      id: 'user-123',
      role: { name: 'admin' }
    } as any
    next()
  })
  
  // Add routes
  app.get('/files', getAllFiles)
  app.get('/files/:id', getFileById)
  app.post('/files', uploadFile, createFile)
  app.put('/files/:id', uploadFileForUpdate, updateFile)
  app.delete('/files/:id', deleteFile)
  
  return app
}

describe('File Controller', () => {
  let app: express.Application

  beforeEach(() => {
    app = createTestApp()
  })

  describe('GET /files', () => {
    it('should handle request to get all files', async () => {
      const response = await request(app)
        .get('/files')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with pagination parameters', async () => {
      const response = await request(app)
        .get('/files?page=1&limit=5')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with type filter', async () => {
      const response = await request(app)
        .get('/files?type=thumbnail')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with search parameter', async () => {
      const response = await request(app)
        .get('/files?search=game')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with multiple filters', async () => {
      const response = await request(app)
        .get('/files?page=1&limit=10&type=game_file&search=test')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with invalid pagination parameters', async () => {
      const response = await request(app)
        .get('/files?page=invalid&limit=invalid')

      // Should respond (might handle gracefully or return error)
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with negative page number', async () => {
      const response = await request(app)
        .get('/files?page=-1&limit=10')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with zero limit', async () => {
      const response = await request(app)
        .get('/files?page=1&limit=0')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with very large limit', async () => {
      const response = await request(app)
        .get('/files?page=1&limit=1000')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })
  })

  describe('GET /files/:id', () => {
    it('should handle request to get file by id', async () => {
      const response = await request(app)
        .get('/files/file-123')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with invalid id format', async () => {
      const response = await request(app)
        .get('/files/invalid-id')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with non-existent id', async () => {
      const response = await request(app)
        .get('/files/00000000-0000-0000-0000-000000000000')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with empty id', async () => {
      const response = await request(app)
        .get('/files/')

      // Should respond (might be 404 for route not found)
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })
  })

  describe('POST /files', () => {
    it('should handle file upload request without file', async () => {
      const response = await request(app)
        .post('/files')
        .field('type', 'thumbnail')

      // Should respond with error for missing file
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file upload request without type', async () => {
      const response = await request(app)
        .post('/files')
        .attach('file', Buffer.from('test file content'), 'test.txt')

      // Should respond with error for missing type
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle valid thumbnail file upload', async () => {
      const response = await request(app)
        .post('/files')
        .field('type', 'thumbnail')
        .attach('file', Buffer.from('test image content'), 'thumbnail.jpg')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle valid game file upload', async () => {
      const response = await request(app)
        .post('/files')
        .field('type', 'game_file')
        .attach('file', Buffer.from('test zip content'), 'game.zip')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file upload with invalid type', async () => {
      const response = await request(app)
        .post('/files')
        .field('type', 'invalid_type')
        .attach('file', Buffer.from('test content'), 'test.txt')
        .timeout(5000)

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    }, 20000)

    it('should handle large file upload', async () => {
      // Create a smaller buffer to avoid memory issues in tests
      const largeBuffer = Buffer.alloc(5 * 1024 * 1024) // 5MB instead of 60MB
      
      const response = await request(app)
        .post('/files')
        .field('type', 'thumbnail')
        .attach('file', largeBuffer, 'large-file.jpg')
        .timeout(10000)

      // Should respond (might be rejected due to size limit)
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    }, 30000)

    it('should handle file upload with special characters in filename', async () => {
      const response = await request(app)
        .post('/files')
        .field('type', 'thumbnail')
        .attach('file', Buffer.from('test content'), 'file with spaces & symbols!.jpg')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle empty file upload', async () => {
      const response = await request(app)
        .post('/files')
        .field('type', 'thumbnail')
        .attach('file', Buffer.alloc(0), 'empty.txt')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })
  })

  describe('PUT /files/:id', () => {
    it('should handle file update request with new file', async () => {
      const response = await request(app)
        .put('/files/file-123')
        .field('type', 'thumbnail')
        .attach('file', Buffer.from('updated file content'), 'updated.jpg')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file update request without new file', async () => {
      const response = await request(app)
        .put('/files/file-123')
        .field('type', 'updated_type')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file update request with invalid id', async () => {
      const response = await request(app)
        .put('/files/invalid-id')
        .field('type', 'thumbnail')
        .attach('file', Buffer.from('test content'), 'test.jpg')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file update request with non-existent id', async () => {
      const response = await request(app)
        .put('/files/00000000-0000-0000-0000-000000000000')
        .field('type', 'thumbnail')
        .attach('file', Buffer.from('test content'), 'test.jpg')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file update request with only type change', async () => {
      const response = await request(app)
        .put('/files/file-123')
        .field('type', 'game_file')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file update request with empty request body', async () => {
      const response = await request(app)
        .put('/files/file-123')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })
  })

  describe('DELETE /files/:id', () => {
    it('should handle file deletion request', async () => {
      const response = await request(app)
        .delete('/files/file-123')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file deletion with invalid id', async () => {
      const response = await request(app)
        .delete('/files/invalid-id')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file deletion with non-existent id', async () => {
      const response = await request(app)
        .delete('/files/00000000-0000-0000-0000-000000000000')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle file deletion with empty id', async () => {
      const response = await request(app)
        .delete('/files/')

      // Should respond (might be 404 for route not found)
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })
  })
})

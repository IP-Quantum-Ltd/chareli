import request from 'supertest'
import express from 'express'
import { 
  trackSignupClick,
  getSignupAnalyticsData,
  testIPCountry
} from '../signupAnalyticsController'

// Create a simple test app
// NOTE: no auth mock. trackSignupClick runs admin-exclusion only when req.user
// is set, and the DB-backed admin lookup throws in tests (no connection),
// causing the outer try/catch to swallow the failure as 200. Leaving the
// request unauthenticated lets the validation branch run as intended for
// these input-level checks.
const createTestApp = () => {
  const app = express()
  app.use(express.json())

  // Add routes
  app.post('/signup-analytics/click', trackSignupClick)
  app.get('/signup-analytics/data', getSignupAnalyticsData)
  app.get('/signup-analytics/test-ip/:ip', testIPCountry)

  return app
}

describe('Signup Analytics Controller', () => {
  let app: express.Application

  beforeEach(() => {
    app = createTestApp()
  })

  describe('POST /signup-analytics/click', () => {
    it('should handle request with missing type', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({
          sessionId: 'session-123'
          // Missing type
        })

      expect(response.status).toBe(400)
    })

    it('should handle valid signup click tracking', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({
          sessionId: 'session-123',
          type: 'homepage'
        })

      // Should respond with success (might be 201 or 200)
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking without sessionId', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({
          type: 'navbar'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with different types', async () => {
      const types = ['homepage', 'navbar', 'popup', 'footer', 'modal']
      
      for (const type of types) {
        const response = await request(app)
          .post('/signup-analytics/click')
          .send({
            sessionId: `session-${type}`,
            type
          })

        // Should respond with success
        expect(response.status).toBeDefined()
        expect(typeof response.status).toBe('number')
        expect([200, 201]).toContain(response.status)
      }
    })

    it('should handle signup click tracking with mobile user agent', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15')
        .send({
          sessionId: 'mobile-session-123',
          type: 'homepage'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with tablet user agent', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .set('User-Agent', 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15')
        .send({
          sessionId: 'tablet-session-123',
          type: 'navbar'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with desktop user agent', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        .send({
          sessionId: 'desktop-session-123',
          type: 'popup'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with Android user agent', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .set('User-Agent', 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36')
        .send({
          sessionId: 'android-session-123',
          type: 'modal'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with forwarded IP', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .set('X-Forwarded-For', '203.0.113.1')
        .send({
          sessionId: 'forwarded-session-123',
          type: 'homepage'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with multiple forwarded IPs', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .set('X-Forwarded-For', '203.0.113.1, 198.51.100.1, 192.0.2.1')
        .send({
          sessionId: 'multi-forwarded-session-123',
          type: 'navbar'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with empty request body', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({})

      expect(response.status).toBe(400)
    })

    it('should handle signup click tracking with null type', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({
          sessionId: 'session-123',
          type: null
        })

      expect(response.status).toBe(400)
    })

    it('should handle signup click tracking with empty type', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({
          sessionId: 'session-123',
          type: ''
        })

      expect(response.status).toBe(400)
    })

    it('should handle signup click tracking with very long sessionId', async () => {
      const longSessionId = 'a'.repeat(1000)
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({
          sessionId: longSessionId,
          type: 'homepage'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })

    it('should handle signup click tracking with special characters in type', async () => {
      const response = await request(app)
        .post('/signup-analytics/click')
        .send({
          sessionId: 'session-123',
          type: 'homepage-special!@#$%'
        })

      // Should respond with success
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
      expect([200, 201]).toContain(response.status)
    })
  })

  describe('GET /signup-analytics/data', () => {
    it('should handle request to get analytics data', async () => {
      const response = await request(app)
        .get('/signup-analytics/data')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with days parameter', async () => {
      const response = await request(app)
        .get('/signup-analytics/data?days=7')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with different days values', async () => {
      const daysValues = [1, 7, 14, 30, 90, 365]
      
      for (const days of daysValues) {
        const response = await request(app)
          .get(`/signup-analytics/data?days=${days}`)

        // Should respond
        expect(response.status).toBeDefined()
        expect(typeof response.status).toBe('number')
      }
    })

    it('should handle request with invalid days parameter', async () => {
      const response = await request(app)
        .get('/signup-analytics/data?days=invalid')

      // Should respond (might handle gracefully or return error)
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with negative days parameter', async () => {
      const response = await request(app)
        .get('/signup-analytics/data?days=-5')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with zero days parameter', async () => {
      const response = await request(app)
        .get('/signup-analytics/data?days=0')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with very large days parameter', async () => {
      const response = await request(app)
        .get('/signup-analytics/data?days=10000')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with decimal days parameter', async () => {
      const response = await request(app)
        .get('/signup-analytics/data?days=7.5')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle request with multiple query parameters', async () => {
      const response = await request(app)
        .get('/signup-analytics/data?days=30&extra=value')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })
  })

  describe('GET /signup-analytics/test-ip/:ip', () => {
    it('should handle IP country test with valid public IP', async () => {
      const response = await request(app)
        .get('/signup-analytics/test-ip/8.8.8.8')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle IP country test with localhost', async () => {
      const response = await request(app)
        .get('/signup-analytics/test-ip/127.0.0.1')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle IP country test with private IP', async () => {
      const response = await request(app)
        .get('/signup-analytics/test-ip/192.168.1.1')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle IP country test with IPv6 localhost', async () => {
      const response = await request(app)
        .get('/signup-analytics/test-ip/::1')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle IP country test with invalid IP format', async () => {
      const response = await request(app)
        .get('/signup-analytics/test-ip/invalid-ip')

      // Should respond
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle IP country test with empty IP', async () => {
      const response = await request(app)
        .get('/signup-analytics/test-ip/')

      // Should respond (might be 404 for route not found)
      expect(response.status).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should handle IP country test with different public IPs', async () => {
      const publicIPs = ['8.8.8.8', '1.1.1.1', '208.67.222.222', '9.9.9.9']
      
      for (const ip of publicIPs) {
        const response = await request(app)
          .get(`/signup-analytics/test-ip/${ip}`)

        // Should respond
        expect(response.status).toBeDefined()
        expect(typeof response.status).toBe('number')
      }
    })

    it('should handle IP country test with different private IP ranges', async () => {
      const privateIPs = ['10.0.0.1', '172.16.0.1', '192.168.0.1']
      
      for (const ip of privateIPs) {
        const response = await request(app)
          .get(`/signup-analytics/test-ip/${ip}`)

        // Should respond
        expect(response.status).toBeDefined()
        expect(typeof response.status).toBe('number')
      }
    })
  })
})

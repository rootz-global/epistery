import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, TestApp, TEST_PROVIDER } from '../utils';

describe('Domain Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('POST /domain/initialize', () => {
    it('should require provider configuration', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/domain/initialize')
        .set('Host', 'localhost')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('provider');
    });

    it('should require provider name', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/domain/initialize')
        .set('Host', 'localhost')
        .send({
          provider: {
            chainId: 80002,
            rpc: 'https://rpc-amoy.polygon.technology'
            // Missing name
          }
        })
        .expect(400);

      expect(response.body.error).toContain('provider');
    });

    it('should require provider chainId', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/domain/initialize')
        .set('Host', 'localhost')
        .send({
          provider: {
            name: 'Polygon Amoy',
            rpc: 'https://rpc-amoy.polygon.technology'
            // Missing chainId
          }
        })
        .expect(400);

      expect(response.body.error).toContain('provider');
    });

    it('should require provider rpc', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/domain/initialize')
        .set('Host', 'localhost')
        .send({
          provider: {
            name: 'Polygon Amoy',
            chainId: 80002
            // Missing rpc
          }
        })
        .expect(400);

      expect(response.body.error).toContain('provider');
    });

    it('should initialize domain with valid provider configuration', async () => {
      const testDomain = `test-init-${Date.now()}.local`;

      const response = await testApp.supertest
        .post('/.well-known/epistery/domain/initialize')
        .set('Host', testDomain)
        .send({
          provider: {
            name: TEST_PROVIDER.name,
            chainId: TEST_PROVIDER.chainId,
            rpc: TEST_PROVIDER.rpc
          }
        })
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.message).toContain('initialized');
    });

    it('should handle initialization of existing domain', async () => {
      // Initialize localhost which likely already exists
      const response = await testApp.supertest
        .post('/.well-known/epistery/domain/initialize')
        .set('Host', 'localhost')
        .send({
          provider: {
            name: TEST_PROVIDER.name,
            chainId: TEST_PROVIDER.chainId,
            rpc: TEST_PROVIDER.rpc
          }
        });

      // Should either succeed (update) or handle existing domain gracefully
      expect([200, 400]).toContain(response.status);
    });
  });
});

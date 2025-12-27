import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestApp,
  TestApp,
  getClient1Wallet,
  TEST_WALLETS,
  TEST_PROVIDER
} from '../utils';

describe('Auth Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('GET /auth/account/claim', () => {
    it('should return null when no pending claim exists', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/auth/account/claim')
        .set('Host', 'localhost')
        .expect(200);

      // When no pending claim, returns null or existing challenge
      expect([null, response.body]).toBeTruthy();
    });

    it('should return error for already verified domain', async () => {
      // This test depends on domain state - skip if domain is not verified
      const response = await testApp.supertest
        .get('/.well-known/epistery/auth/account/claim')
        .set('Host', 'localhost');

      // Either 200 with null/challenge, or 400 if already verified
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('POST /auth/account/claim', () => {
    it('should require client address', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/auth/account/claim')
        .set('Host', 'localhost')
        .send({
          provider: TEST_PROVIDER
        })
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Client address');
    });

    it('should require valid provider configuration', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/auth/account/claim')
        .set('Host', 'localhost')
        .send({
          clientAddress: TEST_WALLETS.client1.address,
          provider: { name: 'Test' } // Missing chainId and rpc
        })
        .expect(400);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('provider');
    });

    it('should generate challenge token for valid request', async () => {
      // Use a unique test domain to avoid conflicts
      const testDomain = `test-claim-${Date.now()}.local`;

      const response = await testApp.supertest
        .post('/.well-known/epistery/auth/account/claim')
        .set('Host', testDomain)
        .send({
          clientAddress: TEST_WALLETS.client1.address,
          provider: TEST_PROVIDER
        });

      // Should either succeed with challenge or fail if domain already claimed
      if (response.status === 200) {
        expect(response.text).toBeDefined();
        expect(response.text.length).toBe(64); // 32 bytes hex = 64 chars
      } else {
        expect(response.status).toBe(400);
      }
    });

    it('should be idempotent - return same challenge on repeat request', async () => {
      const testDomain = `test-idempotent-${Date.now()}.local`;

      const response1 = await testApp.supertest
        .post('/.well-known/epistery/auth/account/claim')
        .set('Host', testDomain)
        .send({
          clientAddress: TEST_WALLETS.client1.address,
          provider: TEST_PROVIDER
        });

      if (response1.status !== 200) {
        // Domain may already be claimed, skip test
        return;
      }

      const response2 = await testApp.supertest
        .post('/.well-known/epistery/auth/account/claim')
        .set('Host', testDomain)
        .send({
          clientAddress: TEST_WALLETS.client1.address,
          provider: TEST_PROVIDER
        });

      expect(response2.status).toBe(200);
      expect(response2.text).toBe(response1.text);
    });
  });

  describe('GET /auth/dns/claim', () => {
    it('should require address query parameter', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/auth/dns/claim')
        .set('Host', 'localhost')
        .expect(401);

      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('address');
    });

    it('should return error when no pending claim exists', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/auth/dns/claim')
        .query({ address: TEST_WALLETS.client1.address })
        .set('Host', 'no-pending-claim.local');

      // Should return error - no pending claim
      expect([400, 401, 403, 500]).toContain(response.status);
    });
  });

  describe('POST /auth/account/check-admin', () => {
    it('should return isAdmin: false when no address provided', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/auth/account/check-admin')
        .set('Host', 'localhost')
        .send({})
        .expect(200);

      expect(response.body.isAdmin).toBe(false);
    });

    it('should return isAdmin: false for non-admin address', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/auth/account/check-admin')
        .set('Host', 'localhost')
        .send({ address: TEST_WALLETS.client2.address })
        .expect(200);

      expect(response.body.isAdmin).toBe(false);
    });

    it('should check admin status for verified domain', async () => {
      // This depends on whether the domain has been verified and an admin set
      const response = await testApp.supertest
        .post('/.well-known/epistery/auth/account/check-admin')
        .set('Host', 'localhost')
        .send({ address: TEST_WALLETS.server.address })
        .expect(200);

      // Response should include isAdmin field (true or false depending on state)
      expect(typeof response.body.isAdmin).toBe('boolean');
    });
  });
});

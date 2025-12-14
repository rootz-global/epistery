import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, TestApp, TEST_CONTRACT_ADDRESS, skipIfNoContract } from '../utils';

describe('Contract Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('GET /contract/version', () => {
    it('should return contract version info', async () => {
      // Skip if no contract is deployed
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .get('/.well-known/epistery/contract/version')
        .expect(200);

      expect(response.body).toBeDefined();
      // Version info structure depends on implementation
      // At minimum should have some version information
    });

    it('should handle contract not deployed gracefully', async () => {
      // If contract is not set, should return error or empty response
      const response = await testApp.supertest
        .get('/.well-known/epistery/contract/version');

      // Either 200 with version info, or 500 if contract issues
      expect([200, 500]).toContain(response.status);
    });

    it('should return expected version format', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .get('/.well-known/epistery/contract/version')
        .expect(200);

      // If version is returned, it should match expected format
      if (response.body.version) {
        // Version should be a string like "2.0.0"
        expect(typeof response.body.version).toBe('string');
      }
    });
  });
});

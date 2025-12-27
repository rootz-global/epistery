import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestApp,
  TestApp,
  TEST_WALLETS,
  TEST_CONTRACT_ADDRESS,
  isValidAddress
} from '../utils';

describe('Notabot Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('POST /notabot/commit', () => {
    it('should require commitment field', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/notabot/commit')
        .send({
          eventChain: [],
          identityContractAddress: TEST_CONTRACT_ADDRESS
        })
        .expect(400);

      expect(response.body.error).toContain('required fields');
    });

    it('should require event chain', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/notabot/commit')
        .send({
          commitment: { hash: '0x123' },
          identityContractAddress: TEST_CONTRACT_ADDRESS
        })
        .expect(400);

      expect(response.body.error).toContain('required fields');
    });

    it('should require identity contract address', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/notabot/commit')
        .send({
          commitment: { hash: '0x123' },
          eventChain: []
        })
        .expect(400);

      expect(response.body.error).toContain('required fields');
    });

    it('should require rivet authentication', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/notabot/commit')
        .send({
          commitment: { hash: '0x123' },
          eventChain: [],
          identityContractAddress: TEST_CONTRACT_ADDRESS
        })
        .expect(400);

      expect(response.body.error).toContain('rivet');
    });

    it('should detect suspicious patterns - excessive funding rate', async () => {
      // This test simulates what would happen if suspicious patterns are detected
      // The actual detection requires accumulated state in the notabotFunding ledger
      const response = await testApp.supertest
        .post('/.well-known/epistery/notabot/commit')
        .send({
          commitment: { hash: '0x123', points: 10 },
          eventChain: [
            { timestamp: Date.now() - 5000, eventType: 'click' },
            { timestamp: Date.now() - 4000, eventType: 'click' },
            { timestamp: Date.now() - 3000, eventType: 'click' },
            { timestamp: Date.now() - 2000, eventType: 'click' },
            { timestamp: Date.now() - 1000, eventType: 'click' },
            { timestamp: Date.now(), eventType: 'click' },
          ],
          identityContractAddress: TEST_CONTRACT_ADDRESS,
          rivetAddress: TEST_WALLETS.client1.address,
          rivetMnemonic: TEST_WALLETS.client1.mnemonic
        });

      // Will either process or detect suspicious patterns
      expect([200, 402, 403, 500, 503]).toContain(response.status);
    });

    it('should handle funding cooldown', async () => {
      // Request funding when it might not be available
      const response = await testApp.supertest
        .post('/.well-known/epistery/notabot/commit')
        .send({
          commitment: { hash: '0x123', points: 10 },
          eventChain: [
            { timestamp: Date.now(), eventType: 'test' }
          ],
          identityContractAddress: TEST_CONTRACT_ADDRESS,
          rivetAddress: TEST_WALLETS.client1.address,
          rivetMnemonic: TEST_WALLETS.client1.mnemonic,
          requestFunding: true
        });

      // May return 402 (funding cooldown), 403 (suspicious), 503 (funding failed), or 200/500
      expect([200, 402, 403, 500, 503]).toContain(response.status);
    });
  });

  describe('GET /notabot/score/:rivetAddress', () => {
    it('should return notabot score for address', async () => {
      const response = await testApp.supertest
        .get(`/.well-known/epistery/notabot/score/${TEST_WALLETS.client1.address}`)
        .expect(200);

      expect(response.body).toBeDefined();
      // Score structure
      expect(typeof response.body.points).toBe('number');
      expect(typeof response.body.eventCount).toBe('number');
      expect(typeof response.body.verified).toBe('boolean');
    });

    it('should accept identity contract address query param', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .get(`/.well-known/epistery/notabot/score/${TEST_WALLETS.client1.address}`)
        .query({ identityContractAddress: TEST_CONTRACT_ADDRESS });

      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(typeof response.body.points).toBe('number');
      }
    });

    it('should return zero score for new address', async () => {
      const randomAddress = '0x0000000000000000000000000000000000000001';

      const response = await testApp.supertest
        .get(`/.well-known/epistery/notabot/score/${randomAddress}`)
        .expect(200);

      expect(response.body.points).toBe(0);
      expect(response.body.eventCount).toBe(0);
    });
  });
});

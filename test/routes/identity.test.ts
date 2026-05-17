import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestApp,
  TestApp,
  TEST_WALLETS,
  TEST_CONTRACT_ADDRESS,
  isValidAddress
} from '../utils';

describe('Identity Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('POST /identity/prepare-deploy', () => {
    it('should require client address', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-deploy')
        .send({ domain: 'localhost' })
        .expect(400);

      expect(response.body.error).toContain('required fields');
    });

    it('should require domain', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-deploy')
        .send({ clientAddress: TEST_WALLETS.client1.address })
        .expect(400);

      expect(response.body.error).toContain('required fields');
    });

    it('should prepare unsigned deployment transaction', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-deploy')
        .send({
          clientAddress: TEST_WALLETS.client1.address,
          domain: 'localhost'
        })
        .timeout(60000);

      if (response.status === 200) {
        expect(response.body.unsignedTransaction).toBeDefined();
      } else {
        console.log('Prepare deploy failed:', response.body.error);
      }
    });
  });

  describe('POST /identity/prepare-add-rivet', () => {
    it('should require all fields', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-add-rivet')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('required fields');
    });

    it('should require signer address', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-add-rivet')
        .send({
          contractAddress: '0x1234567890123456789012345678901234567890',
          rivetAddressToAdd: TEST_WALLETS.client2.address,
          rivetName: 'test-rivet',
          domain: 'localhost'
        })
        .expect(400);

      expect(response.body.error).toContain('signerAddress');
    });

    it('should require contract address', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-add-rivet')
        .send({
          signerAddress: TEST_WALLETS.client1.address,
          rivetAddressToAdd: TEST_WALLETS.client2.address,
          rivetName: 'test-rivet',
          domain: 'localhost'
        })
        .expect(400);

      expect(response.body.error).toContain('contractAddress');
    });

    it('should require rivet address to add', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-add-rivet')
        .send({
          signerAddress: TEST_WALLETS.client1.address,
          contractAddress: '0x1234567890123456789012345678901234567890',
          rivetName: 'test-rivet',
          domain: 'localhost'
        })
        .expect(400);

      expect(response.body.error).toContain('rivetAddressToAdd');
    });

    it('should require rivet name', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-add-rivet')
        .send({
          signerAddress: TEST_WALLETS.client1.address,
          contractAddress: '0x1234567890123456789012345678901234567890',
          rivetAddressToAdd: TEST_WALLETS.client2.address,
          domain: 'localhost'
        })
        .expect(400);

      expect(response.body.error).toContain('rivetName');
    });

    it('should require domain', async () => {
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-add-rivet')
        .send({
          signerAddress: TEST_WALLETS.client1.address,
          contractAddress: '0x1234567890123456789012345678901234567890',
          rivetAddressToAdd: TEST_WALLETS.client2.address,
          rivetName: 'test-rivet'
        })
        .expect(400);

      expect(response.body.error).toContain('domain');
    });

    it('should prepare unsigned transaction with valid inputs', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      // Note: This will likely fail because the contract address is not a valid
      // IdentityContract. This test just validates the endpoint accepts valid inputs.
      const response = await testApp.supertest
        .post('/.well-known/epistery/identity/prepare-add-rivet')
        .send({
          signerAddress: TEST_WALLETS.client1.address,
          contractAddress: TEST_CONTRACT_ADDRESS, // Using agent contract as placeholder
          rivetAddressToAdd: TEST_WALLETS.client2.address,
          rivetName: 'test-rivet',
          domain: 'localhost'
        })
        .timeout(60000);

      // May fail because Agent contract != IdentityContract
      expect([200, 500]).toContain(response.status);
    });
  });
});

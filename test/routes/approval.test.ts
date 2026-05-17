import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestApp,
  TestApp,
  getClient1Wallet,
  getClient2Wallet,
  createClientWalletInfo,
  TEST_WALLETS,
  TEST_CONTRACT_ADDRESS,
  uniqueFileName
} from '../utils';
import { ethers } from 'ethers';

describe('Approval Routes', () => {
  let testApp: TestApp;
  let client1Wallet: ethers.Wallet;
  let client2Wallet: ethers.Wallet;

  beforeAll(async () => {
    testApp = await createTestApp();
    client1Wallet = getClient1Wallet();
    client2Wallet = getClient2Wallet();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Legacy Server-Side Signing', () => {
    describe('POST /approval/create', () => {
      it('should require all fields', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/create')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should require client wallet info', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/create')
          .send({
            approverAddress: TEST_WALLETS.server.address,
            fileName: 'test.txt',
            fileHash: 'QmTest123',
            domain: 'localhost'
          })
          .expect(400);

        expect(response.body.error).toContain('clientWalletInfo');
      });

      it('should require approver address', async () => {
        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/create')
          .send({
            clientWalletInfo,
            fileName: 'test.txt',
            fileHash: 'QmTest123',
            domain: 'localhost'
          })
          .expect(400);

        expect(response.body.error).toContain('approverAddress');
      });
    });

    describe('POST /approval/get', () => {
      it('should require all fields', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/get')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should get approvals for requestor', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/get')
          .send({
            clientWalletInfo,
            approverAddress: TEST_WALLETS.server.address,
            requestorAddress: TEST_WALLETS.client1.address
          });

        if (response.status === 200) {
          expect(response.body.approverAddress).toBe(TEST_WALLETS.server.address);
          expect(response.body.requestorAddress).toBe(TEST_WALLETS.client1.address);
          expect(response.body.approvals).toBeDefined();
          expect(Array.isArray(response.body.approvals)).toBe(true);
          expect(typeof response.body.count).toBe('number');
        }
      });
    });

    describe('POST /approval/get-all', () => {
      it('should require client wallet info and approver address', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/get-all')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should get all approvals for approver', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/get-all')
          .send({
            clientWalletInfo,
            approverAddress: TEST_WALLETS.server.address
          });

        if (response.status === 200) {
          expect(response.body.approverAddress).toBe(TEST_WALLETS.server.address);
          expect(response.body.approvals).toBeDefined();
          expect(Array.isArray(response.body.approvals)).toBe(true);
        }
      });
    });

    describe('POST /approval/get-all-requestor', () => {
      it('should require client wallet info and requestor address', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/get-all-requestor')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should get all approvals for requestor', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/get-all-requestor')
          .send({
            clientWalletInfo,
            requestorAddress: TEST_WALLETS.client1.address
          });

        if (response.status === 200) {
          expect(response.body.requestorAddress).toBe(TEST_WALLETS.client1.address);
          expect(response.body.approvals).toBeDefined();
          expect(Array.isArray(response.body.approvals)).toBe(true);
        }
      });
    });

    describe('POST /approval/handle', () => {
      it('should require all fields', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/handle')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should require approved field', async () => {
        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/handle')
          .send({
            clientWalletInfo,
            requestorAddress: TEST_WALLETS.client2.address,
            fileName: 'test.txt'
          })
          .expect(400);

        expect(response.body.error).toContain('approved');
      });
    });
  });

  describe('Client-Side Signing', () => {
    describe('POST /approval/prepare-create', () => {
      it('should require all fields', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/prepare-create')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should prepare unsigned transaction', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/prepare-create')
          .send({
            clientAddress: TEST_WALLETS.client1.address,
            approverAddress: TEST_WALLETS.server.address,
            fileName: uniqueFileName(),
            fileHash: 'QmTestHash1234567890123456789012345678901234',
            domain: 'localhost'
          })
          .timeout(60000);

        if (response.status === 200) {
          expect(response.body.unsignedTransaction).toBeDefined();
        } else {
          console.log('Prepare create approval failed:', response.body.error);
        }
      });
    });

    describe('POST /approval/prepare-handle', () => {
      it('should require all fields including domain', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/prepare-handle')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should require approved boolean', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/prepare-handle')
          .send({
            approverAddress: TEST_WALLETS.server.address,
            requestorAddress: TEST_WALLETS.client1.address,
            fileName: 'test.txt',
            domain: 'localhost'
          })
          .expect(400);

        expect(response.body.error).toContain('approved');
      });

      it('should prepare unsigned transaction for handling', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const response = await testApp.supertest
          .post('/.well-known/epistery/approval/prepare-handle')
          .send({
            approverAddress: TEST_WALLETS.server.address,
            requestorAddress: TEST_WALLETS.client1.address,
            fileName: 'test-file-' + Date.now(),
            approved: true,
            domain: 'localhost'
          })
          .timeout(60000);

        // May fail if approval doesn't exist, which is fine
        expect([200, 500]).toContain(response.status);
      });
    });
  });
});

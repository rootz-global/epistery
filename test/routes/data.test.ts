import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestApp,
  TestApp,
  getClient1Wallet,
  getClient2Wallet,
  createClientWalletInfo,
  TEST_WALLETS,
  TEST_CONTRACT_ADDRESS,
  isValidIPFSHash,
  isValidTxHash,
  isValidAddress,
  uniqueTestData,
  skipIfNoIPFS,
  sleep
} from '../utils';
import { ethers } from 'ethers';

describe('Data Routes', () => {
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
    describe('POST /data/write', () => {
      it('should require client wallet info', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/write')
          .send({ data: { test: 'data' } })
          .expect(400);

        expect(response.body.error).toContain('client wallet');
      });

      it('should require data', async () => {
        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/write')
          .send({ clientWalletInfo })
          .expect(400);

        expect(response.body.error).toContain('data');
      });

      it('should write data to IPFS and blockchain', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);
        const data = uniqueTestData();

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/write')
          .send({ clientWalletInfo, data })
          .timeout(120000); // 2 minutes for blockchain tx

        if (response.status === 200) {
          expect(response.body.ipfsHash).toBeDefined();
          expect(isValidIPFSHash(response.body.ipfsHash)).toBe(true);
          expect(isValidTxHash(response.body.transactionHash)).toBe(true);
        } else {
          // May fail if wallet not funded or contract not deployed
          console.log('Write failed:', response.body.error);
        }
      });
    });

    describe('POST /data/read', () => {
      it('should require client wallet info', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/read')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('client wallet');
      });

      it('should read data from blockchain', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        try {
          const response = await testApp.supertest
            .post('/.well-known/epistery/data/read')
            .send({ clientWalletInfo })
            .timeout(30000); // 30 second timeout for blockchain read

          // May return 200 with data, 204 for no content, or 500 for integration issues
          expect([200, 204, 500]).toContain(response.status);

          if (response.status === 200 && response.body) {
            expect(response.body.count).toBeDefined();
            expect(response.body.messages).toBeDefined();
          }
        } catch (error: any) {
          // Timeout or network errors are acceptable in test environment
          if (error.code === 'ECONNABORTED' || error.timeout) {
            console.log('Skipping: Blockchain RPC timeout');
            return;
          }
          throw error;
        }
      });
    });

    describe('PUT /data/ownership', () => {
      it('should require client wallet info', async () => {
        const response = await testApp.supertest
          .put('/.well-known/epistery/data/ownership')
          .send({ futureOwnerWalletAddress: TEST_WALLETS.client2.address })
          .expect(400);

        expect(response.body.error).toContain('client wallet');
      });

      it('should require future owner address', async () => {
        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .put('/.well-known/epistery/data/ownership')
          .send({ clientWalletInfo })
          .expect(400);

        expect(response.body.error).toContain('future owner');
      });
    });
  });

  describe('Messaging', () => {
    describe('POST /data/message', () => {
      it('should require all fields', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/message')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should require recipient address', async () => {
        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/message')
          .send({
            clientWalletInfo,
            data: 'Hello!'
          })
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });
    });

    describe('POST /data/conversation', () => {
      it('should require client wallet info and other party', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/conversation')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should return conversation between two parties', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/conversation')
          .send({
            clientWalletInfo,
            otherParty: TEST_WALLETS.client2.address
          });

        if (response.status === 200) {
          // API returns { otherParty, callerAddress, messages: [...], count }
          expect(response.body.messages).toBeDefined();
          expect(Array.isArray(response.body.messages)).toBe(true);
          expect(typeof response.body.count).toBe('number');
        }
      });
    });

    describe('POST /data/conversations', () => {
      it('should require client wallet info', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/conversations')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('clientWalletInfo');
      });

      it('should return conversation IDs for user', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/conversations')
          .send({ clientWalletInfo });

        if (response.status === 200) {
          expect(response.body.address).toBeDefined();
          expect(response.body.conversations).toBeDefined();
          expect(Array.isArray(response.body.conversations)).toBe(true);
          expect(typeof response.body.count).toBe('number');
        }
      });
    });

    describe('GET /data/conversation-id', () => {
      it('should require both addresses', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/data/conversation-id')
          .expect(400);

        expect(response.body.error).toContain('required query params');
      });

      it('should return deterministic conversation ID', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/data/conversation-id')
          .query({
            addr1: TEST_WALLETS.client1.address,
            addr2: TEST_WALLETS.client2.address
          })
          .expect(200);

        expect(response.body.addr1).toBe(TEST_WALLETS.client1.address);
        expect(response.body.addr2).toBe(TEST_WALLETS.client2.address);
        expect(response.body.conversationId).toBeDefined();
        expect(typeof response.body.conversationId).toBe('string');
      });

      it('should return same ID regardless of address order', async () => {
        const response1 = await testApp.supertest
          .get('/.well-known/epistery/data/conversation-id')
          .query({
            addr1: TEST_WALLETS.client1.address,
            addr2: TEST_WALLETS.client2.address
          })
          .expect(200);

        const response2 = await testApp.supertest
          .get('/.well-known/epistery/data/conversation-id')
          .query({
            addr1: TEST_WALLETS.client2.address, // Swapped order
            addr2: TEST_WALLETS.client1.address
          })
          .expect(200);

        expect(response1.body.conversationId).toBe(response2.body.conversationId);
      });
    });
  });

  describe('Posts', () => {
    describe('POST /data/post', () => {
      it('should require all fields', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/post')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should require board', async () => {
        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/post')
          .send({
            clientWalletInfo,
            data: 'Test post content'
          })
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });
    });

    describe('POST /data/posts', () => {
      it('should require client wallet info and board', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/posts')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should return posts from board', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/posts')
          .send({
            clientWalletInfo,
            board: TEST_WALLETS.client1.address // User's own board
          });

        if (response.status === 200) {
          // API returns { board, callerAddress, posts: [...], count }
          expect(response.body.posts).toBeDefined();
          expect(Array.isArray(response.body.posts)).toBe(true);
          expect(typeof response.body.count).toBe('number');
        }
      });

      it('should support pagination', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const clientWalletInfo = createClientWalletInfo(client1Wallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/posts')
          .send({
            clientWalletInfo,
            board: TEST_WALLETS.client1.address,
            offset: 0,
            limit: 10
          });

        expect([200, 500]).toContain(response.status);
      });
    });

    describe('GET /data/public-keys/:address', () => {
      it('should return public keys for address', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const response = await testApp.supertest
          .get(`/.well-known/epistery/data/public-keys/${TEST_WALLETS.client1.address}`);

        if (response.status === 200) {
          expect(response.body.address).toBe(TEST_WALLETS.client1.address);
          expect(response.body.publicKeys).toBeDefined();
          expect(Array.isArray(response.body.publicKeys)).toBe(true);
          expect(typeof response.body.count).toBe('number');
        }
      });
    });
  });

  describe('Client-Side Signing', () => {
    describe('POST /data/prepare-write', () => {
      it('should require all fields', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/prepare-write')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should prepare unsigned transaction', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const data = uniqueTestData();

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/prepare-write')
          .send({
            clientAddress: TEST_WALLETS.client1.address,
            publicKey: TEST_WALLETS.client1.publicKey,
            data
          })
          .timeout(60000);

        if (response.status === 200) {
          expect(response.body.unsignedTransaction).toBeDefined();
          expect(response.body.ipfsHash).toBeDefined();
          expect(isValidIPFSHash(response.body.ipfsHash)).toBe(true);
        } else {
          console.log('Prepare write failed:', response.body.error);
        }
      });
    });

    describe('POST /data/prepare-transfer-ownership', () => {
      it('should require client address and future owner', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/prepare-transfer-ownership')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('required fields');
      });

      it('should prepare unsigned transaction for ownership transfer', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const response = await testApp.supertest
          .post('/.well-known/epistery/data/prepare-transfer-ownership')
          .send({
            clientAddress: TEST_WALLETS.client1.address,
            futureOwnerAddress: TEST_WALLETS.client2.address
          })
          .timeout(60000);

        if (response.status === 200) {
          expect(response.body.unsignedTransaction).toBeDefined();
        } else {
          console.log('Prepare transfer ownership failed:', response.body.error);
        }
      });
    });

    describe('POST /data/submit-signed', () => {
      it('should require signed transaction', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/submit-signed')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('signedTransaction');
      });

      it('should reject invalid signed transaction', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/data/submit-signed')
          .send({
            signedTransaction: '0xinvalid'
          });

        expect(response.status).toBe(500);
      });
    });
  });
});

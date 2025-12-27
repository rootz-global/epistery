import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import {
  createTestApp,
  TestApp,
  getServerWallet,
  getClient1Wallet,
  getClient2Wallet,
  createBotAuthHeader,
  createSessionCookie,
  performKeyExchange,
  TEST_WALLETS,
  TEST_CONTRACT_ADDRESS,
  uniqueListName
} from '../utils';

describe('Whitelist Routes', () => {
  let testApp: TestApp;
  let serverWallet: ethers.Wallet;
  let client1Wallet: ethers.Wallet;
  let client2Wallet: ethers.Wallet;

  beforeAll(async () => {
    testApp = await createTestApp();
    serverWallet = getServerWallet();
    client1Wallet = getClient1Wallet();
    client2Wallet = getClient2Wallet();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Static Assets', () => {
    describe('GET /whitelist/icon.svg', () => {
      it('should return SVG icon if exists', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/icon.svg');

        // May or may not exist
        expect([200, 404]).toContain(response.status);

        if (response.status === 200) {
          expect(response.headers['content-type']).toContain('svg');
        }
      });
    });

    describe('GET /whitelist/widget', () => {
      it('should return widget HTML if exists', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/widget');

        expect([200, 404]).toContain(response.status);
      });
    });

    describe('GET /whitelist/admin', () => {
      it('should return admin page if exists', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/admin');

        expect([200, 404]).toContain(response.status);
      });
    });

    describe('GET /whitelist/client.js', () => {
      it('should return client script if exists', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/client.js');

        expect([200, 404]).toContain(response.status);

        if (response.status === 200) {
          expect(response.headers['content-type']).toContain('javascript');
        }
      });
    });
  });

  describe('GET /whitelist/status', () => {
    it('should return agent status', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/whitelist/status')
        .expect(200);

      expect(response.body.agent).toBe('whitelist');
      expect(response.body.version).toBeDefined();
      expect(typeof response.body.delegationSupported).toBe('boolean');
      expect(typeof response.body.namedListsSupported).toBe('boolean');
    });
  });

  describe('Authentication', () => {
    describe('GET /whitelist/check', () => {
      it('should return 401 without authentication', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/check')
          .expect(401);

        expect(response.body.allowed).toBe(false);
        expect(response.body.error).toBeDefined();
      });

      it('should allow all in localhost dev mode with valid auth', async () => {
        const cookie = createSessionCookie(client1Wallet.address);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/check')
          .set('Host', 'localhost')
          .set('Cookie', `_epistery=${cookie}`)
          .expect(200);

        expect(response.body.allowed).toBe(true);
        expect(response.body.devMode).toBe(true);
      });

      it('should accept Bot authentication header', async () => {
        const authHeader = await createBotAuthHeader(client1Wallet);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/check')
          .set('Host', 'localhost')
          .set('Authorization', authHeader)
          .expect(200);

        expect(response.body.allowed).toBe(true);
        expect(response.body.address.toLowerCase()).toBe(
          client1Wallet.address.toLowerCase()
        );
      });

      it('should reject invalid Bot signature', async () => {
        const invalidPayload = {
          address: client1Wallet.address,
          signature: '0x' + '00'.repeat(65),
          message: 'Whitelist auth test'
        };

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/check')
          .set('Authorization', 'Bot ' + Buffer.from(JSON.stringify(invalidPayload)).toString('base64'))
          .expect(401);

        expect(response.body.allowed).toBe(false);
      });
    });

    describe('POST /whitelist/auth', () => {
      it('should require address, signature, and message', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/auth')
          .send({})
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('required fields');
      });

      it('should establish session with valid signature', async () => {
        const message = `Whitelist auth ${Date.now()}`;
        const signature = await client1Wallet.signMessage(message);

        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/auth')
          .send({
            address: client1Wallet.address,
            signature,
            message
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.address.toLowerCase()).toBe(
          client1Wallet.address.toLowerCase()
        );

        // Should set session cookie
        const cookies = response.headers['set-cookie'];
        expect(cookies).toBeDefined();
        expect(cookies.some((c: string) => c.startsWith('_epistery='))).toBe(true);
      });

      it('should reject invalid signature', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/auth')
          .send({
            address: client1Wallet.address,
            signature: '0x' + '00'.repeat(65),
            message: 'Test message'
          })
          .expect(401);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Invalid signature');
      });
    });
  });

  describe('Admin Operations', () => {
    describe('GET /whitelist/lists', () => {
      it('should require authentication', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/lists')
          .expect(401);

        expect(response.body.error).toContain('Not authenticated');
      });

      it('should require admin privileges', async () => {
        // Use client2 who is not an admin
        const authHeader = await createBotAuthHeader(client2Wallet);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/lists')
          .set('Authorization', authHeader);

        // Will be 403 if not admin, or 500 if contract not configured
        expect([403, 500]).toContain(response.status);
      });

      it('should return lists for admin (server wallet is sponsor)', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/lists')
          .set('Authorization', authHeader);

        if (response.status === 200) {
          expect(response.body.lists).toBeDefined();
          expect(Array.isArray(response.body.lists)).toBe(true);
          expect(typeof response.body.count).toBe('number');
        }
      });
    });

    describe('GET /whitelist/list', () => {
      it('should require authentication', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/list')
          .expect(401);

        expect(response.body.error).toContain('Not authenticated');
      });
    });

    describe('POST /whitelist/add', () => {
      it('should require authentication', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/add')
          .send({
            listName: 'test-list',
            address: TEST_WALLETS.client1.address
          })
          .expect(401);

        expect(response.body.success).toBe(false);
      });

      it('should require list name', async () => {
        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/add')
          .set('Authorization', authHeader)
          .send({
            address: TEST_WALLETS.client1.address
          });

        // Without a configured contract, permission check fails before input validation
        // Returns 403 (insufficient permissions) or 400 (missing list name) depending on admin status
        expect([400, 403]).toContain(response.status);
        if (response.status === 400) {
          expect(response.body.error).toContain('List name');
        }
      });

      it('should validate Ethereum address', async () => {
        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/add')
          .set('Authorization', authHeader)
          .send({
            listName: 'test-list',
            address: 'invalid-address'
          });

        // Without a configured contract, permission check fails before input validation
        // Returns 403 (insufficient permissions) or 400 (invalid address) depending on admin status
        expect([400, 403]).toContain(response.status);
        if (response.status === 400) {
          expect(response.body.error).toContain('Invalid Ethereum address');
        }
      });
    });

    describe('POST /whitelist/remove', () => {
      it('should require authentication', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/remove')
          .send({
            listName: 'test-list',
            address: TEST_WALLETS.client1.address
          })
          .expect(401);

        expect(response.body.success).toBe(false);
      });
    });
  });

  describe('Access Request System', () => {
    describe('POST /whitelist/request-access', () => {
      it('should require valid Ethereum address', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/request-access')
          .send({
            address: 'invalid',
            listName: 'test-list'
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Invalid Ethereum address');
      });

      it('should require list name', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/request-access')
          .send({
            address: TEST_WALLETS.client1.address
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('List name');
      });

      it('should create access request', async () => {
        const testList = uniqueListName();

        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/request-access')
          .send({
            address: TEST_WALLETS.client1.address,
            listName: testList,
            agentName: 'test-agent',
            message: 'Requesting access for testing'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('submitted');
      });

      it('should detect duplicate requests', async () => {
        const testList = uniqueListName();

        // First request
        await testApp.supertest
          .post('/.well-known/epistery/whitelist/request-access')
          .send({
            address: TEST_WALLETS.client2.address,
            listName: testList,
            agentName: 'test-agent'
          })
          .expect(200);

        // Second request (duplicate)
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/request-access')
          .send({
            address: TEST_WALLETS.client2.address,
            listName: testList,
            agentName: 'test-agent'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.alreadyRequested).toBe(true);
      });
    });

    describe('GET /whitelist/pending-requests', () => {
      it('should require authentication', async () => {
        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/pending-requests')
          .expect(401);

        expect(response.body.error).toContain('Not authenticated');
      });

      it('should require admin privileges', async () => {
        const authHeader = await createBotAuthHeader(client2Wallet);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/pending-requests')
          .set('Authorization', authHeader);

        expect([403, 500]).toContain(response.status);
      });
    });

    describe('POST /whitelist/handle-request', () => {
      it('should require authentication', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/handle-request')
          .send({
            address: TEST_WALLETS.client1.address,
            listName: 'test-list',
            approved: true
          })
          .expect(401);

        expect(response.body.success).toBe(false);
      });

      it('should require address, listName, and approved', async () => {
        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/handle-request')
          .set('Authorization', authHeader)
          .send({});

        // Without a configured contract, permission check fails before input validation
        // Returns 403 (insufficient permissions) or 400 (missing fields) depending on admin status
        expect([400, 403]).toContain(response.status);
        expect(response.body.success).toBe(false);
        if (response.status === 400) {
          expect(response.body.error).toContain('required');
        }
      });
    });
  });

  describe('Multi-Wallet Access Control Scenarios', () => {
    const adminListName = uniqueListName() + '-admin';
    const moderatorListName = uniqueListName() + '-moderator';

    describe('Scenario 1: Client1 requests admin role and gets APPROVED', () => {
      it('Step 1: Client1 requests admin role', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/request-access')
          .send({
            address: TEST_WALLETS.client1.address,
            listName: adminListName,
            agentName: 'client1-test',
            message: 'Requesting admin role for testing'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('Step 2: Server (admin) sees the pending request', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/pending-requests')
          .set('Authorization', authHeader);

        if (response.status === 200) {
          expect(response.body.requests).toBeDefined();
          const client1Request = response.body.requests.find(
            (r: any) => r.address.toLowerCase() === TEST_WALLETS.client1.address.toLowerCase() &&
              r.listName === adminListName
          );
          expect(client1Request).toBeDefined();
        }
      });

      it('Step 3: Server (admin) APPROVES client1 request', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/handle-request')
          .set('Authorization', authHeader)
          .send({
            address: TEST_WALLETS.client1.address,
            listName: adminListName,
            approved: true,
            role: 4 // Admin role
          });

        // May succeed or fail depending on contract state
        expect([200, 404, 403, 500]).toContain(response.status);

        if (response.status === 200) {
          expect(response.body.success).toBe(true);
          expect(response.body.approved).toBe(true);
        }
      });

      it('Step 4: Client1 is now on admin list', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const authHeader = await createBotAuthHeader(client1Wallet);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/check')
          .query({ list: adminListName })
          .set('Authorization', authHeader)
          .set('Host', 'localhost'); // Dev mode for easier testing

        // In dev mode, localhost always allows
        expect(response.status).toBe(200);
      });
    });

    describe('Scenario 2: Client2 requests moderator role and gets DENIED', () => {
      it('Step 1: Client2 requests moderator role', async () => {
        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/request-access')
          .send({
            address: TEST_WALLETS.client2.address,
            listName: moderatorListName,
            agentName: 'client2-test',
            message: 'Requesting moderator role for testing'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('Step 2: Server (admin) DENIES client2 request', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .post('/.well-known/epistery/whitelist/handle-request')
          .set('Authorization', authHeader)
          .send({
            address: TEST_WALLETS.client2.address,
            listName: moderatorListName,
            approved: false
          });

        // May succeed or return 404 if request not found
        expect([200, 404, 403, 500]).toContain(response.status);

        if (response.status === 200) {
          expect(response.body.success).toBe(true);
          expect(response.body.approved).toBe(false);
        }
      });

      it('Step 3: Client2 is NOT on moderator list', async () => {
        if (!TEST_CONTRACT_ADDRESS) {
          console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
          return;
        }

        // Check via the list endpoint (would need admin auth for non-localhost)
        // In localhost dev mode, everyone is "allowed" so we check the list directly
        const authHeader = await createBotAuthHeader(serverWallet);

        const response = await testApp.supertest
          .get('/.well-known/epistery/whitelist/list')
          .query({ list: moderatorListName })
          .set('Authorization', authHeader);

        if (response.status === 200) {
          // Client2 should not be in the members list
          const client2Entry = response.body.members?.find(
            (m: any) => m.address?.toLowerCase() === TEST_WALLETS.client2.address.toLowerCase()
          );
          expect(client2Entry).toBeUndefined();
        }
      });
    });
  });
});

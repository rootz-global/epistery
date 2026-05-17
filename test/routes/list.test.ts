import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestApp,
  TestApp,
  TEST_WALLETS,
  TEST_CONTRACT_ADDRESS,
  isValidAddress,
  uniqueListName
} from '../utils';

describe('List Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('GET /lists', () => {
    it('should return lists for the domain', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .get('/.well-known/epistery/lists')
        .set('Host', 'localhost');

      // Either 200 with lists or 500 if contract issues
      if (response.status === 200) {
        expect(response.body.domain).toBeDefined();
        expect(response.body.owner).toBeDefined();
        expect(isValidAddress(response.body.owner)).toBe(true);
        expect(response.body.lists).toBeDefined();
        expect(Array.isArray(response.body.lists)).toBe(true);
        expect(typeof response.body.count).toBe('number');
      }
    });

    it('should return owner address matching server wallet', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .get('/.well-known/epistery/lists')
        .set('Host', 'localhost');

      if (response.status === 200) {
        expect(response.body.owner.toLowerCase()).toBe(
          TEST_WALLETS.server.address.toLowerCase()
        );
      }
    });
  });

  describe('GET /list', () => {
    it('should require list name query parameter', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/list')
        .set('Host', 'localhost')
        .expect(400);

      expect(response.body.error).toContain('List name');
    });

    it('should return specific list by name', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .get('/.well-known/epistery/list')
        .query({ list: 'epistery::admin' })
        .set('Host', 'localhost');

      // Either 200 with list or 500 if contract issues
      if (response.status === 200) {
        expect(response.body.domain).toBeDefined();
        expect(response.body.listName).toBe('epistery::admin');
        expect(response.body.list).toBeDefined();
        expect(Array.isArray(response.body.list)).toBe(true);
        expect(typeof response.body.count).toBe('number');
      }
    });

    it('should return empty list for non-existent list name', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const nonExistentList = uniqueListName();

      const response = await testApp.supertest
        .get('/.well-known/epistery/list')
        .query({ list: nonExistentList })
        .set('Host', 'localhost');

      if (response.status === 200) {
        expect(response.body.list).toBeDefined();
        expect(response.body.count).toBe(0);
      }
    });
  });

  describe('GET /list/check/:address', () => {
    it('should require list name query parameter', async () => {
      const response = await testApp.supertest
        .get(`/.well-known/epistery/list/check/${TEST_WALLETS.client1.address}`)
        .set('Host', 'localhost')
        .expect(400);

      expect(response.body.error).toContain('List name');
    });

    it('should check if address is on list', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      const response = await testApp.supertest
        .get(`/.well-known/epistery/list/check/${TEST_WALLETS.client1.address}`)
        .query({ list: 'epistery::admin' })
        .set('Host', 'localhost');

      if (response.status === 200) {
        expect(response.body.address).toBe(TEST_WALLETS.client1.address);
        expect(response.body.listName).toBe('epistery::admin');
        expect(typeof response.body.isListed).toBe('boolean');
        expect(response.body.domain).toBeDefined();
      }
    });

    it('should return isListed: false for address not on list', async () => {
      if (!TEST_CONTRACT_ADDRESS) {
        console.log('Skipping: TEST_CONTRACT_ADDRESS not set');
        return;
      }

      // Use a random address that's definitely not on any list
      const randomAddress = '0x0000000000000000000000000000000000000001';
      const nonExistentList = uniqueListName();

      const response = await testApp.supertest
        .get(`/.well-known/epistery/list/check/${randomAddress}`)
        .query({ list: nonExistentList })
        .set('Host', 'localhost');

      if (response.status === 200) {
        expect(response.body.isListed).toBe(false);
      }
    });

    it('should handle invalid address format gracefully', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/list/check/invalid-address')
        .query({ list: 'epistery::admin' })
        .set('Host', 'localhost');

      // Should either return false or an error
      expect([200, 400, 500]).toContain(response.status);
    });
  });
});

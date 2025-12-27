import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, TestApp, TEST_WALLETS } from '../utils';

describe('Status Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('GET /', () => {
    it('should return JSON status when Accept: application/json', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/')
        .set('Accept', 'application/json')
        .expect(200)
        .expect('Content-Type', /json/);

      expect(response.body).toBeDefined();
      // buildStatus() returns { server, client, ipfs, timestamp }
      expect(response.body.server).toBeDefined();
      expect(response.body.server.walletAddress).toBeDefined();
    });

    it('should return HTML status page when Accept: text/html', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/')
        .set('Accept', 'text/html')
        .expect(200);

      expect(response.text).toContain('<!DOCTYPE html>');
    });

    it('should return HTML by default for browser requests', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/')
        .set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
        .expect(200);

      expect(response.text).toContain('<!DOCTYPE html>');
    });
  });

  describe('GET /status', () => {
    it('should return HTML status page', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/status')
        .expect(200);

      expect(response.text).toContain('<!DOCTYPE html>');
    });

    it('should include server domain in template', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/status')
        .set('Host', 'localhost:3000')
        .expect(200);

      expect(response.text).toContain('localhost');
    });
  });

  describe('GET /lib/:module', () => {
    it('should serve witness.js library', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/lib/witness.js')
        .expect(200)
        .expect('Content-Type', /javascript/);

      expect(response.text).toBeDefined();
      expect(response.text.length).toBeGreaterThan(0);
    });

    it('should serve wallet.js library', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/lib/wallet.js')
        .expect(200)
        .expect('Content-Type', /javascript/);

      expect(response.text).toBeDefined();
    });

    it('should serve client.js library', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/lib/client.js')
        .expect(200)
        .expect('Content-Type', /javascript/);

      expect(response.text).toBeDefined();
    });

    it('should serve ethers.js library', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/lib/ethers.js')
        .expect(200)
        .expect('Content-Type', /javascript/);

      expect(response.text).toBeDefined();
    });

    it('should return 404 for unknown library', async () => {
      await testApp.supertest
        .get('/.well-known/epistery/lib/unknown.js')
        .expect(404);
    });
  });

  describe('GET /artifacts/:contractFile', () => {
    it('should serve Agent.json contract artifact', async () => {
      const response = await testApp.supertest
        .get('/.well-known/epistery/artifacts/Agent.json')
        .expect(200)
        .expect('Content-Type', /json/);

      expect(response.body).toBeDefined();
      expect(response.body.abi).toBeDefined();
      expect(Array.isArray(response.body.abi)).toBe(true);
    });

    it('should return 404 for unknown contract artifact', async () => {
      await testApp.supertest
        .get('/.well-known/epistery/artifacts/Unknown.json')
        .expect(404);
    });
  });
});

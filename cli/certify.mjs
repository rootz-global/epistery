/**
 * Domain Certification is built on certbot. It uses the Acme client to generate
 * ssl certificates through Let's Encrypt.
 */
import { SSLController } from '../dist/controllers/ssl/SSLController.js';

export async function certify(context, domain) {
  const certify = new SSLController(context.epistery);
  await certify.getCert(domain);
}

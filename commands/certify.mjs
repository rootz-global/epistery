/**
 * Domain Certification is built on certbot. It uses the Acme client to generate
 * ssl certificates through Let's Encrypt.
 */
import express from 'express';
import acme from 'acme-client';
import tls from 'tls';
import Certify from '../modules/Certify/index.mjs';

export async function certify(context, domain) {
  const certify = new Certify(context.epistery);
  await certify.getCert(domain);
}

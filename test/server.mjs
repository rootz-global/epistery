import express from 'express';
import Epistery from '../index.mjs';
import Certify from "../modules/Certify/index.mjs";
import path from "path";
import https from "https";
import http from "http";

async function main() {
  const app = express();

  const epistery = await Epistery.connect()
  await epistery.attach(app);
  const certify = new Certify(epistery);

  app.get('/', (req, res) => {
    res.sendFile(path.resolve('test/index.html'));
  })

  const http_server = http.createServer(app);
  http_server.listen(process.env.PORT || 3000);
  http_server.on('error', console.error);
  http_server.on('listening',()=>{
    let address = http_server.address();
    console.log(`Listening on ${address.address} ${address.port} (${address.family})`);
  });

  const https_server = https.createServer(certify.SNI, app);
  https_server.listen(process.env.PORTSSL || 3443);
  https_server.on('error', console.error);
  https_server.on('listening', () => {
    let address = https_server.address();
    console.log(`Listening on ${address.address} ${address.port} (${address.family})`);
  });
}

main().catch(err => {
  console.error('failed', err);
  process.exit(1);
});

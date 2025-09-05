#!/usr/bin/env node
import {resolve} from "path";
import Epistery from './index.mjs';
import moment from 'moment';

function log(message) {
  console.log(`${moment().format('YY-MM-DD HH:mm:ss')}: ${message}`);
}

(async function main() {
  const epistery = await Epistery.connect();
  let params = Array.from(process.argv).slice(2);
  const command = params.shift();
  const module = await import(resolve(`./commands/${command}.mjs`));
  log(`${command} ${params[0]}`);
  await module[command].call(main,{epistery:epistery,log:log},...params);
  log(`completed`);
  process.exit(0);
})();

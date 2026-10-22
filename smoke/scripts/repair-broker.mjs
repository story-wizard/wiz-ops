#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {runRepairBroker} from '../runner/repair-broker.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--request'){console.error('Use the reviewed local launcher with --request ID.');process.exitCode=1;}
else console.log(JSON.stringify(await runRepairBroker({policyFile:fileURLToPath(new URL('../../broker-policy.json',import.meta.url)),requestId:args[1]})));

import { newLicenceKeys } from '../src/kernel/licence';
import { randomBytes } from 'node:crypto';

// Prints a new licence key pair and a provisioning key for .env. The private key belongs only on
// the Console; an ERP gets the public key. Keep the old pair while licences signed with it live.
//   npm run licence:keys
const k = newLicenceKeys();
console.log(`LICENCE_PRIVATE_KEY=${k.privateKey}`);
console.log(`LICENCE_PUBLIC_KEY=${k.publicKey}`);
console.log(`PROVISION_KEY=${randomBytes(32).toString('base64url')}`);

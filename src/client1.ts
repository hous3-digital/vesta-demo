import { createSDK } from './sdk-config';
import { initEnrollmentFlow } from './enrollment';

const sdk = createSDK('banco_vesta_digital');

initEnrollmentFlow({
  sdk,
  verifierId: 'verifier_banco_vesta_digital',
  minKycLevel: 2,
});

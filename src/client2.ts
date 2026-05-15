import { createSDK } from './sdk-config';
import { initEnrollmentFlow } from './enrollment';

const sdk = createSDK('vesta_seguros');

initEnrollmentFlow({
  sdk,
  verifierId: 'verifier_vesta_seguros',
  minKycLevel: 2,
});

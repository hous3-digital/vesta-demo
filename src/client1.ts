import { createSDK } from './sdk-config';
import { initEnrollmentFlow } from './enrollment';

const sdk = createSDK('brava_demo');

initEnrollmentFlow({
  sdk,
  verifierId: 'verifier_brava',
  minKycLevel: 2,
});

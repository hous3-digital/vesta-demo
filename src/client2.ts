import { createSDK } from './sdk-config';
import { initEnrollmentFlow } from './enrollment';

const sdk = createSDK('trove_demo');

initEnrollmentFlow({
  sdk,
  verifierId: 'verifier_trove',
  minKycLevel: 2,
});

/**
 * Fábrica de instâncias do VestaSDK para o demo.
 *
 * A API key é lida da env var VITE_VESTA_API_KEY, configurada
 * no .env local ou nas Environment Variables da Vercel.
 */
import { VestaSDK, VestaEnvironment } from '@hous3-digital/vesta-sdk';

const API_KEY = import.meta.env.VITE_VESTA_API_KEY as string | undefined;

if (!API_KEY) {
  throw new Error(
    'VITE_VESTA_API_KEY is not set. Create a .env file with:\n' +
    'VITE_VESTA_API_KEY=vesta_live_...',
  );
}

/**
 * Cria uma instância configurada do VestaSDK para o ambiente de demo.
 *
 * A API key identifica o issuer no backend. O demo não envia issuerId.
 * @returns Instância pronta para uso.
 *
 * @example
 * import { createSDK } from './sdk-config';
 * const sdk = createSDK();
 * const hasVC = await sdk.hasStoredCredential();
 */
export function createSDK(): VestaSDK {
  return new VestaSDK({
    apiKey: API_KEY,
    environment: VestaEnvironment.STAGING,
  });
}

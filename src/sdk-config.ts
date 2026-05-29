/**
 * Fábrica de instâncias do VestaSDK para o demo.
 *
 * A API key é lida da env var VITE_VESTA_API_KEY, configurada
 * no .env local ou nas Environment Variables da Vercel.
 */
import { VestaSDK } from '@hous3-digital/vesta-sdk';

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
 * @param issuerId - ID do integrador (banco/seguradora) enviado no header
 *   `X-Vesta-Issuer-ID`. Ex: "brava" ou "trove".
 * @returns Instância pronta para uso.
 *
 * @example
 * import { createSDK } from './sdk-config';
 * const sdk = createSDK('brava');
 * const hasVC = await sdk.hasStoredCredential();
 */
export function createSDK(issuerId: string): VestaSDK {
  return new VestaSDK({
    apiKey: API_KEY,
    issuerId,
  });
}

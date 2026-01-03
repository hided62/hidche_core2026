import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../gateway-api/src/router';

const getAdminToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem('sammo-admin-token');
};

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc', // 실제 환경에 맞게 조정 필요
      headers() {
        const token = getAdminToken();
        return token ? { 'x-admin-token': token } : {};
      },
    }),
  ],
});

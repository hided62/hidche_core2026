import { useRouter } from 'vue-router';
import { isAuxiliaryWindow } from '../utils/auxiliaryNavigation';

export const usePageExit = (): { pageExitLabel: '창 닫기' | '돌아가기'; exitPage: () => void } => {
    const router = useRouter();
    const canClose = isAuxiliaryWindow();
    const pageExitLabel = canClose ? '창 닫기' : '돌아가기';
    const exitPage = (): void => {
        if (canClose) {
            window.close();
            return;
        }
        void router.push('/');
    };
    return { pageExitLabel, exitPage };
};

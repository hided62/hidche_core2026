import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface UserInfo {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
}

export const useAuthStore = defineStore('auth', () => {
    const user = ref<UserInfo | null>(null);
    const isLoggedIn = ref(false);

    function setUser(userData: UserInfo | null) {
        user.value = userData;
        isLoggedIn.value = !!userData;
    }

    return { user, isLoggedIn, setUser };
});

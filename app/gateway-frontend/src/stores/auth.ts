import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null);
  const isLoggedIn = ref(false);

  function setUser(userData: any) {
    user.value = userData;
    isLoggedIn.value = !!userData;
  }

  return { user, isLoggedIn, setUser };
});

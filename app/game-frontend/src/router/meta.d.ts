import 'vue-router';

declare module 'vue-router' {
    interface RouteMeta {
        requiresAuth?: boolean;
        requiresGeneral?: boolean;
        publicOnly?: boolean;
    }
}

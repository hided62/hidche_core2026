import { defineStore } from 'pinia';

interface MapViewerState {
    showCityName: boolean;
    detailMode: boolean;
    singleTapNavigation: boolean;
    hoveredCityId: number | null;
    selectedCityId: number | null;
}

const SINGLE_TAP_STORAGE_KEY = 'sam.toggleSingleTap';

const loadSingleTapNavigation = (): boolean => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SINGLE_TAP_STORAGE_KEY) === 'yes';
};

export const useMapViewerStore = defineStore('mapViewer', {
    state: (): MapViewerState => ({
        showCityName: true,
        detailMode: true,
        singleTapNavigation: loadSingleTapNavigation(),
        hoveredCityId: null,
        selectedCityId: null,
    }),
    actions: {
        toggleCityName() {
            this.showCityName = !this.showCityName;
        },
        toggleDetailMode() {
            this.detailMode = !this.detailMode;
        },
        toggleSingleTapNavigation() {
            this.singleTapNavigation = !this.singleTapNavigation;
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(SINGLE_TAP_STORAGE_KEY, this.singleTapNavigation ? 'yes' : 'no');
            }
        },
        setHoveredCity(cityId: number | null) {
            this.hoveredCityId = cityId;
        },
        setSelectedCity(cityId: number | null) {
            this.selectedCityId = cityId;
        },
    },
});

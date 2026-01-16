import { defineStore } from 'pinia';

interface MapViewerState {
    showCityName: boolean;
    detailMode: boolean;
    hoveredCityId: number | null;
    selectedCityId: number | null;
}

export const useMapViewerStore = defineStore('mapViewer', {
    state: (): MapViewerState => ({
        showCityName: true,
        detailMode: false,
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
        setHoveredCity(cityId: number | null) {
            this.hoveredCityId = cityId;
        },
        setSelectedCity(cityId: number | null) {
            this.selectedCityId = cityId;
        },
    },
});

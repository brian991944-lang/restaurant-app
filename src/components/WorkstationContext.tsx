'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

/**
 * 'Management' is admin-only: its pill is hidden without admin, and the sidebar
 * moves a persisted 'Management' back to 'Salon' when admin is left. It is
 * still a real stored value, so it has to survive a reload in between.
 */
type Workstation = 'Cocina' | 'Salon' | 'Management' | null;

const STORED_STATIONS = ['Cocina', 'Salon', 'Management'] as const;

interface WorkstationContextType {
    station: Workstation;
    setStation: (station: Workstation) => void;
    isLoaded: boolean;
}

const WorkstationContext = createContext<WorkstationContextType>({
    station: null,
    setStation: () => { },
    isLoaded: false
});

export const WorkstationProvider = ({ children }: { children: React.ReactNode }) => {
    const [station, setStationState] = useState<Workstation>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem('fusionista_workstation');
        if (STORED_STATIONS.includes(stored as typeof STORED_STATIONS[number])) {
            setStationState(stored as Workstation);
        }
        setIsLoaded(true);
    }, []);

    const setStation = (newStation: Workstation) => {
        setStationState(newStation);
        if (newStation) {
            localStorage.setItem('fusionista_workstation', newStation);
        } else {
            localStorage.removeItem('fusionista_workstation');
        }
    };

    return (
        <WorkstationContext.Provider value={{ station, setStation, isLoaded }}>
            {children}
        </WorkstationContext.Provider>
    );
};

export const useWorkstation = () => useContext(WorkstationContext);

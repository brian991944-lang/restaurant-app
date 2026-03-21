'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Workstation = 'Cocina' | 'Salon' | null;

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
        if (stored === 'Cocina' || stored === 'Salon') {
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

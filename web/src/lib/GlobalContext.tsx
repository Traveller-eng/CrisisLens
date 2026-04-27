import React, { createContext, useContext, useState } from 'react';
import type { CrisisReport } from '../../../shared/crisis';

type GlobalStateContextType = {
  reports: CrisisReport[];
  setReports: React.Dispatch<React.SetStateAction<CrisisReport[]>>;
  zones: any[]; // Adjust type as needed
  setZones: React.Dispatch<React.SetStateAction<any[]>>;
  selectedEntity: { zoneId: string | null; reportId: string | null };
  setSelectedEntity: React.Dispatch<React.SetStateAction<{ zoneId: string | null; reportId: string | null }>>;
};

const GlobalStateContext = createContext<GlobalStateContextType | null>(null);

export function GlobalProvider({ children }: { children: React.ReactNode }) {
  const [reports, setReports] = useState<CrisisReport[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<{ zoneId: string | null; reportId: string | null }>({ zoneId: null, reportId: null });

  return (
    <GlobalStateContext.Provider value={{ reports, setReports, zones, setZones, selectedEntity, setSelectedEntity }}>
      {children}
    </GlobalStateContext.Provider>
  );
}

export function useGlobalState() {
  const context = useContext(GlobalStateContext);
  if (!context) throw new Error("useGlobalState must be used within GlobalProvider");
  return context;
}

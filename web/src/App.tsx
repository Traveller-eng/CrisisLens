import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { GlobalProvider } from './lib/GlobalContext';
import LandingPage from './pages/LandingPage';
import AgencyDashboard from './pages/AgencyDashboard';
import CitizenPage from './pages/CitizenPage';

export default function App() {
  return (
    <GlobalProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/agency" element={<AgencyDashboard />} />
          <Route path="/citizen" element={<CitizenPage />} />
        </Routes>
      </Router>
    </GlobalProvider>
  );
}

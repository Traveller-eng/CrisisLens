import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#050810',
      color: '#f0f4ff',
      fontFamily: '"Space Mono", monospace'
    }}>
      <div style={{ textAlign: 'center', maxWidth: '600px' }}>
        <p style={{ letterSpacing: '0.2em', fontSize: '0.8rem', color: '#8899bb', textTransform: 'uppercase' }}>
          Decision Intelligence Under Uncertainty
        </p>
        <h1 style={{ fontSize: '4rem', margin: '10px 0' }}>CrisisLens</h1>
        <hr style={{ width: '120px', border: '1px solid #1e2d50', margin: '20px auto' }} />
        
        <div style={{ display: 'flex', gap: '20px', marginTop: '40px' }}>
          <div style={{
            flex: 1,
            backgroundColor: '#0e1528',
            border: '1px solid #1e2d50',
            borderRadius: '10px',
            padding: '30px',
            cursor: 'pointer'
          }} onClick={() => navigate('/agency')}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>Command Center</h2>
            <p style={{ fontSize: '0.875rem', color: '#8899bb', fontFamily: '"IBM Plex Sans", sans-serif' }}>
              Full decision intelligence interface.
            </p>
            <button style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: 'transparent',
              border: '1px solid #00e5a0',
              color: '#00e5a0',
              borderRadius: '6px',
              cursor: 'pointer',
              width: '100%'
            }}>Enter Command Center →</button>
          </div>

          <div style={{
            flex: 1,
            backgroundColor: '#0e1528',
            border: '1px solid #1e2d50',
            borderRadius: '10px',
            padding: '30px',
            cursor: 'pointer'
          }} onClick={() => navigate('/citizen')}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>Citizen Mode</h2>
            <p style={{ fontSize: '0.875rem', color: '#8899bb', fontFamily: '"IBM Plex Sans", sans-serif' }}>
              Report incidents, find shelters, and track your report in real time.
            </p>
            <button style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: 'transparent',
              border: '1px solid #4a90d9',
              color: '#4a90d9',
              borderRadius: '6px',
              cursor: 'pointer',
              width: '100%'
            }}>Enter Citizen Mode →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SeriousGamesPage } from './presentation/features/serious-games/pages/SeriousGamesPage';
import { LoginPage } from './presentation/features/auth/pages/LoginPage';
import { PatientDashboard } from './presentation/features/dashboard/pages/PatientDashboard';
import { useAppStore } from './core/store/useAppStore';

function App() {
  const { isAuthenticated, userRole, login } = useAppStore();

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/" 
          element={
            !isAuthenticated ? <Navigate to="/login" /> : 
            userRole === 'PATIENT' ? <Navigate to="/patient/dashboard" /> :
            <Navigate to="/specialist/dashboard" />
          } 
        />
        <Route 
          path="/login" 
          element={
            isAuthenticated ? <Navigate to="/" /> : <LoginPage onLoginSuccess={login} />
          } 
        />
        {/* Rutas para Paciente */}
        <Route 
          path="/patient/dashboard" 
          element={
            isAuthenticated && userRole === 'PATIENT' ? 
            <PatientDashboard /> : 
            <Navigate to="/login" />
          } 
        />
        <Route 
          path="/serious-games" 
          element={
            isAuthenticated ? <SeriousGamesPage /> : <Navigate to="/login" />
          } 
        />
        {/* Rutas Temporales para Especialista */}
        <Route 
          path="/specialist/dashboard" 
          element={
            isAuthenticated && userRole === 'SPECIALIST' ? 
            <div className="p-10 font-sans"><h1>Dashboard Especialista (En Construcción)</h1></div> : 
            <Navigate to="/login" />
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

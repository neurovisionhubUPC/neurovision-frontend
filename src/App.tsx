import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WelcomePage } from './presentation/features/onboarding/pages/WelcomePage';
import { SeriousGamesPage } from './presentation/features/serious-games/pages/SeriousGamesPage';
import { LoginPage } from './presentation/features/auth/pages/LoginPage';
import { useAppStore } from './core/store/useAppStore';

function App() {
  const { hasCompletedOnboarding, isAuthenticated, login } = useAppStore();

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/" 
          element={
            !isAuthenticated ? <Navigate to="/login" /> : 
            hasCompletedOnboarding ? <Navigate to="/serious-games" /> : <WelcomePage />
          } 
        />
        <Route 
          path="/login" 
          element={
            isAuthenticated ? <Navigate to="/" /> : <LoginPage onLoginSuccess={login} />
          } 
        />
        <Route 
          path="/serious-games" 
          element={
            isAuthenticated ? <SeriousGamesPage /> : <Navigate to="/login" />
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

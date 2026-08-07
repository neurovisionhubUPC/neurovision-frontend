import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WelcomePage } from './presentation/features/onboarding/pages/WelcomePage';
import { SeriousGamesPage } from './presentation/features/serious-games/pages/SeriousGamesPage';
import { useAppStore } from './core/store/useAppStore';

function App() {
  const hasCompletedOnboarding = useAppStore(state => state.hasCompletedOnboarding);

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/" 
          element={hasCompletedOnboarding ? <Navigate to="/serious-games" /> : <WelcomePage />} 
        />
        <Route 
          path="/serious-games" 
          element={<SeriousGamesPage />} 
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

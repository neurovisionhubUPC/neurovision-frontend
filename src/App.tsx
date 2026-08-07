import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WelcomePage } from './presentation/features/onboarding/pages/WelcomePage';
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
          element={
            <div className="min-h-screen bg-hc-black flex items-center justify-center p-8">
              <h1 className="text-3xl text-hc-white text-center">
                Módulo Serious Games<br/>(Próximamente Integración con MediaPipe)
              </h1>
            </div>
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

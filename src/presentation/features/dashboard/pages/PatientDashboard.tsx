import React from 'react';
import { 
  PlayCircle, 
  TrendingUp, 
  Calendar, 
  Dumbbell, 
  Clock, 
  Settings, 
  Eye, 
  Grid 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../../core/store/useAppStore';

export const PatientDashboard: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-bgMain font-sans text-primary">
      {/* Sidebar */}
      <aside className="w-64 bg-bgSecondary/30 border-r border-neutral/10 flex flex-col justify-between hidden md:flex">
        <div>
          <div className="p-8">
            <h1 className="text-xl font-bold leading-tight">
              NeuroVisión<br />Rehab
            </h1>
          </div>

          <div className="px-6 mb-8">
            <div className="bg-bgSecondary/80 rounded-xl p-3 flex items-center space-x-3 border border-secondary/20">
              <div className="w-10 h-10 rounded bg-neutral/20 flex items-center justify-center font-bold text-sm">
                PS
              </div>
              <div>
                <p className="text-sm font-bold">Welcome back</p>
                <p className="text-xs text-neutral">Stay strong today</p>
              </div>
            </div>
          </div>

          <nav className="px-4 space-y-2">
            <a href="#" className="flex items-center space-x-3 px-4 py-3 bg-[#a3f0e1] text-primary rounded-lg font-bold">
              <Calendar size={20} />
              <span>Daily Plan</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-4 py-3 text-neutral hover:bg-white/50 rounded-lg transition-colors font-semibold">
              <Dumbbell size={20} />
              <span>Exercise Library</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-4 py-3 text-neutral hover:bg-white/50 rounded-lg transition-colors font-semibold">
              <Clock size={20} />
              <span>History</span>
            </a>
            <button 
              onClick={() => useAppStore.getState().logout()}
              className="w-full flex items-center space-x-3 px-4 py-3 text-neutral hover:bg-white/50 rounded-lg transition-colors font-semibold"
            >
              <Settings size={20} />
              <span>Logout</span>
            </button>
          </nav>
        </div>

        <div className="p-6">
          <button 
            onClick={() => navigate('/serious-games')}
            className="w-full py-4 bg-[#0d7a6b] text-white rounded-lg flex items-center justify-center space-x-2 font-bold hover:bg-[#0a5e52] transition-colors"
          >
            <PlayCircle size={20} />
            <span>Start Session</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 md:p-12 lg:p-16 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          
          {/* Header */}
          <div className="mb-10">
            <h2 className="text-4xl font-bold mb-4">Welcome back, Mr. Smith</h2>
            <p className="text-neutral text-lg max-w-2xl">
              Your customized vision rehabilitation plan is ready. You have 3 exercises scheduled for today.
            </p>
            <button 
              onClick={() => navigate('/serious-games')}
              className="mt-6 px-6 py-3 bg-[#0d7a6b] text-white rounded-lg flex items-center space-x-2 font-bold hover:bg-[#0a5e52] transition-colors"
            >
              <PlayCircle size={20} />
              <span>Start Today's Exercise</span>
            </button>
          </div>

          {/* Widgets Top Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            
            {/* Weekly Progress */}
            <div className="md:col-span-2 bg-bgSecondary/40 border border-neutral/10 rounded-2xl p-6 relative">
              <div className="flex justify-between items-start mb-10">
                <h3 className="text-xl font-bold">Weekly Progress</h3>
                <TrendingUp className="text-[#0d7a6b]" size={24} />
              </div>
              
              <div className="mb-4">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-neutral font-semibold">Sessions Completed</span>
                  <span className="text-3xl font-bold">4 <span className="text-2xl text-neutral">/ 7</span></span>
                </div>
                <div className="w-full h-3 bg-neutral/20 rounded-full overflow-hidden">
                  <div className="h-full bg-[#0d7a6b] rounded-full" style={{ width: '57%' }}></div>
                </div>
              </div>
              
              <p className="text-neutral text-sm">
                You are on track to meet your weekly goal. Keep up the good work.
              </p>
            </div>

            {/* Next Review */}
            <div className="bg-bgSecondary/40 border border-neutral/10 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold text-neutral uppercase tracking-wider mb-4">Next Review</p>
                <h3 className="text-2xl font-bold mb-2">Dr. Chen</h3>
                <div className="flex items-center text-primary font-medium text-sm">
                  <Calendar size={16} className="mr-2" />
                  Oct 24, 10:00 AM
                </div>
              </div>
              <button className="w-full mt-6 py-2 border-2 border-primary text-primary font-bold rounded hover:bg-primary hover:text-white transition-colors">
                Manage Appointment
              </button>
            </div>

          </div>

          {/* Today's Plan Row */}
          <div>
            <h3 className="text-2xl font-bold mb-6">Today's Plan</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Card 1 */}
              <div className="bg-bgSecondary/40 border border-neutral/10 rounded-2xl p-6">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-10 h-10 rounded-lg bg-[#8ef0e0] text-[#0d7a6b] flex items-center justify-center">
                    <Eye size={20} />
                  </div>
                  <span className="font-bold text-[#0d7a6b]">10 Min</span>
                </div>
                <h4 className="text-xl font-bold mb-2">Saccadic Training</h4>
                <p className="text-neutral text-sm">
                  Focus on rapid eye movements between targets.
                </p>
              </div>

              {/* Card 2 */}
              <div className="bg-bgSecondary/40 border border-neutral/10 rounded-2xl p-6">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-10 h-10 rounded-lg bg-neutral/20 text-primary flex items-center justify-center">
                    <Grid size={20} />
                  </div>
                  <span className="font-bold text-neutral">5 Min</span>
                </div>
                <h4 className="text-xl font-bold mb-2">Peripheral Awareness</h4>
                <p className="text-neutral text-sm">
                  Expanding functional visual field exercises.
                </p>
              </div>

            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

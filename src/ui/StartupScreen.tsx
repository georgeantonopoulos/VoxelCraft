import React from 'react';
import logo from '@assets/images/thegrove_logo.jpg';

interface StartupScreenProps {
  onEnter: () => void;
  loaded: boolean;
}

export const StartupScreen: React.FC<StartupScreenProps> = ({ onEnter, loaded }) => {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm text-white select-none">
      {/* Logo */}
      <div className={`mb-8 transition-opacity duration-1000 ${loaded ? 'opacity-100' : 'opacity-80'}`}>
        <img
          src={logo}
          alt="The Grove"
          className="w-[500px] max-w-[80vw] rounded-xl shadow-2xl shadow-emerald-900/20"
        />
      </div>

      {/* Loading / Enter */}
      <div className="flex flex-col items-center gap-4 h-16">
        {!loaded ? (
          <div className="flex flex-col items-center gap-3 opacity-70 animate-pulse">
            <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
            <span className="text-xs font-medium tracking-[0.2em] uppercase text-emerald-500/80">Growing World...</span>
          </div>
        ) : (
          <button
            onClick={onEnter}
            className="px-12 py-3 text-lg font-semibold tracking-wide uppercase 
                         bg-emerald-700 hover:bg-emerald-600 text-white rounded shadow-lg shadow-emerald-900/50
                         transition-all duration-300 transform hover:scale-105 hover:tracking-wider
                         border border-emerald-500/30 animate-fade-in-up"
          >
            Enter The Grove
          </button>
        )}
      </div>

      <div className="absolute bottom-8 text-white/20 text-[10px] font-mono tracking-widest">
        VOXEL CRAFT ALPHA
      </div>
    </div>
  );
};


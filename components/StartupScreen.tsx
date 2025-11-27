import React, { useEffect } from 'react';

interface StartupScreenProps {
  loaded: boolean;
  onEnter: () => void;
}

export const StartupScreen: React.FC<StartupScreenProps> = ({ loaded, onEnter }) => {
  useEffect(() => {
    // Expose the onEnter function to the global scope for testing
    (window as any).triggerEnter = onEnter;
    return () => {
      delete (window as any).triggerEnter;
    };
  }, [onEnter]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black bg-opacity-70 text-white font-mono">
      <h1 className="text-5xl mb-4 animate-pulse">Organic Voxel Engine</h1>
      <p className="text-lg mb-8">Loading The Grove...</p>

      <button
        onClick={onEnter}
        disabled={!loaded}
        className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all duration-300 disabled:bg-gray-500 disabled:opacity-50"
      >
        Enter The Grove
      </button>
    </div>
  );
};

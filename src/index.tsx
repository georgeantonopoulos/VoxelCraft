import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Suppress specific library warnings that are known to be benign
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('using deprecated parameters for the initialization function')) {
    return;
  }
  originalWarn(...args);
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// StrictMode causes double effect invocations in development, which doubles
// expensive operations like collider BVH construction. Disable by default
// for performance testing. Enable with ?strictmode URL parameter.
const urlParams = new URLSearchParams(window.location.search);
const enableStrictMode = urlParams.has('strictmode');

const root = ReactDOM.createRoot(rootElement);
root.render(
  enableStrictMode ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  )
);

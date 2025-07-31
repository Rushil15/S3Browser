// src/App.js
require('dotenv').config();

import React, { useState } from 'react';
import './App.css';
import BucketPage from './BucketPage';
import FolderPage from './FolderPage'; 

function App( { token, keycloak } ) {
  const [accessKey, setAccessKey] = useState(process.env.REACT_APP_ACCESS_KEY || '');
  const [secretKey, setSecretKey] = useState(process.env.REACT_APP_SECRET_KEY || '');
  const [endPoint, setEndPoint] = useState(process.env.REACT_APP_ENDPOINT || '');

  const [screen, setScreen] = useState('main'); // 'main' | 'buckets' | 'folder'
  const [selectedBucket, setSelectedBucket] = useState(null);

  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleLogin = async () => {
    try {
      const res = await fetch('http://localhost:5050/list-buckets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endPoint, accessKey, secretKey }),
      });

      if (res.ok) {
        setScreen('buckets');
      } else {
        triggerError();
      }
    } catch {
      triggerError();
    }
  };

  const triggerError = () => {
    setError(true);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  // 🔹 Render Folder Page if a bucket is selected
  if (screen === 'folder') {
    return (
      <FolderPage
        token={keycloak.token} 
        keycloak={keycloak}
        bucketName={selectedBucket}
        endPoint={endPoint}
        accessKey={accessKey}
        secretKey={secretKey}
        onBackToBuckets={() => setScreen('buckets')}
      />
    );
  }

  // 🔹 Render Bucket Page if screen is 'buckets'
  if (screen === 'buckets') {
    return (
      <BucketPage
        token={keycloak.token} 
        keycloak={keycloak}
        onBack={() => setScreen('main')}
        endPoint={endPoint}
        accessKey={accessKey}
        secretKey={secretKey}
        onSelectBucket={(bucket) => {
          setSelectedBucket(bucket);
          setScreen('folder');
        }}
      />
    );
  }

  // 🔹 Main Login Screen
  return (
    <div className="App">
      <header className="App-header">
        <h1 className="heading">S3 Browser - ZATA.ai</h1>
        <div className="login-box">
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="Enter End Point"
              className="input-box"
              value={endPoint}
              onChange={(e) => setEndPoint(e.target.value)}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="Enter Access Key"
              className="input-box"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="password"
              placeholder="Enter Secret Key"
              className="input-box"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
            />
          </div>
          <button
            className={`submit ${shake ? 'shake' : ''}`}
            onClick={handleLogin}
          >
            Login
          </button>
          {error && (
            <div className="error-text">Incorrect credentials. Please try again.</div>
          )}
        </div>
      </header>

      <button className="logout-button" onClick={keycloak.logout}>
        Logout
      </button>
    </div>
  );
}

export default App;
// src/BucketPage.js
import React, { useEffect, useState } from 'react';
import './BucketPage.css';

function BucketPage({ token, keycloak, onBack, endPoint, accessKey, secretKey, onSelectBucket }) {
  const [buckets, setBuckets] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBuckets = async () => {
      try {
        const res = await fetch('http://localhost:5050/list-buckets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ endPoint, accessKey, secretKey }),
        });

        const data = await res.json();
        if (res.ok) setBuckets(data);
        else setError(data.error || 'Unknown error while listing buckets');
      } catch (err) {
        setError('Failed to connect to backend');
      }
    };
    fetchBuckets();
  }, []);

 return (
  <div className="App" style={{ position: 'relative', minHeight: '100vh' }}>
    <button className="back-button" onClick={onBack}>
      ← Back
    </button>

    <button className="logout-button" onClick={keycloak.logout}>
      Logout
    </button>

    <header className="App-header">
      <h1 className='BucketPageHeading'>S3 Browser - ZATA.ai</h1>

      {error && (
        <div className="error-box">
          <strong>❗ Error:</strong> <span>{error}</span>
        </div>
      )}

      <div className="BucketBox">
        <h2 className= "BucketHeader" >Buckets</h2>
        {buckets.length === 0 ? (
          <p>Loading buckets...</p>
        ) : (
          <div className="bucket-list">
          <ul>
            {buckets.map(bucket => (
              <li key={bucket.Name}>
                <button
                  className="BucketButton"
                  onClick={() => onSelectBucket(bucket.Name)}
                >
                  🪣 {bucket.Name}
                </button>
              </li>
            ))}
          </ul>
          </div>
        )}
      </div>
    </header>
  </div>
);
}

export default BucketPage;
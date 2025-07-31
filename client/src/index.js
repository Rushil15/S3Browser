// import React from 'react';
// import ReactDOM from 'react-dom/client';
// import './index.css';
// import App from './App';
// import reportWebVitals from './reportWebVitals';

// const root = ReactDOM.createRoot(document.getElementById('root'));
// root.render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>
// );

// // If you want to start measuring performance in your app, pass a function
// // to log results (for example: reportWebVitals(console.log))
// // or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Keycloak from 'keycloak-js';



// Load from .env
const keycloak = new Keycloak({
  url: process.env.REACT_APP_KEYCLOAK_ROOT_URL,
  realm: process.env.REACT_APP_KEYCLOAK_REALM,
  clientId: process.env.REACT_APP_KEYCLOAK_CLIENT_ID,
});

keycloak.init({ onLoad: 'login-required' }).then(authenticated => {
  if (authenticated) {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <App token={keycloak.token} keycloak={keycloak} />
    );
  } else {
    window.location.reload();
  }
});

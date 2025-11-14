import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../App'

// electronAPI 로드 확인
console.log('window.electronAPI:', window.electronAPI)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)


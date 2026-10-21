import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

// Block pinch-zoom (Safari gesture events). Double-tap-to-zoom is already handled
// by `touch-action: manipulation` + the viewport meta, without breaking taps.
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('gesturechange', (e) => e.preventDefault())

const app = mount(App, { target: document.getElementById('app')! })
export default app

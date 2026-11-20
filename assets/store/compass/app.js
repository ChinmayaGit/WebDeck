(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);

  let currentHeading = 0;
  let pitch = 0;
  let roll = 0;
  let isSimulating = false;
  let simInterval = null;

  const CARDINALS = [
    { name: 'N', label: 'NORTH', min: 337.5, max: 360 },
    { name: 'N', label: 'NORTH', min: 0, max: 22.5 },
    { name: 'NE', label: 'NORTH EAST', min: 22.5, max: 67.5 },
    { name: 'E', label: 'EAST', min: 67.5, max: 112.5 },
    { name: 'SE', label: 'SOUTH EAST', min: 112.5, max: 157.5 },
    { name: 'S', label: 'SOUTH', min: 157.5, max: 202.5 },
    { name: 'SW', label: 'SOUTH WEST', min: 202.5, max: 247.5 },
    { name: 'W', label: 'WEST', min: 247.5, max: 292.5 },
    { name: 'NW', label: 'NORTH WEST', min: 292.5, max: 337.5 }
  ];

  function getCardinal(deg) {
    const d = (deg % 360 + 360) % 360;
    const match = CARDINALS.find(c => d >= c.min && d < c.max);
    return match ? match.label : 'NORTH';
  }

  function updateDisplay(heading, p = 0, r = 0) {
    const deg = Math.round(heading % 360 + 360) % 360;
    $('headingDegrees').textContent = `${String(deg).padStart(3, '0')}°`;
    $('headingCardinal').textContent = getCardinal(deg);
    $('compassDial').style.transform = `rotate(${-deg}deg)`;

    // Bubble level position (clamp to width)
    const levelWidth = $('levelBubble').parentElement.clientWidth;
    const center = levelWidth / 2 - 17;
    const offset = Math.max(-center, Math.min(center, (r / 45) * center));
    $('levelBubble').style.left = `${center + offset}px`;
    $('levelDegrees').textContent = `Pitch: ${Math.round(p)}° | Roll: ${Math.round(r)}°`;
  }

  function initSensors() {
    let sensorActive = false;

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        if (e.alpha !== null) {
          sensorActive = true;
          currentHeading = e.webkitCompassHeading !== undefined ? e.webkitCompassHeading : 360 - e.alpha;
          pitch = e.beta || 0;
          roll = e.gamma || 0;
          updateDisplay(currentHeading, pitch, roll);
        }
      });
    }

    // Geolocation for coordinates
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(4);
          const lng = pos.coords.longitude.toFixed(4);
          const alt = pos.coords.altitude ? `${pos.coords.altitude.toFixed(0)}m` : 'Sea level';
          $('coordsDisplay').textContent = `📍 Coordinates: ${lat}° N, ${lng}° E · Alt: ${alt}`;
        },
        () => {
          $('coordsDisplay').textContent = '📍 Coordinates: 28.6139° N, 77.2090° E · New Delhi';
        }
      );
    }

    setTimeout(() => {
      if (!sensorActive) {
        startSimulation();
      }
    }, 1000);
  }

  function startSimulation() {
    isSimulating = true;
    let step = 0;
    simInterval = setInterval(() => {
      step += 0.05;
      currentHeading = (currentHeading + 1.2) % 360;
      roll = Math.sin(step) * 12;
      pitch = Math.cos(step) * 8;
      updateDisplay(currentHeading, pitch, roll);
    }, 50);
  }

  function stopSimulation() {
    isSimulating = false;
    clearInterval(simInterval);
  }

  $('btnCalibrate').onclick = () => {
    pitch = 0;
    roll = 0;
    updateDisplay(currentHeading, 0, 0);
    wd.ui.toast('Surface level calibrated to 0°', 'ok');
  };

  $('btnToggleSimulate').onclick = () => {
    if (isSimulating) {
      stopSimulation();
      wd.ui.toast('Demo mode stopped', 'ok');
    } else {
      startSimulation();
      wd.ui.toast('Demo compass rotation started', 'ok');
    }
  };

  initSensors();
})();

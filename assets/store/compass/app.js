(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);

  // Smoothed, unwrapped dial angle so 359° -> 0° doesn't spin the dial all the way round.
  let displayAngle = null;
  let heading = 0;
  let pitch = 0;
  let roll = 0;
  let pitchOffset = 0;
  let rollOffset = 0;
  let hasHeading = false;
  let usingAbsolute = false;

  const LABELS = ['NORTH', 'NORTH EAST', 'EAST', 'SOUTH EAST', 'SOUTH', 'SOUTH WEST', 'WEST', 'NORTH WEST'];
  const cardinal = (deg) => LABELS[Math.round(deg / 45) % 8];
  const norm = (d) => ((d % 360) + 360) % 360;

  function screenAngle() {
    const a = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (typeof window.orientation === 'number' ? window.orientation : 0);
    return a || 0;
  }

  function render() {
    if (hasHeading) {
      const deg = Math.round(norm(heading)) % 360;
      $('headingDegrees').textContent = `${String(deg).padStart(3, '0')}°`;
      $('headingCardinal').textContent = cardinal(deg);

      const target = -heading;
      if (displayAngle === null) {
        displayAngle = target;
      } else {
        let delta = norm(target - displayAngle);
        if (delta > 180) delta -= 360;
        displayAngle += delta * 0.25; // low-pass to stop jitter
      }
      $('compassDial').style.transform = `rotate(${displayAngle}deg)`;
    }

    const p = pitch - pitchOffset;
    const r = roll - rollOffset;
    const bubble = $('levelBubble');
    const levelWidth = bubble.parentElement.clientWidth;
    const center = levelWidth / 2 - 17;
    const offset = Math.max(-center, Math.min(center, (r / 45) * center));
    bubble.style.left = `${center + offset}px`;
    $('levelDegrees').textContent = `Pitch: ${Math.round(p)}° | Roll: ${Math.round(r)}°`;
  }

  let rafPending = false;
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  function onOrientation(e, absolute) {
    if (e.beta != null) pitch = e.beta;
    if (e.gamma != null) roll = e.gamma;

    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading; // iOS: already true heading
    } else if (e.alpha != null && (absolute || e.absolute === true)) {
      h = norm(360 - e.alpha + screenAngle());
    }

    if (h != null) {
      if (absolute) usingAbsolute = true;
      // Ignore relative events once absolute ones are flowing.
      if (!absolute && usingAbsolute) return scheduleRender();
      heading = h;
      if (!hasHeading) {
        hasHeading = true;
        $('dialWrap').classList.remove('unsupported');
        $('unsupportedBanner').classList.remove('show');
      }
    }
    scheduleRender();
  }

  function markUnsupported() {
    if (hasHeading) return;
    $('dialWrap').classList.add('unsupported');
    $('unsupportedBanner').classList.add('show');
    $('headingDegrees').textContent = '---°';
    $('headingCardinal').textContent = 'NOT SUPPORTED';
  }

  function attach() {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', (e) => onOrientation(e, true));
    }
    if ('DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', (e) => onOrientation(e, false));
    }
  }

  function initSensors() {
    const hasApi = ('ondeviceorientationabsolute' in window) || ('DeviceOrientationEvent' in window);
    if (!hasApi) {
      markUnsupported();
    } else if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: needs a user gesture.
      $('headingCardinal').textContent = 'Tap to enable compass';
      const ask = () => {
        DeviceOrientationEvent.requestPermission()
          .then((state) => { if (state === 'granted') attach(); else markUnsupported(); })
          .catch(markUnsupported);
        document.removeEventListener('click', ask);
      };
      document.addEventListener('click', ask);
    } else {
      attach();
    }

    // Desktops expose the API but never fire real heading data.
    setTimeout(markUnsupported, 2500);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const alt = pos.coords.altitude != null ? `${pos.coords.altitude.toFixed(0)}m` : 'n/a';
          $('coordsDisplay').textContent =
            `📍 ${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'} · Alt: ${alt}`;
        },
        () => { $('coordsDisplay').textContent = '📍 Location unavailable'; },
        { timeout: 10000 }
      );
    } else {
      $('coordsDisplay').textContent = '📍 Location not supported';
    }
  }

  $('btnCalibrate').onclick = () => {
    pitchOffset = pitch;
    rollOffset = roll;
    render();
    wd.ui.toast('Surface level calibrated to 0°', 'ok');
  };

  window.addEventListener('resize', scheduleRender);
  initSensors();
  render();
})();

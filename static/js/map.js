// Leaflet map: click/tap to set a point; "Draw region" lets you drag a rectangle with mouse, pen or touch.
/* global L */

export function createMap(el, { onPoint, onArea, onDrawChange = () => {} }) {
  if (typeof L === "undefined") {
    el.innerHTML = '<p class="hint" style="padding:14px">Map failed to load (offline?). Search for a place or type coordinates instead.</p>';
    return { setPoint() {}, setArea() {}, clearArea() {}, startDraw() {}, stopDraw() {}, available: false };
  }
  const map = L.map(el, { worldCopyJump: true, zoomControl: true, attributionControl: true }).setView([22.5, 79], 4);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  const pin = L.divIcon({ className: "", html: '<div class="map-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  const rectStyle = { color: "#8b5cf6", weight: 1.5, fillColor: "#8b5cf6", fillOpacity: 0.12, dashArray: "4 4" };
  let marker = null;
  let rect = null;
  let drawing = false;
  let start = null;

  function setPoint(lat, lon, { pan = true } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!marker) marker = L.marker([lat, lon], { icon: pin, keyboard: false }).addTo(map);
    else marker.setLatLng([lat, lon]);
    if (pan) map.setView([lat, lon], Math.max(map.getZoom(), 8));
  }

  function setArea(b) {
    if (rect) rect.remove();
    rect = L.rectangle([[b.south, b.west], [b.north, b.east]], rectStyle).addTo(map);
    map.fitBounds(rect.getBounds(), { padding: [24, 24], maxZoom: 10 });
  }

  function clearArea() {
    if (rect) rect.remove();
    rect = null;
  }

  function startDraw() {
    drawing = true;
    el.classList.add("drawing");
    map.dragging.disable();
    map.doubleClickZoom.disable();
    onDrawChange(true);
  }

  function stopDraw() {
    drawing = false;
    start = null;
    el.classList.remove("drawing");
    map.dragging.enable();
    map.doubleClickZoom.enable();
    onDrawChange(false);
  }

  // Pointer events cover mouse, pen and touch; Leaflet's own mouse events do not fire for touch drags.
  const toLatLng = (e) => map.containerPointToLatLng(L.point(e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top));
  el.addEventListener("pointerdown", (e) => {
    if (!drawing || e.target.closest(".leaflet-control")) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch { /* pointer already released */ }
    start = toLatLng(e);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drawing || !start) return;
    const b = L.latLngBounds(start, toLatLng(e));
    if (rect) rect.setBounds(b);
    else rect = L.rectangle(b, rectStyle).addTo(map);
  });
  el.addEventListener("pointerup", (e) => {
    if (!drawing || !start) return;
    const b = L.latLngBounds(start, toLatLng(e));
    stopDraw();
    const area = {
      south: +b.getSouth().toFixed(5), west: +b.getWest().toFixed(5),
      north: +b.getNorth().toFixed(5), east: +b.getEast().toFixed(5),
    };
    if (area.north - area.south < 1e-4 || area.east - area.west < 1e-4) {
      clearArea();
      return;
    }
    onArea(area);
  });
  el.style.touchAction = "none";
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawing) {
      clearArea();
      stopDraw();
    }
  });
  map.on("click", (e) => {
    if (drawing) return;
    const { lat, lng } = e.latlng.wrap();
    onPoint(+lat.toFixed(5), +lng.toFixed(5));
  });

  // Leaflet needs a size recalculation when its container becomes visible or resizes.
  new ResizeObserver(() => {
    map.invalidateSize({ pan: false });
    if (marker && !rect) map.panTo(marker.getLatLng(), { animate: false });
  }).observe(el);
  return { setPoint, setArea, clearArea, startDraw, stopDraw, available: true };
}

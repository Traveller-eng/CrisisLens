import { useEffect, useRef } from "react";

type MapZone = {
  zoneId: string;
  center: { lat: number; lng: number };
  trustScore: number;
  urgencyScore: number;
  conflictLevel: string;
  finalConfidence?: number;
  conflictScore?: number;
};

type LiveMapProps = {
  apiKey: string;
  zones: MapZone[];
  nasaHotspots?: Array<{ latitude: number; longitude: number; confidence: string }>;
  weatherSignals?: Array<{ lat: number; lng: number; rain: number; riskScore: number; wind: number; windDeg?: number }>;
  showWeatherLayer?: boolean;
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string) => void;
};

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (...args: unknown[]) => {
          setCenter?: (...args: unknown[]) => void;
          fitBounds?: (bounds: unknown, padding?: number) => void;
        };
        Marker: new (...args: unknown[]) => {
          setMap: (map: unknown) => void;
          addListener: (eventName: string, handler: () => void) => void;
          setIcon?: (icon: unknown) => void;
        };
        Circle: new (...args: unknown[]) => {
          setMap: (map: unknown) => void;
          setOptions: (options: unknown) => void;
        };
        LatLngBounds: new () => {
          extend: (point: unknown) => void;
        };
        SymbolPath: {
          CIRCLE: unknown;
          FORWARD_CLOSED_ARROW: unknown;
        };
      };
    };
  }
}

let mapsScriptPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) {
    return Promise.resolve();
  }

  if (!mapsScriptPromise) {
    mapsScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Maps"));
      document.head.appendChild(script);
    });
  }

  return mapsScriptPromise;
}

function markerColor(zone: MapZone): string {
  if (zone.conflictLevel === "HIGH") {
    return "#ff6b57";
  }

  if (zone.trustScore >= 0.75) {
    return "#46d39a";
  }

  return "#ffc857";
}

export default function LiveMap({
  apiKey,
  zones,
  nasaHotspots = [],
  weatherSignals = [],
  showWeatherLayer = false,
  selectedZoneId,
  onSelectZone
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ setCenter?: (...args: unknown[]) => void; fitBounds?: (bounds: unknown, padding?: number) => void } | null>(null);
  const markersRef = useRef<Array<{ setMap: (map: unknown) => void }>>([]);
  const nasaMarkersRef = useRef<Array<{ setMap: (map: unknown) => void }>>([]);
  const weatherMarkersRef = useRef<Array<{ setMap: (map: unknown) => void }>>([]);
  const weatherCirclesRef = useRef<Array<{ setMap: (map: unknown) => void }>>([]);
  const zoneCirclesRef = useRef<Array<{ setMap: (map: unknown) => void; setOptions: (options: unknown) => void }>>([]);
  const conflictCirclesRef = useRef<Array<{ setMap: (map: unknown) => void; setOptions: (options: unknown) => void }>>([]);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!apiKey || !containerRef.current) {
      return;
    }

    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.maps) {
          return;
        }

        if (!mapRef.current) {
          mapRef.current = new window.google.maps.Map(containerRef.current, {
            center: zones[0]?.center ?? { lat: 13.0827, lng: 80.2707 },
            zoom: 11,
            styles: [
              { elementType: "geometry", stylers: [{ color: "#0b1f2e" }] },
              { elementType: "labels.text.stroke", stylers: [{ color: "#0b1f2e" }] },
              { elementType: "labels.text.fill", stylers: [{ color: "#8fb6d1" }] },
              { featureType: "water", elementType: "geometry", stylers: [{ color: "#10364d" }] },
              { featureType: "road", elementType: "geometry", stylers: [{ color: "#16384f" }] }
            ],
            disableDefaultUI: true,
            zoomControl: true
          });
        }

        markersRef.current.forEach((marker) => marker.setMap(null));
        nasaMarkersRef.current.forEach((marker) => marker.setMap(null));
        weatherMarkersRef.current.forEach((marker) => marker.setMap(null));
        weatherCirclesRef.current.forEach((circle) => circle.setMap(null));
        zoneCirclesRef.current.forEach((circle) => circle.setMap(null));
        conflictCirclesRef.current.forEach((circle) => circle.setMap(null));
        markersRef.current = zones.map((zone) => {
          const conflict = zone.conflictLevel === "HIGH";
          const selected = selectedZoneId === zone.zoneId;
          const marker = new window.google!.maps.Marker({
            map: mapRef.current!,
            position: zone.center,
            title: zone.zoneId,
            label: {
              text: zone.zoneId.replace("Zone ", ""),
              color: "#f7fbff",
              fontWeight: "700"
            },
            icon: {
              path: window.google!.maps.SymbolPath.CIRCLE,
              fillColor: markerColor(zone),
              fillOpacity: selected ? 1 : conflict ? 0.96 : 0.82,
              strokeColor: "#f7fbff",
              strokeWeight: selected ? 2 : conflict ? 2 : 1,
              scale: selected ? 14 : conflict ? 12 : 10
            }
          });

          marker.addListener("click", () => onSelectZone(zone.zoneId));
          return marker;
        });

        zoneCirclesRef.current = zones.map(
          (zone) =>
            new window.google!.maps.Circle({
              map: mapRef.current!,
              center: zone.center,
              radius: zone.conflictLevel === "HIGH" ? 1600 : zone.conflictLevel === "MEDIUM" ? 1200 : 900,
              fillColor: markerColor(zone),
              fillOpacity: zone.conflictLevel === "HIGH" ? 0.18 : zone.conflictLevel === "MEDIUM" ? 0.12 : 0.08,
              strokeOpacity: 0,
              clickable: false
            })
        );

        conflictCirclesRef.current = zones
          .filter((zone) => zone.conflictLevel === "HIGH" || (zone.conflictScore ?? 0) > 0.45)
          .map(
            (zone) =>
              new window.google!.maps.Circle({
                map: mapRef.current!,
                center: zone.center,
                radius: 2200 + (zone.conflictScore ?? 0.5) * 900,
                fillColor: "#ff5f57",
                fillOpacity: 0.08,
                strokeColor: "#ff7a6d",
                strokeOpacity: 0.18,
                strokeWeight: 1,
                clickable: false
              })
          );

        nasaMarkersRef.current = nasaHotspots.map((hotspot) =>
          new window.google!.maps.Marker({
            map: mapRef.current!,
            position: { lat: hotspot.latitude, lng: hotspot.longitude },
            title: `NASA FIRMS ${hotspot.confidence}`,
            icon: {
              path: window.google!.maps.SymbolPath.CIRCLE,
              fillColor: "#ff8a4c",
              fillOpacity: 0.82,
              strokeColor: "#ffe7d9",
              strokeWeight: 1,
              scale: 6
            }
          })
        );

        weatherCirclesRef.current = showWeatherLayer
          ? weatherSignals.map(
              (signal) =>
                new window.google!.maps.Circle({
                  map: mapRef.current!,
                  center: { lat: signal.lat, lng: signal.lng },
                  radius: 800 + signal.rain * 140,
                  fillColor: signal.riskScore >= 0.65 ? "#2246ff" : signal.riskScore >= 0.4 ? "#1f8fff" : "#6fd3ff",
                  fillOpacity: 0.12 + signal.riskScore * 0.18,
                  strokeColor: signal.riskScore >= 0.65 ? "#ff6b57" : "#7cc6ff",
                  strokeOpacity: 0.26,
                  strokeWeight: 1,
                  clickable: false
                })
            )
          : [];

        weatherMarkersRef.current = showWeatherLayer
          ? weatherSignals.map(
              (signal) =>
                new window.google!.maps.Marker({
                  map: mapRef.current!,
                  position: { lat: signal.lat, lng: signal.lng },
                  title: `Weather risk ${signal.riskScore.toFixed(2)}`,
                  icon: {
                    path: window.google!.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    fillColor: "#8fd8ff",
                    fillOpacity: 0.94,
                    strokeColor: "#dff6ff",
                    strokeWeight: 1,
                    scale: 4 + signal.wind * 0.18,
                    rotation: signal.windDeg ?? 0
                  }
                })
            )
          : [];

        if (zones.length > 1 && mapRef.current?.fitBounds && window.google?.maps?.LatLngBounds) {
          const bounds = new window.google.maps.LatLngBounds();
          zones.forEach((zone) => bounds.extend(zone.center));
          nasaHotspots.forEach((hotspot) => bounds.extend({ lat: hotspot.latitude, lng: hotspot.longitude }));
          weatherSignals.forEach((signal) => bounds.extend({ lat: signal.lat, lng: signal.lng }));
          mapRef.current.fitBounds(bounds, 64);
        } else if (zones.length === 1 && mapRef.current?.setCenter) {
          mapRef.current.setCenter(zones[0].center);
        }

        if (zones.length > 0 && !selectedZoneId) {
          onSelectZone(zones[0].zoneId);
        }

        if (animationFrameRef.current) {
          window.cancelAnimationFrame(animationFrameRef.current);
        }

        const animate = () => {
          const now = Date.now();
          zoneCirclesRef.current.forEach((circle, index) => {
            const zone = zones[index];
            const phase = (Math.sin(now / (zone.conflictLevel === "HIGH" ? 320 : 620) + index) + 1) / 2;
            circle.setOptions({
              fillOpacity:
                zone.conflictLevel === "HIGH" ? 0.16 + phase * 0.18 : zone.conflictLevel === "MEDIUM" ? 0.08 + phase * 0.1 : 0.05 + phase * 0.04,
              radius:
                (zone.conflictLevel === "HIGH" ? 1500 : zone.conflictLevel === "MEDIUM" ? 1150 : 900) +
                phase * (zone.conflictLevel === "HIGH" ? 380 : 180)
            });
          });

          conflictCirclesRef.current.forEach((circle, index) => {
            const phase = (Math.sin(now / 260 + index) + 1) / 2;
            circle.setOptions({
              fillOpacity: 0.04 + phase * 0.12,
              strokeOpacity: 0.12 + phase * 0.2
            });
          });

          animationFrameRef.current = window.requestAnimationFrame(animate);
        };

        animationFrameRef.current = window.requestAnimationFrame(animate);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [apiKey, nasaHotspots, onSelectZone, selectedZoneId, showWeatherLayer, weatherSignals, zones]);

  return <div className="real-map" ref={containerRef} />;
}

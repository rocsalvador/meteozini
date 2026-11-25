import { Suspense } from "react";
import MapApp from "@/components/map/map-app";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="grid h-dvh place-items-center text-sm">Carregant el mapa…</div>}>
      <MapApp />
    </Suspense>
  );
}

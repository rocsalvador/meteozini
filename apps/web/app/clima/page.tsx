import { Suspense } from "react";
import ClimaPage from "./clima-client";

export const metadata = {
  title: "El clima de qualsevol lloc de Catalunya | meteozini",
  description:
    "Calendari d'anomalies, normals 1991–2020 i sèrie històrica del clima a qualsevol punt de Catalunya, amb dades ERA5.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: "var(--background)" }} />}>
      <ClimaPage />
    </Suspense>
  );
}

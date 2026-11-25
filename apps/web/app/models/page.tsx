import { Suspense } from "react";
import ModelsPage from "./models-client";

export const metadata = {
  title: "Comparació de models meteorològics per a Catalunya | meteozini",
  description:
    "Compara models meteorològics (IFS, GFS, ICON, GEM, AROME i ICON-EU) per a qualsevol punt de Catalunya, amb ensembles i fiabilitat.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: "var(--background)" }} />}>
      <ModelsPage />
    </Suspense>
  );
}

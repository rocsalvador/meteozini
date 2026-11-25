import { Suspense } from "react";
import LlocPage from "./lloc-client";

export const metadata = {
  title: "Previsió del temps per a un lloc | meteozini",
  description: "Previsió detallada per a qualsevol punt de Catalunya: hora a hora, pròxims dies i condicions actuals.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: "var(--background)" }} />}>
      <LlocPage />
    </Suspense>
  );
}

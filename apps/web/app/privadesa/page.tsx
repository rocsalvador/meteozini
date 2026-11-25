import { AppHeader, BottomNav } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata = { title: "Privadesa | meteozini" };

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <AppHeader />
      <main className="page-shell flex-1 py-4 pb-24 md:py-8 lg:pb-8">
        <div className="card mx-auto max-w-2xl space-y-4 p-5 text-sm leading-relaxed">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Privadesa</h1>
          <p>
            meteozini és una aplicació meteorològica de demostració. No es recullen dades personals, no
            s&apos;utilitzen analytics ni cookies de seguiment.
          </p>
          <p>
            La ubicació només s&apos;utilitza si l&apos;usuari prem el botó de geolocalització, i es fa servir únicament
            per mostrar la previsió del punt corresponent.
          </p>
          <p>
            Les consultes de previsió i clima es fan a través d&apos;Open-Meteo. Les dades de mapes i observacions
            provenen de serveis meteorològics públics.
          </p>
          <p>Darrera actualització: novembre de 2026.</p>
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}

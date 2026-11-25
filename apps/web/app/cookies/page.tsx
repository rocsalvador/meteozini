import { AppHeader, BottomNav } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata = { title: "Cookies | meteozini" };

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <AppHeader />
      <main className="page-shell flex-1 py-4 pb-24 md:py-8 lg:pb-8">
        <div className="card mx-auto max-w-2xl space-y-4 p-5 text-sm leading-relaxed">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Cookies</h1>
          <p>
            Aquesta web no fa servir cookies publicitàries ni de seguiment. Únicament desa al navegador la preferència de
            tema (clar o fosc) sota la clau <code className="rounded px-1" style={{ backgroundColor: "var(--muted)" }}>tm-theme</code>.
          </p>
          <p>
            Aquesta preferència és tècnica, no identifica l&apos;usuari i es pot esborrar en qualsevol moment des de la
            configuració del navegador.
          </p>
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}

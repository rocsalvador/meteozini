import Link from "next/link";

const DATA_SOURCES = [
  ["Open-Meteo", "https://open-meteo.com/"],
  ["Meteocat/XEMA", "https://www.meteo.cat/observacions/xema"],
  ["AEMET", "https://www.aemet.es/"],
  ["ACA", "https://www.aca.gencat.cat/"],
  ["Météo-France", "https://meteofrance.fr/"],
  ["Meteo.ad", "https://www.meteo.ad/"],
  ["Meteo Valls d'Àneu", "https://metevallsdaneu.com/"],
  ["NOAA/NCEP", "https://www.ncep.noaa.gov/"],
  ["EUMETNET/OPERA", "https://www.eumetnet.eu/activities/observations-programme/current-activities/opera/"],
  ["EUMETSAT", "https://www.eumetsat.int/"],
  ["ICGC", "https://www.icgc.cat/"],
  ["Copernicus", "https://www.copernicus.eu/"],
];

export function Footer() {
  return (
    <footer
      className="mt-auto border-t pb-16 lg:pb-0"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
    >
      <div className="page-shell py-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-bold">meteozini</div>
            <p className="max-w-xs text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
              El temps a Catalunya: mapa en directe, radar i previsió amb models d&apos;alta resolució.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs" aria-label="Enllaços">
            <Link className="hover:underline" href="/">Inici</Link>
            <Link className="hover:underline" href="/mapes">Mapes</Link>
            <Link className="hover:underline" href="/muntanya">Muntanya</Link>
            <Link className="hover:underline" href="/models">Models</Link>
            <Link className="hover:underline" href="/clima">Clima</Link>
            <Link className="hover:underline" href="/privadesa">Privadesa</Link>
            <Link className="hover:underline" href="/cookies">Cookies</Link>
          </nav>
        </div>

        <div className="mt-8 space-y-2 border-t pt-4 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
          <p>
            © {new Date().getFullYear()} meteozini
          </p>
          <p>
            <span>Dades de </span>
            {DATA_SOURCES.map(([label, href], i) => (
              <span key={label}>
                {i > 0 && <span> · </span>}
                <a href={href} target="_blank" rel="noreferrer" className="underline">
                  {label}
                </a>
              </span>
            ))}
          </p>
        </div>
      </div>
    </footer>
  );
}

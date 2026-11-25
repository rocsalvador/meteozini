"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChartColumn,
  CloudSun,
  Map as MapIcon,
  Menu,
  Moon,
  MountainSnow,
  Navigation,
  Search,
  Sun,
  X,
} from "lucide-react";
import { Logo } from "./logo";
import { useTheme } from "./theme";

export const NAV_ITEMS = [
  { href: "/", label: "Interactiu", icon: CloudSun },
  { href: "/mapes", label: "Mapes", icon: MapIcon },
  { href: "/muntanya", label: "Muntanya", icon: MountainSnow },
  { href: "/models", label: "Models", icon: ChartColumn },
  { href: "/clima", label: "Clima", icon: CalendarDays },
];

type GeoResult = {
  name: string;
  admin1: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
};

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Canviar a tema clar" : "Canviar a tema fosc"}
      className={`grid h-9 w-9 place-items-center rounded-md border hover:border-[color:var(--border-strong)] ${className}`}
      style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const data = await res.json();
        setResults(data.results ?? []);
        setOpen(true);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const targetPath =
    pathname === "/models" ? "/models" : pathname === "/clima" ? "/clima" : pathname === "/lloc" ? "/lloc" : "/";

  const go = useCallback(
    (r: GeoResult) => {
      setOpen(false);
      setQuery("");
      router.push(`${targetPath}?lat=${r.latitude}&lon=${r.longitude}&name=${encodeURIComponent(r.name)}`);
    },
    [router, targetPath]
  );

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        router.push(`${targetPath}?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&name=La%20meva%20ubicaci%C3%B3`);
      },
      () => {},
      { timeout: 8000 }
    );
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (results[0]) go(results[0]);
    else if (query.trim().length >= 2) setOpen(true);
  };

  return (
    <div className="relative w-full" ref={boxRef}>
      <form onSubmit={onSubmit} className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }}>
          <Search className="h-4 w-4" />
        </span>
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="cerca ciutat..."
          aria-label="Cerca una ciutat o poble"
          className="h-10 w-full rounded-md pl-9 pr-10 text-[13px] focus:outline-none"
          style={{
            backgroundColor: "var(--input-bg)",
            border: "1px solid var(--input-border)",
            color: "var(--foreground)",
          }}
        />
        <button
          type="button"
          onClick={locate}
          title="Utilitza la meva ubicació actual"
          aria-label="Utilitza la meva ubicació actual"
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md hover:text-[color:var(--accent)]"
          style={{ color: "var(--muted-foreground)" }}
        >
          <Navigation className="h-4 w-4" />
        </button>
      </form>
      {open && (results.length > 0 || (loading && query.length >= 2)) && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-md border"
          style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
        >
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
              cercant…
            </div>
          )}
          {results.map((r) => (
            <button
              key={`${r.latitude},${r.longitude}`}
              type="button"
              onMouseDown={() => go(r)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-[color:var(--muted)]"
            >
              <span className="truncate font-medium">{r.name}</span>
              <span className="shrink-0" style={{ color: "var(--muted-foreground)" }}>
                {[r.admin1, r.country].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{ backgroundColor: "var(--header-bg)", borderColor: "var(--header-border)" }}
    >
      <div className="page-shell py-3">
        {/* Mobile */}
        <div className="space-y-2.5 lg:hidden">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <Link href="/" aria-label="meteozini" className="flex min-w-0 items-center">
              <Logo size={26} textSize={18} />
            </Link>
            <div className="flex shrink-0 items-center gap-1.5">
              <ThemeToggle />
              <button
                type="button"
                aria-expanded={open}
                aria-label="Obrir menú principal"
                onClick={() => setOpen((v) => !v)}
                className="grid h-9 w-9 place-items-center rounded-md border hover:border-[color:var(--border-strong)]"
                style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
              >
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {open && (
            <nav className="grid grid-cols-2 gap-1 pb-1" aria-label="Seccions">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium"
                  style={{
                    borderColor: pathname === href ? "var(--foreground)" : "var(--border)",
                    color: pathname === href ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </nav>
          )}
          <SearchBox />
        </div>

        {/* Desktop */}
        <div className="hidden items-center gap-4 lg:flex">
          <Link href="/" aria-label="meteozini" className="flex shrink-0 items-center">
            <Logo size={26} textSize={18} />
          </Link>
          <nav className="flex items-stretch gap-1" aria-label="Seccions">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 px-2.5 text-[13px] font-medium ${active ? "nav-active" : "hover:text-[color:var(--accent)]"}`}
                  style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto w-full max-w-[340px]">
            <SearchBox />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Seccions"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t lg:hidden"
      style={{
        backgroundColor: "var(--card)",
        borderColor: "var(--border)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="flex min-h-[54px] flex-col items-center justify-center gap-1 text-[10px] touch-manipulation"
            style={{
              color: active ? "var(--foreground)" : "var(--muted-foreground)",
              borderTop: active ? "2px solid var(--foreground)" : "2px solid transparent",
            }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Snowflake,
  Sun,
} from "lucide-react";

export function weatherLabel(code: number | null | undefined): string {
  if (code == null) return "—";
  if (code === 0) return "Cel serè";
  if (code === 1) return "Majoritàriament serè";
  if (code === 2) return "Parcialment ennuvolat";
  if (code === 3) return "Ennuvolat";
  if (code === 45 || code === 48) return "Boira";
  if (code >= 51 && code <= 57) return "Plugim";
  if (code >= 61 && code <= 67) return "Pluja";
  if (code >= 71 && code <= 77) return "Neu";
  if (code >= 80 && code <= 82) return "Xàfecs";
  if (code === 85 || code === 86) return "Xàfecs de neu";
  if (code >= 95) return "Tempesta";
  return "Variable";
}

export function WeatherIcon({
  code,
  isDay = true,
  className = "h-5 w-5",
}: {
  code: number | null | undefined;
  isDay?: boolean | number | null;
  className?: string;
}) {
  if (code == null) return <Cloud className={className} />;
  if (code === 0) return isDay === false || isDay === 0 ? <Moon className={className} /> : <Sun className={className} />;
  if (code === 1 || code === 2) return <CloudSun className={className} />;
  if (code === 3) return <Cloud className={className} />;
  if (code === 45 || code === 48) return <CloudFog className={className} />;
  if (code >= 51 && code <= 57) return <CloudDrizzle className={className} />;
  if (code >= 61 && code <= 67) return <CloudRain className={className} />;
  if (code >= 71 && code <= 77) return <CloudSnow className={className} />;
  if (code >= 80 && code <= 82) return <CloudRain className={className} />;
  if (code === 85 || code === 86) return <Snowflake className={className} />;
  if (code >= 95) return <CloudLightning className={className} />;
  return <Cloud className={className} />;
}

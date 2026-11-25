export type VariableMeta = {
  label: string;
  shortLabel: string;
  unit: string;
  legend: string;
  stops: string[];
  /** Optional absolute positions (0–1) for `stops`; useful for non-linear palettes. */
  stopPositions?: number[];
  /** Optional threshold palette (value → colour), used by the raster renderers. */
  palette?: { value: number; color: string }[];
  categorical?: boolean;
};

export type MapSource = "arome" | "obs" | "radar";

const TEMP_LEGEND =
  "linear-gradient(90deg,#1d87e7 0% 4%,#36a9ff 4% 8%,#4fc9ff 8% 12%,#8de7ff 12% 16%,#a3faf9 16% 20%,#2cc9bd 20% 24%,#029693 24% 28%,#116b6a 28% 32%,#165e4b 32% 36%,#2b763b 36% 40%,#408c40 40% 44%,#60a747 44% 48%,#85c152 48% 52%,#a8d868 52% 56%,#d6ec87 56% 60%,#fff1bd 60% 64%,#fcd273 64% 68%,#f7b45b 68% 72%,#f1954a 72% 76%,#ea793f 76% 80%,#e25b39 80% 84%,#d43c37 84% 88%,#c42b3e 88% 92%,#a41554 92% 96%,#a64093 96% 100%)";
const HUMIDITY_LEGEND =
  "linear-gradient(90deg,#8c510a 0%,#dfc27d 24%,#f5f5f5 45%,#80cdc1 62%,#2b8cbe 82%,#2f63b0 92%,#4a3593 100%)";
const RAIN_LEGEND =
  "linear-gradient(90deg,#a8e0f5 0% 10%,#4cb0ee 10% 20%,#1f62d6 20% 30%,#7ddc5f 30% 40%,#24a63c 40% 50%,#f3e33b 50% 60%,#f8a31c 60% 70%,#e5411d 70% 80%,#a9142e 80% 90%,#df3fd6 90% 100%)";
const RAIN_STOPS = ["0,1", "0,7", "3", "10", "40", "150+"];
const ACCUM_LEGEND =
  "linear-gradient(90deg,#d4f4fa 0.0%,#d4f4fa 6.25%,#8fd3f2 6.25%,#8fd3f2 12.5%,#4fb3ea 12.5%,#4fb3ea 18.75%,#2f7fdc 18.75%,#2f7fdc 25.0%,#1f4fc8 25.0%,#1f4fc8 31.25%,#11877a 31.25%,#11877a 37.5%,#2fa64c 37.5%,#2fa64c 43.75%,#93c83e 43.75%,#93c83e 50.0%,#f2e23a 50.0%,#f2e23a 56.25%,#f8b22c 56.25%,#f8b22c 62.5%,#f37a20 62.5%,#f37a20 68.75%,#e2321f 68.75%,#e2321f 75.0%,#a8141e 75.0%,#a8141e 81.25%,#d23ea0 81.25%,#d23ea0 87.5%,#9b2fae 87.5%,#9b2fae 93.75%,#4f3a9e 93.75%,#4f3a9e 100.0%)";
const SNOW_LEVEL_LEGEND =
  "linear-gradient(90deg,#6a1b6e 0.0%,#6a1b6e 6.7%,#45288f 6.7%,#45288f 13.3%,#3049b0 13.3%,#3049b0 20.0%,#2a6ec4 20.0%,#2a6ec4 26.7%,#2793cf 26.7%,#2793cf 33.3%,#2fb4c6 33.3%,#2fb4c6 40.0%,#3fc29a 40.0%,#3fc29a 46.7%,#7fcd5a 46.7%,#7fcd5a 53.3%,#bfd737 53.3%,#bfd737 60.0%,#f0cf2a 60.0%,#f0cf2a 66.7%,#f6a72e 66.7%,#f6a72e 73.3%,#ee7e2f 73.3%,#ee7e2f 80.0%,#de5530 80.0%,#de5530 86.7%,#bf3036 86.7%,#bf3036 93.3%,#8a1f3a 93.3%,#8a1f3a 100.0%)";
const WIND_LEGEND =
  "linear-gradient(90deg,#f0f0f0 0%,#d0e8f0 5.9%,#a0d0e8 11.8%,#70b8e0 17.6%,#50a0d0 23.5%,#3088c0 29.4%,#a6dc8a 35.3%,#6cc04a 41.2%,#2f9a3a 47.1%,#fff176 52.9%,#ffbb30 58.8%,#ff9900 64.7%,#ff6600 70.6%,#ff3300 76.5%,#dd0000 82.4%,#990044 88.2%,#860088 94.1%,#860088 100%)";
const GUST_LEGEND =
  "linear-gradient(90deg,#f0f0f0 0%,#d0e8f0 5.6%,#a0d0e8 11.1%,#70b8e0 16.7%,#50a0d0 22.2%,#3088c0 27.8%,#a6dc8a 33.3%,#6cc04a 38.9%,#2f9a3a 44.4%,#fff176 50%,#ffbb30 55.6%,#ff9900 61.1%,#ff6600 66.7%,#ff3300 72.2%,#dd0000 77.8%,#990044 83.3%,#860088 88.9%,#6a2c9e 94.4%,#4b2f8f 100%)";
const PTYPE_LEGEND =
  "linear-gradient(90deg,#b4e2a4 0%,#b4e2a4 5%,#5dbb6a 5%,#5dbb6a 10%,#25854a 10%,#25854a 15%,#0f5440 15%,#0f5440 20%,#c9a0e8 20%,#c9a0e8 27.5%,#8c4fc4 27.5%,#8c4fc4 35%,#c8ecf7 35%,#c8ecf7 45%,#6cc3e8 45%,#6cc3e8 55%,#1f63c6 55%,#1f63c6 65%,#e0262b 65%,#e0262b 85%,#f08a24 85%,#f08a24 100%)";
// Meteociel AROME precipitation palette (mm): 24 threshold colours. Used for rain
// and snow, instant and accumulated, so every precipitation layer matches.
const PRECIP_PALETTE = [
  { value: 0, color: "#ffffff" },
  { value: 0.1, color: "#97e6ff" },
  { value: 0.2, color: "#33ccff" },
  { value: 0.5, color: "#0099ff" },
  { value: 1, color: "#00ff99" },
  { value: 2, color: "#33cc66" },
  { value: 3, color: "#66cc33" },
  { value: 4, color: "#66ff00" },
  { value: 5, color: "#a4f22f" },
  { value: 6, color: "#b7cf0e" },
  { value: 7, color: "#d6f017" },
  { value: 8, color: "#cc9900" },
  { value: 9, color: "#ff9900" },
  { value: 10, color: "#ff9966" },
  { value: 15, color: "#cc9999" },
  { value: 20, color: "#cc6633" },
  { value: 25, color: "#cc3333" },
  { value: 30, color: "#ff0d0d" },
  { value: 40, color: "#c60000" },
  { value: 50, color: "#800000" },
  { value: 60, color: "#800050" },
  { value: 70, color: "#a00077" },
  { value: 100, color: "#cc00cc" },
  { value: 200, color: "#ff00ff" },
];

const PRECIP_LEGEND = `linear-gradient(90deg,${PRECIP_PALETTE.map((entry, i) => {
  const from = ((i * 100) / PRECIP_PALETTE.length).toFixed(2);
  const to = (((i + 1) * 100) / PRECIP_PALETTE.length).toFixed(2);
  return `${entry.color} ${from}% ${to}%`;
}).join(",")})`;
const PRECIP_TICK_INDEXES = [0, 2, 3, 5, 7, 10, 13, 16, 19, 23];
const PRECIP_STOPS = ["0", "0,2", "0,5", "2", "4", "7", "10", "25", "50", "200+"];
const PRECIP_STOP_POSITIONS = PRECIP_TICK_INDEXES.map((i) => i / (PRECIP_PALETTE.length - 1));

const ANOMALY_LEGEND =
  "linear-gradient(90deg,#0d3f76 0.00% 6.25%,#1e61a5 6.25% 12.50%,#337eb8 12.50% 18.75%,#4f9bc7 18.75% 25.00%,#81bad8 25.00% 31.25%,#acd2e5 31.25% 37.50%,#d2e6f0 37.50% 43.75%,#eaf1f5 43.75% 50.00%,#f9eee7 50.00% 56.25%,#fddcc9 56.25% 62.50%,#f8bb9e 62.50% 68.75%,#ee9677 68.75% 75.00%,#db6b55 75.00% 81.25%,#c53e3d 81.25% 87.50%,#ab162a 87.50% 93.75%,#7c0722 93.75% 100.00%)";

export const VAR_META: Record<string, VariableMeta> = {
  temperature: { label: "Temperatura", shortLabel: "Temp", unit: "°C", legend: TEMP_LEGEND, stops: ["-10", "0", "10", "20", "30", "40+"] },
  humidity: { label: "Humitat relativa", shortLabel: "Hum.", unit: "%", legend: HUMIDITY_LEGEND, stops: ["0", "20", "40", "60", "80", "95", "100"] },
  pressure_msl: { label: "Pressió (MSL)", shortLabel: "Pressió", unit: "hPa", legend: "linear-gradient(90deg,#67001f 0%,#d73027 16%,#fdae61 35%,#ffffbf 53%,#a6d96a 72%,#1a9850 100%)", stops: ["980", "995", "1010", "1020", "1030", "1040"] },
  visibility: { label: "Visibilitat", shortLabel: "Vis.", unit: "m", legend: "linear-gradient(90deg,#67001f 0%,#bd0026 17%,#f03b20 34%,#fd8d3c 51%,#fecc5c 69%,#ffffb2 85%,#ffffff 100%)", stops: ["0", "1k", "2k", "5k", "10k", "20k"] },
  precipitation: { label: "Precipitació 1h", shortLabel: "Pluja", unit: "mm", legend: PRECIP_LEGEND, stops: PRECIP_STOPS, stopPositions: PRECIP_STOP_POSITIONS, palette: PRECIP_PALETTE },
  precip_accum: { label: "Precip. acumulada", shortLabel: "Acum.", unit: "mm", legend: PRECIP_LEGEND, stops: PRECIP_STOPS, stopPositions: PRECIP_STOP_POSITIONS, palette: PRECIP_PALETTE },
  snow_precipitation: { label: "Neu 1h", shortLabel: "Neu 1h", unit: "mm", legend: PRECIP_LEGEND, stops: PRECIP_STOPS, stopPositions: PRECIP_STOP_POSITIONS, palette: PRECIP_PALETTE },
  snow_accum: { label: "Neu acumulada", shortLabel: "Neu acum.", unit: "mm", legend: PRECIP_LEGEND, stops: PRECIP_STOPS, stopPositions: PRECIP_STOP_POSITIONS, palette: PRECIP_PALETTE },
  snow_level: { label: "Cota de Neu", shortLabel: "Cota", unit: "m", legend: SNOW_LEVEL_LEGEND, stops: ["0", "600", "1200", "1800", "2400", "3600"] },
  snow_depth: { label: "Gruix de neu", shortLabel: "Gruix", unit: "cm", legend: "linear-gradient(90deg,#9ecae1 0% 12.5%,#6baed6 12.5% 25%,#3182bd 25% 37.5%,#1d4f91 37.5% 50%,#5a3a9c 50% 62.5%,#8e2a8f 62.5% 75%,#b8336a 75% 87.5%,#6b0f3a 87.5% 100%)", stops: ["1", "5", "10", "20", "50", "100", "200", "300"] },
  graupel: { label: "Graupel 1h", shortLabel: "Graupel", unit: "mm", legend: PRECIP_LEGEND, stops: PRECIP_STOPS, stopPositions: PRECIP_STOP_POSITIONS, palette: PRECIP_PALETTE },
  precipitation_type: { label: "Tipus precipitació", shortLabel: "Tipus", unit: "", legend: PTYPE_LEGEND, stops: ["Pluja", "Aiguaneu", "Neu", "Gelant", "Calamarsa"], categorical: true },
  wind_speed: { label: "Vent", shortLabel: "Vent", unit: "km/h", legend: WIND_LEGEND, stops: ["0", "20", "40", "60", "100", "150+"] },
  wind_gust: { label: "Ratxes de vent", shortLabel: "Ratxes", unit: "km/h", legend: GUST_LEGEND, stops: ["0", "30", "60", "90", "120", "160", "200"] },
  temp_wind: { label: "Temp + Vent", shortLabel: "T+V", unit: "°C", legend: TEMP_LEGEND, stops: ["-10", "0", "10", "20", "30", "40+"] },
  cape: { label: "CAPE", shortLabel: "CAPE", unit: "J/kg", legend: "linear-gradient(90deg,#f4f9ec 0%,#c4e6a2 25%,#9ad46c 40%,#f3e65b 52%,#f08a2a 68%,#c2272d 85%,#8a1c6f 100%)", stops: ["0", "500", "1000", "2000", "3000", "5000"] },
  temp_max: { label: "Temperatura màxima", shortLabel: "Tmax", unit: "°C", legend: TEMP_LEGEND, stops: ["-10", "0", "10", "20", "30", "40+"] },
  temp_min: { label: "Temperatura mínima", shortLabel: "Tmin", unit: "°C", legend: TEMP_LEGEND, stops: ["-10", "0", "10", "20", "30", "40+"] },
  humidity_min: { label: "Humitat mínima", shortLabel: "HRmin", unit: "%", legend: HUMIDITY_LEGEND, stops: ["0", "20", "40", "60", "80", "95", "100"] },
  humidity_max: { label: "Humitat màxima", shortLabel: "HRmax", unit: "%", legend: HUMIDITY_LEGEND, stops: ["0", "20", "40", "60", "80", "95", "100"] },
  wind_gust_max: { label: "Ratxa màxima", shortLabel: "Ratxa max", unit: "km/h", legend: GUST_LEGEND, stops: ["0", "30", "60", "90", "120", "160", "200"] },
  precip_daily: { label: "Precipitació del dia", shortLabel: "Pluja dia", unit: "mm", legend: ACCUM_LEGEND, stops: ["0.1", "2", "20", "65", "150", "500+"] },
  temp_max_anomaly: { label: "Anomalia de la màxima", shortLabel: "Anom. max", unit: "°C", legend: ANOMALY_LEGEND, stops: ["-8", "-4", "0", "+4", "+8"] },
  temp_min_anomaly: { label: "Anomalia de la mínima", shortLabel: "Anom. min", unit: "°C", legend: ANOMALY_LEGEND, stops: ["-8", "-4", "0", "+4", "+8"] },
  sst: { label: "Temperatura del mar", shortLabel: "Mar", unit: "°C", legend: "linear-gradient(90deg,#424bb5 0%,#4687fb 12.5%,#25c0e7 25%,#20eaac 32.5%,#80ff53 45%,#c3f134 52.5%,#f2c93a 62.5%,#fe9029 72.5%,#f15d13 82.5%,#cc2b04 90%,#a11201 100%)", stops: ["10", "14", "18", "22", "26", "30"] },
  sst_anomaly: { label: "Anomalia de la temperatura del mar", shortLabel: "Anom. mar", unit: "°C", legend: ANOMALY_LEGEND, stops: ["-4", "-2", "0", "+2", "+4"] },
  snow_level_min: { label: "Cota mínima", shortLabel: "Cota min", unit: "m", legend: SNOW_LEVEL_LEGEND, stops: ["0", "600", "1200", "1800", "2500", "3500+"] },
  radar_rate: { label: "Intensitat de precipitació", shortLabel: "Intensitat", unit: "mm/h", legend: RAIN_LEGEND, stops: RAIN_STOPS },
  radar_cmax: { label: "Reflectivitat màxima", shortLabel: "Màxima", unit: "dBZ", legend: "linear-gradient(90deg,#9be7f5 0%,#04e9e7 15.4%,#019ff4 23.1%,#0300f4 30.8%,#02fd02 38.5%,#01c501 46.2%,#fefe00 53.8%,#ffc400 61.5%,#ff9100 69.2%,#ff0000 76.9%,#d40000 84.6%,#bc0000 92.3%,#f800fd 100%)", stops: ["5", "20", "35", "50", "65", "75"] },
  radar_ptype: { label: "Tipus de precipitació", shortLabel: "Tipus", unit: "", legend: PTYPE_LEGEND, stops: ["Pluja", "Aiguaneu", "Neu", "Gelant", "Calamarsa"], categorical: true },
  radar_vel_esgld: { label: "Velocitat radial · Gelida", shortLabel: "Gelida", unit: "m/s", legend: "linear-gradient(90deg,#00441b 0%,#006d2c 13.3%,#238b45 26.7%,#41ab5d 40%,#74c476 53.3%,#c7e9c0 66.7%,#d9d9d9 73.3%,#fcbba1 80%,#ef3b2c 86.7%,#a50f15 93.3%,#67000d 100%)", stops: ["-40", "-18", "-4", "4", "18", "+40"] },
  radar_vel_espdg: { label: "Velocitat radial · Saragossa", shortLabel: "Saragossa", unit: "m/s", legend: "linear-gradient(90deg,#00441b 0%,#006d2c 13.3%,#238b45 26.7%,#41ab5d 40%,#74c476 53.3%,#c7e9c0 66.7%,#d9d9d9 73.3%,#fcbba1 80%,#ef3b2c 86.7%,#a50f15 93.3%,#67000d 100%)", stops: ["-40", "-18", "-4", "4", "18", "+40"] },
  radar_vel_fropo: { label: "Velocitat radial · Opoul", shortLabel: "Opoul", unit: "m/s", legend: "linear-gradient(90deg,#00441b 0%,#006d2c 13.3%,#238b45 26.7%,#41ab5d 40%,#74c476 53.3%,#c7e9c0 66.7%,#d9d9d9 73.3%,#fcbba1 80%,#ef3b2c 86.7%,#a50f15 93.3%,#67000d 100%)", stops: ["-40", "-18", "-4", "4", "18", "+40"] },
};

export const AROME_GROUPS = [
  { id: "surface", label: "Superfície", variables: ["temperature", "humidity", "pressure_msl"] },
  { id: "precipitation", label: "Precipitació i neu", variables: ["precipitation", "precip_accum", "snow_precipitation", "snow_accum", "graupel"] },
  { id: "wind", label: "Vent", variables: ["wind_speed", "temp_wind"] },
  { id: "instability", label: "Atmosfera", variables: ["cape"] },
];

export const OBS_GROUPS = [
  { id: "now", label: "Ara", variables: ["temperature", "humidity", "wind_speed", "wind_gust", "precipitation", "snow_level", "precipitation_type", "snow_depth"] },
  { id: "today", label: "Avui · fins ara", variables: ["temp_max", "temp_min", "humidity_min", "humidity_max", "wind_gust_max", "precip_daily", "snow_level_min", "temp_max_anomaly", "temp_min_anomaly"] },
  { id: "sea", label: "Mar · última nit", variables: ["sst", "sst_anomaly"] },
];

export const RADAR_GROUPS = [
  { id: "radar", label: "Radar", variables: ["radar_rate", "radar_ptype", "radar_cmax"] },
  { id: "radar_velocity", label: "Velocitat radial", variables: ["radar_vel_esgld", "radar_vel_espdg", "radar_vel_fropo"] },
];

export const AROME_LABELS: Record<string, string> = {
  temperature: "Temperatura a 2 m",
  temp_max: "Temperatura màxima del dia",
  temp_min: "Temperatura mínima del dia",
  temp_max_anomaly: "Anomalia de la màxima (1991-2020)",
  temp_min_anomaly: "Anomalia de la mínima (1991-2020)",
  humidity: "Humitat relativa a 2 m",
  visibility: "Visibilitat",
  wind_speed: "Vent mitjà a 10 m",
  wind_gust: "Ratxa màxima a 10 m",
  temp_wind: "Temperatura i vent",
  precipitation: "Precipitació 1 h",
  precip_accum: "Precipitació acumulada",
  snow_precipitation: "Neu 1 h",
  snow_accum: "Neu acumulada",
  snow_level: "Cota de neu",
  snow_depth: "Gruix de neu",
  graupel: "Calamarsa 1 h",
  precipitation_type: "Tipus de precipitació",
  cape: "Energia convectiva (CAPE)",
};

export const OBS_LABELS: Record<string, string> = {
  temperature: "Temperatura a 2 m",
  humidity: "Humitat relativa a 2 m",
  wind_speed: "Vent mitjà a 10 m",
  wind_gust: "Ratxa màxima a 10 m",
  precipitation: "Precipitació 1 h",
  snow_level: "Cota de neu",
  precipitation_type: "Tipus de precipitació",
  snow_depth: "Gruix de neu",
  temp_max: "Temperatura màxima a 2 m",
  temp_min: "Temperatura mínima a 2 m",
  humidity_min: "Humitat mínima a 2 m",
  humidity_max: "Humitat màxima a 2 m",
  wind_gust_max: "Ratxa màxima del dia a 10 m",
  precip_daily: "Precipitació d'avui",
  snow_level_min: "Cota de neu mínima",
  temp_max_anomaly: "Anomalia de la màxima (1991-2020)",
  temp_min_anomaly: "Anomalia de la mínima (1991-2020)",
  sst: "Temperatura de l'aigua del mar",
  sst_anomaly: "Anomalia de la temperatura del mar",
};

export const RADAR_LABELS: Record<string, string> = {
  radar_rate: "Intensitat de precipitació",
  radar_cmax: "Reflectivitat màxima",
  radar_ptype: "Tipus de precipitació",
  radar_vel_esgld: "Velocitat radial · Gelida",
  radar_vel_espdg: "Velocitat radial · Saragossa",
  radar_vel_fropo: "Velocitat radial · Opoul",
};

const COMPASS = ["Tramuntana", "Gregal", "Llevant", "Xaloc", "Migjorn", "Llebeig", "Ponent", "Mestral"];

/** Catalan compass name for a wind direction in degrees. */
export function compassName(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  return COMPASS[Math.round(deg / 45) % 8];
}

export function displayLabel(source: MapSource, variable: string): string {
  if (source === "obs") return OBS_LABELS[variable] ?? VAR_META[variable]?.label ?? variable;
  if (source === "radar") return RADAR_LABELS[variable] ?? VAR_META[variable]?.label ?? variable;
  return AROME_LABELS[variable] ?? VAR_META[variable]?.label ?? variable;
}

/** Compact label used by the raster "values over the map" layer. */
export function compactValue(variable: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  switch (variable) {
    case "temperature":
    case "temp_max":
    case "temp_min":
      return `${Math.round(value)}°`;
    case "sst":
      return `${value.toFixed(1)}°`;
    case "temp_max_anomaly":
    case "temp_min_anomaly":
    case "sst_anomaly":
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}°`;
    case "humidity":
    case "humidity_min":
    case "humidity_max":
      return `${Math.round(value)}%`;
    case "precipitation":
    case "precip_accum":
    case "precip_daily":
    case "snow_precipitation":
    case "snow_accum":
      if (value < 0.1) return "";
      return value < 10 ? value.toFixed(1) : `${Math.round(value)}`;
    case "snow_depth": {
      const cm = 100 * value;
      return cm < 1 ? "" : `${Math.round(cm)}cm`;
    }
    case "snow_level":
    case "snow_level_min":
      return `${50 * Math.round(value / 50)}`;
    case "cape":
      return value < 50 ? "" : `${10 * Math.round(value / 10)}`;
    case "visibility":
      return value >= 10000 ? "" : value >= 1000 ? `${Math.round(value / 1000)}km` : `${100 * Math.round(value / 100)}m`;
    case "graupel":
      return value < 0.1 ? "" : value.toFixed(1);
    case "precipitation_type":
    case "radar_ptype":
      return "";
    case "wind_speed":
    case "wind_gust":
    case "wind_gust_max":
      return value < 5 ? "" : `${Math.round(value)}`;
    default:
      return `${Math.round(value)}`;
  }
}

export function formatValue(variable: string, value: number | null | undefined, unit?: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (variable === "snow_depth") return `${Math.round(100 * value)} cm`;
  if (variable === "precipitation_type" || variable === "radar_ptype") {
    const names = ["Pluja feble", "Pluja moderada", "Pluja forta", "Xàfec", "Aiguaneu feble", "Aiguaneu forta", "Neu feble", "Neu moderada", "Neu forta", "Pluja gelant", "Calamarsa"];
    return names[Math.round(value)] ?? "—";
  }
  if (variable === "visibility") {
    return value >= 1000 ? `${(value / 1000).toFixed(value < 10000 ? 1 : 0).replace(".", ",")} km` : `${10 * Math.round(value / 10)} m`;
  }
  const decimals = [
    "temperature", "temp_max", "temp_min", "precipitation", "precip_accum", "precip_daily",
    "snow_precipitation", "snow_accum", "pressure_msl", "radar_rate", "radar_ptype", "graupel", "sst",
    "sst_anomaly", "temp_max_anomaly", "temp_min_anomaly",
  ].includes(variable)
    ? 1
    : 0;
  const out = variable.startsWith("snow_level") ? `${10 * Math.round(value / 10)}` : value.toFixed(decimals).replace(".", ",");
  return unit ? `${out} ${unit}` : out;
}

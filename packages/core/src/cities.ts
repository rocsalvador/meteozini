export type City = { name: string; lat: number; lon: number; priority: number };

export const CITIES: City[] = [
  ["Barcelona", 2.1734, 41.3851, 1],
  ["Girona", 2.8214, 41.9794, 1],
  ["Lleida", 0.62, 41.6176, 1],
  ["Tarragona", 1.2445, 41.1189, 1],
  ["Andorra la Vella", 1.5211, 42.5063, 1],
  ["Manresa", 1.8239, 41.728, 2],
  ["Vic", 2.2549, 41.9301, 2],
  ["Reus", 1.1069, 41.1498, 2],
  ["Tortosa", 0.5216, 40.8125, 2],
  ["Figueres", 2.9616, 42.2666, 2],
  ["Olot", 2.4883, 42.181, 2],
  ["La Seu d'Urgell", 1.4614, 42.3572, 2],
  ["Puigcerdà", 1.927, 42.4316, 2],
  ["Vielha", 0.7936, 42.701, 2],
  ["Tremp", 0.894, 42.1671, 2],
  ["Berga", 1.8458, 42.1014, 2],
  ["Mataró", 2.4445, 41.5381, 2],
  ["Sabadell", 2.1094, 41.5463, 2],
  ["Terrassa", 2.0089, 41.5632, 2],
  ["Amposta", 0.579, 40.7098, 3],
  ["Balaguer", 0.8056, 41.7912, 3],
  ["Banyoles", 2.7653, 42.1167, 3],
  ["Cervera", 1.272, 41.6704, 3],
  ["El Pont de Suert", 0.74, 42.4077, 3],
  ["Falset", 0.8197, 41.1455, 3],
  ["Gandesa", 0.4386, 41.0538, 3],
  ["Granollers", 2.2879, 41.6079, 3],
  ["Igualada", 1.6172, 41.5788, 3],
  ["La Bisbal d'Empordà", 3.0393, 41.9602, 3],
  ["Les Borges Blanques", 0.869, 41.5194, 3],
  ["Moià", 2.0975, 41.8117, 3],
  ["Mollerussa", 0.8947, 41.6297, 3],
  ["Montblanc", 1.161, 41.376, 3],
  ["Móra d'Ebre", 0.6381, 41.0911, 3],
  ["Prats de Lluçanès", 2.0303, 42.0122, 3],
  ["Ripoll", 2.1907, 42.2008, 3],
  ["Sant Feliu de Llobregat", 2.0451, 41.3834, 3],
  ["Santa Coloma de Farners", 2.6636, 41.8609, 3],
  ["Solsona", 1.5177, 41.9936, 3],
  ["Sort", 1.1286, 42.413, 3],
  ["Tàrrega", 1.1391, 41.647, 3],
  ["Valls", 1.249, 41.2861, 3],
  ["El Vendrell", 1.5342, 41.2204, 3],
  ["Vilafranca del Penedès", 1.6996, 41.3462, 3],
  ["Vilanova i la Geltrú", 1.7259, 41.223, 3],
].map(([name, lon, lat, priority]) => ({ name: name as string, lon: lon as number, lat: lat as number, priority: priority as number }));

export function nearestCityName(lat: number, lon: number): string | null {
  let best: City | null = null;
  let bestDist = Infinity;
  for (const city of CITIES) {
    const dLat = (city.lat - lat) * 111;
    const dLon = (city.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180);
    const dist = Math.hypot(dLat, dLon);
    if (dist < bestDist) {
      bestDist = dist;
      best = city;
    }
  }
  return best && bestDist < 12 ? best.name : null;
}

export const CATALAN_PEAKS = [
  { name: "Pica d'Estats", lat: 42.6669, lon: 1.3997, alt: 3143 },
  { name: "Puigpedrós", lat: 42.5, lon: 1.7667, alt: 2914 },
  { name: "Comaloforno", lat: 42.5833, lon: 0.7833, alt: 3029 },
  { name: "Besiberri Nord", lat: 42.5833, lon: 0.7667, alt: 3009 },
  { name: "Puigmal", lat: 42.3833, lon: 2.1167, alt: 2910 },
  { name: "Bastiments", lat: 42.4, lon: 2.05, alt: 2881 },
  { name: "Montcalm", lat: 42.6667, lon: 1.4, alt: 3077 },
  { name: "Pic de Costa Cabirolera", lat: 42.35, lon: 1.6333, alt: 2764 },
  { name: "Puig de la Canal Baridana", lat: 42.5167, lon: 1.9333, alt: 2864 },
  { name: "Montseny · Turó de l'Home", lat: 41.7764, lon: 2.4333, alt: 1706 },
  { name: "Montserrat", lat: 41.5933, lon: 1.8383, alt: 1236 },
  { name: "Canigó", lat: 42.5189, lon: 2.4564, alt: 2784 },
];

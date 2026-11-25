import MuntanyaPage from "./muntanya-client";

export const metadata = {
  title: "Planificador de sortides a la muntanya amb previsió i allaus | meteozini",
  description:
    "Carrega un recorregut GPX i consulta la previsió hora a hora al llarg de la ruta, amb el perill d'allaus de l'ICGC i les pendents propícies per a l'esquí de muntanya.",
};

export default function Page() {
  return <MuntanyaPage />;
}

const FIXTURE_SOURCES = [
  {
    title: "OpenStax Chemistry 2e — Stoichiometry",
    url: "https://openstax.org/books/chemistry-2e/pages/4-introduction",
    excerpt: "DEMO FIXTURE · capítulo introductorio de estequiometría y reacciones químicas.",
  },
  {
    title: "OpenStax Chemistry 2e — Equilibrium",
    url: "https://openstax.org/books/chemistry-2e/pages/13-introduction",
    excerpt: "DEMO FIXTURE · capítulo introductorio sobre equilibrio químico.",
  },
];

export class FixtureResearchClient {
  async getUrlText() {
    return {
      text: "DEMO FIXTURE · Balanceo, estequiometría y equilibrio químico.",
      label: "Currículo fixture por URL",
      canonicalUrl: "https://example.com/demo-curriculum",
    };
  }

  async search() {
    return structuredClone(FIXTURE_SOURCES);
  }
}

export class FixtureModelClient {
  async outlineCurriculum() {
    return {
      subject: "Química general",
      objectives: [
        "Balancear ecuaciones conservando átomos.",
        "Aplicar proporciones molares.",
        "Interpretar cualitativamente el equilibrio.",
      ],
      constraints: ["Tres sesiones", "Revisión humana obligatoria"],
      researchQueries: ["OpenStax chemistry stoichiometry", "OpenStax chemistry equilibrium"],
    };
  }

  async generatePlan({ days, sources }) {
    const templates = [
      {
        topic: "Balanceo químico",
        objective: "Conservar el número de átomos de cada elemento.",
        problem: "Balancea Fe + O₂ → Fe₂O₃ e indica la suma de los coeficientes enteros mínimos.",
        hints: ["Empieza por el hierro.", "Usa el mínimo común múltiplo para el oxígeno."],
        solution: "4 Fe + 3 O₂ → 2 Fe₂O₃; la suma es 9.",
      },
      {
        topic: "Estequiometría",
        objective: "Relacionar moles mediante una ecuación balanceada.",
        problem: "Según 2 H₂ + O₂ → 2 H₂O, ¿cuántos moles de agua se forman con 3 mol de O₂ y H₂ en exceso?",
        hints: ["Lee la relación O₂:H₂O.", "Multiplica 3 mol por la razón molar."],
        solution: "La razón es 1:2; se forman 6 mol de H₂O.",
      },
      {
        topic: "Equilibrio",
        objective: "Predecir un desplazamiento cualitativo.",
        problem: "En N₂(g) + 3 H₂(g) ⇌ 2 NH₃(g), ¿hacia dónde se desplaza el equilibrio al aumentar la presión a temperatura constante? Explica.",
        hints: ["Compara moles gaseosos a ambos lados.", "El sistema favorece el lado con menos moles gaseosos."],
        solution: "Se desplaza a la derecha: pasa de 4 a 2 moles gaseosos.",
      },
    ];
    return {
      summary: `DEMO FIXTURE · ${days} días de práctica progresiva con revisión humana.`,
      entries: Array.from({ length: days }, (_, index) => {
        const template = templates[index % templates.length];
        return {
          id: `D${index + 1}`,
          ...template,
          sourceUrls: [sources[index % sources.length].url],
          reviewRequired: true,
        };
      }),
    };
  }
}

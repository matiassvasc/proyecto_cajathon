# KipuAI — CAJATHON 2026 (Desafío NEG-01: Caja Trujillo)

**Equipo:** BRADS TECH · **Eje 4:** Inclusión Financiera y Resiliencia

Prototipo funcional autónomo en **Next.js 15 (App Router) + TypeScript + Tailwind CSS + Recharts + `@google/genai`** para originación microfinanciera adaptada al ciclo económico real del negocio bajo las reglas matemáticas Base 360 de Caja Trujillo.

## Módulos
1. **Chasqui (`src/components/ChasquiIntake.tsx`):** 4 arquetipos calibrados de La Libertad (Panadería Trujillo, Textil El Porvenir, Agro Palta/Espárrago Virú–Chao, Taller Mecánico La Esperanza), extractor multimodal (`/api/extract-business`) y **Deslizador de Criterio de Campo**.
2. **Kipu (`src/lib/financial-engine.ts`, `src/components/KipuScheduleView.tsx`):** Motor exacto Base 360 (`America/Lima`), seguros simples Base 360, periodicidad mensual o elástica (`22d` cima / `30d` normal / `40d` valle), prelación estricta de 5 niveles sin capitalización y cálculo exacto de TCEA.
3. **Ayni (`src/components/AyniStressCommittee.tsx`):** Simulador de 4 escenarios adversos (*Base*, *Caída -25%*, *Retraso +30d*, *Shock Fenómeno El Niño -45%*), Dictamen «Abogado del Diablo» (`/api/audit-committee`) y Acta Ejecutiva imprimible.

## Ejecución Local (Windows PowerShell)
```powershell
npm.cmd install
Copy-Item .env.example .env.local   # Opcional: agrega GEMINI_API_KEY para IA en vivo (sin clave usa fallback determinista)
npm.cmd run dev
```

## Verificación Matemática, Contratos y Build
```powershell
npx.cmd tsx scripts/verify-formatters-archetypes.ts
npx.cmd tsx scripts/verify-engine.ts
npx.cmd tsx scripts/verify-api-handlers.ts
node node_modules/typescript/bin/tsc --noEmit
npm.cmd run build
```

## Documentación y Evidencia
- [Propuesta Ejecutiva](PROPUESTA_EJECUTIVA_KIPUAI.md)
- [Informe Ejecutivo Ilustrado BRADS TECH (PDF)](docs/Informe_Ejecutivo_KipuAI_BRADS_TECH.pdf)
- [Capturas de Pantalla](docs/capturas/)
